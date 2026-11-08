// ═══════════════════════════════════════════════════════════════════════════
// Références d'expérience confirmées par e-mail (09/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Décision d'Alexandre du 09/11/2026 : pour les métiers sans diplôme, vérifier
// l'expérience déclarée sans appeler chaque référence. Le prestataire indique
// l'entreprise (son SIRET) et l'e-mail d'un responsable ; ALANE lui écrit, et
// sa réponse donne — ou non — la mention « Référence confirmée ».
//
// Ce que l'e-mail dit, le serveur le construit depuis ce qu'il a lu lui-même :
// le NOM OFFICIEL de l'entreprise (registre SIRENE, jamais le texte du
// prestataire), un métier du catalogue qu'il a déclaré, des années. Aucun texte
// libre du navigateur ne part au nom d'ALANE (CLAUDE.md §4, « SMS ou e-mail au
// nom d'ALANE ») — sinon ce formulaire servirait à écrire n'importe quoi à
// n'importe qui. Et le nombre de références est plafonné.
//
// Contre la triche — un ami qui répond « oui » :
//   • l'entreprise doit exister et être active dans SIRENE ;
//   • le contact ne peut pas être le prestataire lui-même ;
//   • une adresse personnelle (gmail…) est signalée au back-office ;
//   • un même contact qui recommande plusieurs prestataires est signalé.
// Une référence confirmée AIDE à juger un dossier ; elle ne prouve pas seule.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, randomBytes } from "node:crypto";
import { emailHtml, esc, sendEmail } from "./_email.js";
import { lireTout } from "./_lignes.js";
import { appUrl } from "./_url.js";

export const MAX_REFERENCES = 5;
export const DUREE_JETON_JOURS = 30;
/** Une relance, une seule, si la référence n'a pas répondu au bout de 7 jours. */
export const RELANCE_APRES_JOURS = 7;

/** Les messageries grand public : une adresse d'entreprise y est rare. */
const DOMAINES_PERSONNELS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr",
  "laposte.net", "aol.com", "gmx.fr", "gmx.com", "protonmail.com", "proton.me", "bbox.fr", "neuf.fr",
]);

