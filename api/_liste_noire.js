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
//
// Suites (relecture du 15/10/2026) :
//   - une ligne inscrite APRÈS la création d'un compte ne le désigne pas : la
//     suppression inscrit l'empreinte, puis peut échouer (« votre compte n'a
//     pas été supprimé ») — le compte restait, et perdait son quota gratuit ;
//   - le numéro modifié dans le profil est enregistré par paires
//     (« 06 12 34 56 78 ») : les empreintes d'avant D4 l'ont haché ainsi ;
//   - la remise à zéro mensuelle n'écarte plus les comptes recréés dans
//     l'adresse : au-delà de 400 environ, la requête échouait — et la remise
//     à zéro de tous avec elle (`remiseAZeroMensuelle`).
// ═══════════════════════════════════════════════════════════════════════════
import { hashPii } from "./_email.js";
import { lireTout } from "./_lignes.js";
import { ecrireVerifie } from "./_ecriture.js";

/** Durée pendant laquelle une empreinte compte (CGPS art. 14.4) : 3 ans. */
export const CONSERVATION_EMPREINTES_MS = 3 * 365.25 * 24 * 3600 * 1000;

/**
 * Le filtre PostgREST `created_at` des lectures directes de la liste : les
 * contrôles de l'inscription et de la validation interrogeaient toute la table,
 * empreintes de plus de 3 ans comprises (relecture du 22/10/2026).
 */
export const depuisConservation = (maintenant = Date.now()) =>
  `gte.${new Date(maintenant - CONSERVATION_EMPREINTES_MS).toISOString()}`;

/**
 * Le paramètre `and` des lectures directes : une empreinte de la liste
 * (`filtreListeNoire`), ET de moins de 3 ans — ou sans date, comptée comme
 * `ensemblesListeNoire` la compte (on ne la sait pas périmée ; la colonne
 * admet NULL). `created_at=gte.` seul écartait ces lignes (relecture du 23/10/2026).
 */
export const dansLaConservation = (filtre, maintenant = Date.now()) =>
  `(or${filtre},or(created_at.${depuisConservation(maintenant)},created_at.is.null))`;

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
  if (n && /^0\d{9}$/.test(n)) {
    const reste = n.slice(1);
    v.push(`+33${reste}`, `33${reste}`, `0033${reste}`);
    // Par paires, comme l'écran l'affiche et l'enregistre après une
    // modification du profil (`formatPhone`), et ses variantes courantes.
    const paires = n.match(/\d{2}/g);
    for (const sep of [" ", ".", "-"]) v.push(paires.join(sep));
    v.push(`+33 ${reste[0]} ${reste.slice(1).match(/\d{2}/g).join(" ")}`);
  }
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

/**
 * Depuis cette date, une empreinte n'est inscrite qu'une fois le compte
 * réellement supprimé (`inscrireListeNoire`). Une ligne plus ancienne a pu
 * l'être par une suppression manquée : elle ne vaut que pour un compte créé
 * après elle. Une ligne plus récente vaut pour tout compte, même ouvert avant
 * — sinon il suffisait d'ouvrir le nouveau compte avant de supprimer l'ancien.
 */
export const INSCRIPTION_APRES_SUPPRESSION_MS = Date.parse("2026-10-19T12:00:00Z");

/**
 * La liste chargée en mémoire, pour comparer beaucoup de comptes d'un coup :
 * pour chaque empreinte, la date de sa PREMIÈRE inscription (en ms, `-Infinity`
 * si la ligne n'en porte pas ou date d'après `INSCRIPTION_APRES_SUPPRESSION_MS`
 * — elle compte alors toujours).
 */
export function ensemblesListeNoire(lignes, maintenant = Date.now()) {
  const s = { email: new Map(), telephone: new Map(), iban: new Map(), siret: new Map() };
  for (const l of lignes || []) {
    const quand = Date.parse(l.created_at);
    const ms = Number.isFinite(quand) ? quand : -Infinity;
    // Au-delà de 3 ans, l'empreinte ne désigne plus personne (CGPS art. 14.4,
    // décision d'Alexandre du 21/10/2026). Une date illisible reste comptée :
    // on ne la sait pas périmée.
    if (Number.isFinite(quand) && maintenant - quand >= CONSERVATION_EMPREINTES_MS) continue;
    // Inscrite une fois la suppression faite : elle vaut pour tout compte.
    const sure = ms >= INSCRIPTION_APRES_SUPPRESSION_MS ? -Infinity : ms;
    for (const [champ, colonne] of [["email", "email_hash"], ["telephone", "telephone_hash"], ["iban", "iban_hash"], ["siret", "siret_hash"]]) {
      const h = l[colonne];
      if (h && !(s[champ].get(h) <= sure)) s[champ].set(h, sure);
    }
  }
  return s;
}

