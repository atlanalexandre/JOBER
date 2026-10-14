// ═══════════════════════════════════════════════════════════════════════════
// Liste anti-recréation (`account_blacklist`) — décision D4, 14/10/2026
// ═══════════════════════════════════════════════════════════════════════════
//
// Un compte supprimé ou exclu laisse ses empreintes (e-mail, téléphone, IBAN,
// SIRET, hachés). Un nouveau compte qui en porte une est un compte recréé : il
// n'a pas droit au quota gratuit (`trial_exhausted`). Quatre trous :
//
//   1. l'IBAN n'était comparé qu'à l'inscription et à la validation — avant que
//      le prestataire le saisisse : il ne reconnaissait jamais personne. La
//      tâche planifiée compare désormais tous les comptes, IBAN compris, toutes
//      les deux heures (`comptesRecrees`) ;
//   2. le téléphone était haché tel que saisi : « 06 12 34 56 78 »,
//      « 0612345678 » et « +33612345678 » donnaient trois empreintes. Il est
//      ramené à une forme unique, et comparé aussi sous ses autres écritures
//      (les empreintes déjà enregistrées l'ont été sur le numéro brut) ;
//   3. la remise à zéro du 1er du mois rendait le quota gratuit à tout le
//      monde, comptes recréés compris : elle les écarte désormais ;
//   4. la résiliation à l'échéance d'un préavis — le chemin des exclusions
//      décidées par ALANE — n'inscrivait rien sur la liste.
// ═══════════════════════════════════════════════════════════════════════════
import { hashPii } from "./_email.js";
import { lireTout } from "./_lignes.js";

/** Un numéro français ramené à « 0612345678 » ; un numéro étranger, à ses chiffres. */
export function telephoneNormalise(tel) {
  const c = String(tel ?? "").replace(/\D/g, "");
  if (!c) return null;
  if (c.startsWith("0033")) return "0" + c.slice(4);
  if (c.startsWith("33") && c.length === 11) return "0" + c.slice(2);
  return c;
}

/** Les écritures sous lesquelles un même numéro a pu être haché. */
function ecrituresTelephone(tel) {
  const brut = tel == null ? "" : String(tel).trim();
  const n = telephoneNormalise(tel);
  const v = [n, brut];
  if (n && /^0\d{9}$/.test(n)) v.push(`+33${n.slice(1)}`, `33${n.slice(1)}`, `0033${n.slice(1)}`);
  return v;
}

export const ibanNormalise = (iban) => (iban ? String(iban).replace(/\s/g, "").toUpperCase() : null) || null;
export const siretNormalise = (siret) => (siret ? String(siret).replace(/\D/g, "") : null) || null;

const hacher = (valeurs) => [...new Set(valeurs.filter(Boolean).map(hashPii).filter(Boolean))];

/** Les empreintes d'un compte, à comparer à la liste (plusieurs par champ). */
export function empreintes({ email, telephone, iban, siret }) {
  return {
    email: hacher([email]),
    telephone: hacher(ecrituresTelephone(telephone)),
    iban: hacher([ibanNormalise(iban)]),
    siret: hacher([siretNormalise(siret), siret ? String(siret).replace(/\s/g, "") : null]),
  };
}

/** Le filtre PostgREST `or=(…)` qui retrouve ces empreintes dans la liste ("" s'il n'y en a aucune). */
export function filtreListeNoire(e) {
  const parts = [];
  for (const [champ, colonne] of [["email", "email_hash"], ["telephone", "telephone_hash"], ["iban", "iban_hash"], ["siret", "siret_hash"]]) {
    if (e[champ].length) parts.push(`${colonne}.in.(${e[champ].join(",")})`);
  }
  return parts.length ? `(${parts.join(",")})` : "";
}

/** La ligne à inscrire : chaque champ sous sa forme normalisée. */
export function ligneListeNoire({ email, telephone, iban, siret }, extra = {}) {
  return {
    email_hash: hashPii(email || null),
    telephone_hash: hashPii(telephoneNormalise(telephone)),
    iban_hash: hashPii(ibanNormalise(iban)),
    siret_hash: hashPii(siretNormalise(siret)),
    ...extra,
  };
}

/** La liste chargée en mémoire, pour comparer beaucoup de comptes d'un coup. */
export function ensemblesListeNoire(lignes) {
  const s = { email: new Set(), telephone: new Set(), iban: new Set(), siret: new Set() };
  for (const l of lignes || []) {
    if (l.email_hash) s.email.add(l.email_hash);
    if (l.telephone_hash) s.telephone.add(l.telephone_hash);
    if (l.iban_hash) s.iban.add(l.iban_hash);
    if (l.siret_hash) s.siret.add(l.siret_hash);
  }
  return s;
}

export function correspond(e, s) {
  return ["email", "telephone", "iban", "siret"].some((champ) => e[champ].some((h) => s[champ].has(h)));
}

/** Les comptes d'authentification, page par page (e-mail et métadonnées). */
export async function lireUtilisateurs(supabaseUrl, headers) {
  const tous = {};
  for (let page = 1; page < 100; page++) {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers });
    const d = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(d?.users)) throw new Error(`comptes illisibles (${r.status}) page ${page}`);
    for (const u of d.users) tous[u.id] = { email: u.email, meta: u.user_metadata || {} };
    if (d.users.length < 1000) return tous;
  }
  throw new Error("plus de 99 000 comptes : lecture interrompue");
}

/**
 * Les profils dont une empreinte figure sur la liste — IBAN saisi après
 * l'inscription compris. `utilisateurs` : la table déjà chargée par l'appelant,
 * sinon relue. Lève une erreur si une lecture échoue : l'appelant décide.
 */
export async function comptesRecrees(supabaseUrl, headers, { utilisateurs = null } = {}) {
  const liste = await lireTout(`${supabaseUrl}/rest/v1/account_blacklist?select=id,email_hash,telephone_hash,iban_hash,siret_hash`, headers);
  const recrees = new Set();
  if (!liste.length) return recrees;
  const s = ensemblesListeNoire(liste);
  const users = utilisateurs || await lireUtilisateurs(supabaseUrl, headers);
  const profils = await lireTout(`${supabaseUrl}/rest/v1/profiles?select=id,rib,siret,tel`, headers);
  for (const p of profils) {
    const u = users[p.id] || { meta: {} };
    const e = empreintes({
      email: u.email,
      telephone: u.meta.telephone || p.tel,
      iban: p.rib,
      siret: p.siret || u.meta.siret || u.meta.kbis,
    });
    if (correspond(e, s)) recrees.add(p.id);
  }
  return recrees;
}
