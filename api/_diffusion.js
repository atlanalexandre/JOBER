// Message d'information à tous les inscrits (13/10/2026, demande d'Alexandre).
//
// Le back-office n'avait que deux envois groupés, et aucun ne joignait tout le
// monde : la « Communication globale » ne part qu'aux prestataires validés qui
// ont consenti à la prospection (art. L.34-5 du CPCE), la « Notification
// in-app » qu'aux comptes validés — et pas par e-mail. Un message comme
// « la plateforme ouvre bientôt » ne touchait donc ni les clients par e-mail,
// ni les prestataires dont le dossier attend encore sa validation.
//
// Cet envoi-ci informe sur le service auquel la personne s'est inscrite. Il ne
// doit porter AUCUNE offre commerciale : ce serait de la prospection, réservée
// à la « Communication globale ».

import { emailHtml, esc, resendBody } from "./_email.js";

// Un compte écarté par l'administration n'a pas à recevoir de nouvelles.
export const STATUTS_EXCLUS = ["rejected", "suspended"];
// Resend accepte au plus 100 e-mails par appel à /emails/batch.
export const TAILLE_LOT = 100;
// Pause entre deux lots : Resend limite la cadence (2 appels par seconde par défaut).
export const PAUSE_ENTRE_LOTS_MS = 600;
// Au-delà, l'envoi ne tient plus dans la durée d'une fonction (60 s) : chaque
// lot coûte la pause plus l'appel à Resend (jusqu'à une seconde), sans compter
// la lecture des comptes. À 4 000 — le plafond d'origine —, 40 lots pouvaient
// dépasser la minute : la fonction s'arrêtait au milieu, sans journal, et un
// second appui renvoyait l'e-mail à ceux qui l'avaient reçu (relecture du
// 14/10/2026). 2 000, soit 20 lots, laisse la marge.
export const MAX_DESTINATAIRES = 2000;

/**
 * Adresses à joindre : chaque compte Auth qui a une adresse, sauf les comptes
 * refusés ou suspendus, les comptes bannis, et — par défaut — les adresses
 * jamais confirmées. Une adresse jamais confirmée peut être mal saisie : les
 * rejets qu'elle provoque abaissent la réputation du domaine, et ce sont alors
 * TOUS les e-mails d'ALANE (confirmations, factures) qui partent en indésirables.
 *
 * Rend { adresses, ecartees: { non_confirmees, refusees_ou_suspendues, bannies } }.
 */
export function destinatairesInformation(utilisateurs, profils, { inclureNonConfirmees = false, maintenant = Date.now() } = {}) {
  const statutParId = new Map((Array.isArray(profils) ? profils : []).map(p => [p.id, p.status]));
  const vues = new Set();
  const adresses = [];
  const ecartees = { non_confirmees: 0, refusees_ou_suspendues: 0, bannies: 0 };
  for (const u of Array.isArray(utilisateurs) ? utilisateurs : []) {
    const email = String(u?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@") || vues.has(email)) continue;
    if (STATUTS_EXCLUS.includes(statutParId.get(u.id))) { ecartees.refusees_ou_suspendues++; continue; }
    if (u.banned_until && Date.parse(u.banned_until) > maintenant) { ecartees.bannies++; continue; }
    if (!u.email_confirmed_at && !inclureNonConfirmees) { ecartees.non_confirmees++; continue; }
    vues.add(email);
    adresses.push(email);
  }
  return { adresses, ecartees };
}

/** Le corps HTML du message : le texte saisi, échappé, paragraphe par paragraphe. */
export function htmlInformation(message) {
  const paragraphes = String(message || "").trim().split(/\n\s*\n/)
    .map(p => `<p>${esc(p.trim()).replace(/\n/g, "<br/>")}</p>`).join("");
  return emailHtml(paragraphes);
}

/** Découpe en lots d'au plus `taille` éléments. */
export function enLots(liste, taille = TAILLE_LOT) {
  const lots = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}

/**
 * Envoie un e-mail par adresse — jamais une adresse en copie d'une autre —
 * par lots de 100 via /emails/batch. Rend { envoyes, echecs, erreur }.
 * Un lot refusé est réessayé une fois s'il s'agit d'une erreur serveur ou d'un
 * dépassement de cadence (429) ; les suivants continuent.
 */
export async function envoyerInformation(adresses, { sujet, html }, { fetchImpl = fetch, pause = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const key  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!key) {
    console.error(`[diffusion] RESEND_API_KEY absente — « ${sujet} » NON envoyé à ${adresses.length} adresse(s).`);
    return { envoyes: 0, echecs: adresses.length, erreur: "Envoi d'e-mails non configuré (clé Resend absente)" };
  }
  let envoyes = 0, echecs = 0;
  for (const [n, lot] of enLots(adresses).entries()) {
    const corps = `[${lot.map(to => resendBody({ from, to: [to], subject: sujet, html })).join(",")}]`;
    let accepte = false;
    for (let essai = 0; essai < 2 && !accepte; essai++) {
      try {
        const r = await fetchImpl("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: corps,
        });
        if (r.ok) { accepte = true; break; }
        const detail = await r.text().catch(() => "");
        console.error(`[diffusion] lot ${n + 1} REFUSÉ par Resend (essai ${essai + 1}) : ${r.status} ${detail.slice(0, 300)}`);
        if (r.status < 500 && r.status !== 429) break;
      } catch (e) {
        console.error(`[diffusion] lot ${n + 1} : échec réseau (essai ${essai + 1}) :`, e.message);
      }
      if (essai === 0) await pause(1500);
    }
    if (accepte) envoyes += lot.length; else echecs += lot.length;
    // Resend limite la cadence (2 appels par seconde par défaut).
    await pause(PAUSE_ENTRE_LOTS_MS);
  }
  return { envoyes, echecs, erreur: echecs ? `${echecs} adresse(s) non envoyée(s) — voir les journaux Vercel` : null };
}