/**
 * Le compte porte-t-il une empreinte de la liste ? `creeLeMs` : sa date de
 * création. Donnée, une ligne ANCIENNE (d'avant `INSCRIPTION_APRES_SUPPRESSION_MS`)
 * ne compte que si elle précède le compte : postérieure, elle peut être celle
 * de sa propre suppression, manquée. Une ligne récente compte toujours.
 */
export function correspond(e, s, creeLeMs = null) {
  const borne = Number.isFinite(creeLeMs) ? creeLeMs : Infinity;
  return ["email", "telephone", "iban", "siret"].some((champ) => e[champ].some((h) => s[champ].has(h) && s[champ].get(h) < borne));
}

/**
 * Inscrit l'empreinte d'un compte supprimé. À appeler une fois les données du
 * compte EFFACÉES, jamais avant : une suppression qui échoue en chemin (pièces
 * non effacées) laissait l'empreinte d'un compte resté ouvert et utilisable
 * (relecture du 16/10/2026). Les identifiants, eux, se lisent avant
 * l'effacement — `ligne` est calculée tôt. `contexte` nomme le compte : un
 * échec est journalisé (le droit à l'effacement prime, la suppression tient),
 * et l'empreinte se reprend à la main.
 */
export async function inscrireListeNoire(supabaseUrl, headers, ligne, contexte) {
  if (!ligne) return false;
  return ecrireVerifie(`${supabaseUrl}/rest/v1/account_blacklist`, ligne, headers,
    `${contexte} — empreinte anti-recréation`, { method: "POST" });
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

/** Les colonnes de `profiles` qu'il faut à `comptesRecrees`. */
export const COLONNES_PROFIL_LISTE_NOIRE = "id,rib,siret,tel,created_at";

/**
 * Les profils dont une empreinte figure sur la liste — IBAN saisi après
 * l'inscription compris. `utilisateurs` et `profils` (colonnes
 * `COLONNES_PROFIL_LISTE_NOIRE`) : déjà chargés par l'appelant, sinon relus.
 * Lève une erreur si une lecture échoue : l'appelant décide.
 */
export async function comptesRecrees(supabaseUrl, headers, { utilisateurs = null, profils = null } = {}) {
  const liste = await lireTout(`${supabaseUrl}/rest/v1/account_blacklist?select=id,email_hash,telephone_hash,iban_hash,siret_hash,created_at`, headers);
  const recrees = new Set();
  if (!liste.length) return recrees;
  const s = ensemblesListeNoire(liste);
  const users = utilisateurs || await lireUtilisateurs(supabaseUrl, headers);
  const lus = profils || await lireTout(`${supabaseUrl}/rest/v1/profiles?select=${COLONNES_PROFIL_LISTE_NOIRE}`, headers);
  for (const p of lus) {
    const u = users[p.id] || { meta: {} };
    const e = empreintes({
      email: u.email,
      telephone: u.meta.telephone || p.tel,
      iban: p.rib,
      siret: p.siret || u.meta.siret || u.meta.kbis,
    });
    if (correspond(e, s, Date.parse(p.created_at))) recrees.add(p.id);
  }
  return recrees;
}

/**
 * La remise à zéro du 1er du mois : les compteurs de tous, et le quota gratuit
 * rendu — sauf aux comptes recréés, dont la pénalité est reposée aussitôt.
 *
 * Elle écartait les comptes recréés dans l'adresse (`id=not.in.(…)`) : au-delà
 * de 400 environ, la requête échouait (mesuré sur la recette le 15/10/2026), et
 * la remise à zéro de TOUS les comptes avec elle. Tous sont remis à zéro, puis
 * les comptes recréés repénalisés par lots de 100.
 *
 * Retourne { ok, status, detail } : ok à false si la remise à zéro elle-même
 * est refusée — rien n'est alors repénalisé, personne n'ayant rien reçu.
 */
export async function remiseAZeroMensuelle(supabaseUrl, headers, recrees = new Set()) {
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?or=(missions_completed_month.gt.0,commandes_mois.gt.0,trial_exhausted.is.true)`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ missions_completed_month: 0, commandes_mois: 0, trial_exhausted: false }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error(`[reset] remise à zéro refusée (${r.status}) :`, detail.slice(0, 200));
    return { ok: false, status: r.status, detail };
  }
  const ids = [...recrees];
  for (let i = 0; i < ids.length; i += 100) {
    const rPen = await fetch(`${supabaseUrl}/rest/v1/profiles?id=in.(${ids.slice(i, i + 100).join(",")})`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0, commandes_mois: 0, trial_exhausted: true }),
    });
    if (!rPen.ok) console.error(`[reset] pénalité des comptes recréés non reposée (${rPen.status}) sur ${Math.min(100, ids.length - i)} compte(s) — `
      + "la tâche des deux heures la reposera.");
  }
  return { ok: true, status: r.status };
}