export const normaliserEmail = (e) => String(e || "").trim().toLowerCase();
export const emailValide = (e) => /^[^\s@<>"']{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(normaliserEmail(e)) && normaliserEmail(e).length <= 160;
const domaineDe = (e) => normaliserEmail(e).split("@")[1] || "";

/** L'empreinte d'un jeton — la seule chose conservée en base. */
export const empreinte = (jeton) => createHash("sha256").update(String(jeton || "")).digest("hex");

/** Le jeton envoyé par e-mail, et son empreinte. */
export function genererJeton() {
  const jeton = randomBytes(32).toString("base64url");
  return { jeton, hash: empreinte(jeton) };
}

/**
 * La demande du prestataire, vérifiée. Les métiers acceptés sont ceux qu'il a
 * déclarés : le libellé vient du catalogue, pas d'une saisie libre.
 * @returns {{ok:true, valeur:object} | {ok:false, erreur:string}}
 */
export function validerReference(corps, { metiersDeclares = [], emailPrestataire = "", anneeCourante = new Date().getUTCFullYear() } = {}) {
  const non = (erreur) => ({ ok: false, erreur });
  const siret = String(corps?.siret || "").replace(/[\s.-]/g, "");
  if (!/^\d{14}$/.test(siret)) return non("Le SIRET de l'entreprise doit compter 14 chiffres.");
  const metier = String(corps?.metier || "");
  const libelles = metiersDeclares.map(m => (typeof m === "string" ? m : m?.metier)).filter(Boolean);
  if (!libelles.includes(metier)) return non("Choisissez un de vos métiers.");
  const debut = Number(corps?.annee_debut), fin = corps?.annee_fin === null || corps?.annee_fin === "" || corps?.annee_fin === undefined ? null : Number(corps.annee_fin);
  if (!Number.isInteger(debut) || debut < 1970 || debut > anneeCourante) return non("Année de début invalide.");
  if (fin !== null && (!Number.isInteger(fin) || fin < debut || fin > anneeCourante)) return non("Année de fin invalide.");
  const contactNom = String(corps?.contact_nom || "").trim().replace(/\s+/g, " ");
  if (contactNom.length < 2 || contactNom.length > 80 || /[<>@/:]/.test(contactNom)) return non("Nom de la référence invalide.");
  const contactEmail = normaliserEmail(corps?.contact_email);
  if (!emailValide(contactEmail)) return non("Adresse e-mail de la référence invalide.");
  if (contactEmail === normaliserEmail(emailPrestataire)) return non("La référence doit être une autre personne que vous.");
  if (corps?.accord !== true) return non("Confirmez que cette personne accepte d'être contactée par ALANE.");
  return { ok: true, valeur: { siret, metier, annee_debut: debut, annee_fin: fin, contact_nom: contactNom, contact_email: contactEmail } };
}

/**
 * L'entreprise d'après le registre SIRENE : { nom, actif } ou null si le SIRET
 * n'y figure pas. LÈVE si le registre ne répond pas — « introuvable » ne doit
 * jamais vouloir dire « pas pu lire ».
 */
export async function entrepriseSirene(siret) {
  const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siret)}&page=1&per_page=1`);
  if (!r.ok) throw new Error(`registre SIRENE indisponible (${r.status})`);
  const d = await r.json().catch(() => null);
  const e = d?.results?.[0];
  if (!e) return null;
  const etablissements = [e.siege, ...(Array.isArray(e.matching_etablissements) ? e.matching_etablissements : [])].filter(Boolean);
  if (!etablissements.some(x => x.siret === siret) && !String(siret).startsWith(String(e.siren || "-"))) return null;
  return { nom: String(e.nom_complet || e.nom_raison_sociale || "").slice(0, 160) || "Entreprise", actif: e.etat_administratif === "A" };
}

/** Ce que le back-office doit savoir de cette référence, ou null. */
export function alerteDe({ contactEmail, autresPrestataires = 0 }) {
  const alertes = [];
  if (DOMAINES_PERSONNELS.has(domaineDe(contactEmail))) alertes.push("adresse personnelle, pas celle d'une entreprise");
  if (autresPrestataires > 0) alertes.push(`ce contact est aussi la référence de ${autresPrestataires} autre(s) prestataire(s)`);
  return alertes.length ? alertes.join(" ; ") : null;
}

export const periodeDe = (debut, fin) => (fin && fin !== debut ? `de ${debut} à ${fin}` : fin === debut ? `en ${debut}` : `depuis ${debut}`);

/** Le message à la référence : tout y vient du serveur, et tout est échappé. */
export function courrielReference({ prenom, initiale, entreprise, metier, debut, fin, lien, relance = false }) {
  const qui = `${prenom || "Un prestataire"}${initiale ? ` ${initiale}.` : ""}`;
  return {
    subject: `${relance ? "Rappel — " : ""}${qui} vous cite comme référence — une minute pour confirmer ?`,
    html: emailHtml(`
      <p>Bonjour,</p>
      ${relance ? "<p><em>Nous vous avions écrit il y a une semaine ; voici un nouveau lien, le précédent n'est plus valable. C'est notre seul rappel.</em></p>" : ""}
      <p><strong>${esc(qui)}</strong> s'inscrit comme prestataire indépendant sur ALANE, une plateforme de mise en relation avec des professionnels vérifiés.
      Il ou elle indique avoir travaillé chez <strong>${esc(entreprise)}</strong> comme <strong>${esc(metier)}</strong>, ${esc(periodeDe(debut, fin))}, et vous cite comme référence.</p>
      <p>Pourriez-vous le confirmer ? Trois questions, une minute :</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${esc(lien)}" style="background:#4F46E5;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700">Répondre</a>
      </p>
      <p style="color:#666;font-size:13px">Vous ne connaissez pas cette personne ? Indiquez-le simplement : c'est tout aussi utile. Le lien est valable ${DUREE_JETON_JOURS} jours et ne sert qu'une fois.</p>
      <p style="color:#888;font-size:12px">Vos nom et adresse nous ont été donnés par cette personne, avec votre accord déclaré. ALANE ne s'en sert que pour cette vérification et les supprime avec le compte du prestataire. Pour toute question : support@alane.fr.</p>
    `),
  };
}

/**
 * La réponse de la référence, vérifiée.
 * @returns {{ok:true, valeur:object} | {ok:false, erreur:string}}
 */
export function validerReponse(corps) {
  if (typeof corps?.a_travaille !== "boolean") return { ok: false, erreur: "Indiquez si cette personne a travaillé avec vous." };
  const recommande = typeof corps?.recommande === "boolean" ? corps.recommande : null;
  const commentaire = String(corps?.commentaire || "").trim().slice(0, 500);
  const repondant = String(corps?.repondant || "").trim().slice(0, 80);
  return { ok: true, valeur: { a_travaille: corps.a_travaille, recommande: corps.a_travaille ? recommande : null, commentaire, repondant } };
}

/** Le lien a-t-il dépassé sa durée ? */
export const jetonExpire = (createdAt, maintenant = Date.now()) =>
  !(new Date(createdAt).getTime() + DUREE_JETON_JOURS * 86400000 > maintenant);

/**
 * Cette référence attend-elle sa relance ? En attente, envoyée une première
 * fois il y a 7 jours au moins, jamais relancée, lien encore valable.
 *
 * « Jamais relancée » se lit sans colonne de plus : la relance repousse
 * `envoyee_at`, qui s'écarte alors de plus d'un jour de `created_at`.
 */
export function aRelancer(ref, maintenantMs = Date.now()) {
  if (ref?.statut !== "en_attente" || !ref.envoyee_at || !ref.created_at) return false;
  const envoi = new Date(ref.envoyee_at).getTime(), creation = new Date(ref.created_at).getTime();
  if (!(envoi - creation < 86400000)) return false;
  if (maintenantMs - envoi < RELANCE_APRES_JOURS * 86400000) return false;
  return !jetonExpire(ref.created_at, maintenantMs);
}

/**
 * La relance du matin (tâche « documents » de cron-reset-monthly). Le jeton
 * n'étant conservé que par son empreinte, l'ancien lien ne peut pas être
 * renvoyé : un nouveau le remplace, et l'ancien cesse de valoir. Si l'e-mail
 * ne part pas, l'ancien est rétabli — personne ne se retrouve sans lien.
 * @returns {Promise<{relancees:number}>}
 */
export async function relancerReferences({ supabaseUrl, headers, maintenantMs = Date.now() }) {
  const bilan = { relancees: 0 };
  const table = `${supabaseUrl}/rest/v1/references_experience`;
  const avant = new Date(maintenantMs - RELANCE_APRES_JOURS * 86400000).toISOString();
  const candidates = (await lireTout(`${table}?statut=eq.en_attente&envoyee_at=lt.${encodeURIComponent(avant)}`
    + "&select=id,prestataire_id,entreprise,metier,annee_debut,annee_fin,contact_email,jeton_hash,envoyee_at,created_at", headers))
    .filter(r => aRelancer(r, maintenantMs));
  const ecrire = (ref, filtre, corps) => fetch(`${table}?id=eq.${ref.id}${filtre}`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" }, body: JSON.stringify(corps),
  });
  for (const ref of candidates.slice(0, 50)) {
    try {
      const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users/${ref.prestataire_id}`, { headers });
      const u = await ur.json().catch(() => ({}));
      if (!ur.ok) throw new Error(`compte ${ref.prestataire_id} illisible (${ur.status})`);
      const { jeton, hash } = genererJeton();
      const maintenantIso = new Date(maintenantMs).toISOString();
      // Conditionnée à l'ancienne empreinte : deux passages simultanés ne
      // relancent pas deux fois.
      const wr = await ecrire(ref, `&statut=eq.en_attente&jeton_hash=eq.${ref.jeton_hash}`, { jeton_hash: hash, envoyee_at: maintenantIso });
      const lignes = await wr.json().catch(() => null);
      if (!wr.ok) throw new Error(`nouveau lien non enregistré (${wr.status})`);
      if (!Array.isArray(lignes) || lignes.length === 0) continue;
      const meta = u?.user_metadata || {};
      const courriel = courrielReference({
        prenom: String(meta.prenom || "").trim(), initiale: String(meta.nom || "").trim().charAt(0).toUpperCase(),
        entreprise: ref.entreprise, metier: ref.metier, debut: ref.annee_debut, fin: ref.annee_fin,
        lien: `${appUrl()}/reference?t=${jeton}`,
        relance: true,
      });
      const envoye = await sendEmail({ to: ref.contact_email, subject: courriel.subject, html: courriel.html });
      if (envoye === true) { bilan.relancees++; continue; }
      const rr = await ecrire(ref, `&jeton_hash=eq.${hash}`, { jeton_hash: ref.jeton_hash, envoyee_at: ref.envoyee_at });
      console.error(`[references] relance de ${ref.id} NON envoyée (${envoye}) — ${rr.ok ? "ancien lien rétabli" : `ancien lien NON rétabli (${rr.status})`}`);
    } catch (e) {
      console.error(`[references] relance de ${ref.id} reportée :`, e.message);
    }
  }
  if (candidates.length) console.log(`[references] ${bilan.relancees} relance(s) sur ${candidates.length} référence(s) sans réponse`);
  return bilan;
}
