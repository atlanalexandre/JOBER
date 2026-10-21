// ═══════════════════════════════════════════════════════════════════════════
// Messagerie : prévenir le destinataire d'un message (décision D5, 14/10/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// La notification partait d'un appel séparé (`chat_notify`), auquel le
// navigateur fournissait le nom de l'expéditeur et le texte. ALANE envoyait ainsi
// par e-mail et par SMS, à son nom, un texte libre sans lien avec un message
// enregistré, et autant de fois qu'on l'appelait. Une partie à une prestation
// pouvait faire recevoir à l'autre un SMS « ALANE » de son choix (hameçonnage),
// et chaque SMS se paie.
//
// Le serveur prévient désormais lui-même, à l'enregistrement du message
// (`envoyer_message`) :
//   - l'expéditeur est lu dans son profil, jamais dans la requête, et réduit à
//     des lettres : un prénom ne porte ni lien ni numéro de téléphone ;
//   - l'e-mail cite le message réellement enregistré ;
//   - le SMS ne contient AUCUN texte libre : il dit qu'un message attend, et de qui ;
//   - e-mail et SMS sont plafonnés : un seul tant que le destinataire n'a pas lu
//     depuis la dernière alerte (un rappel par jour), et un seul par
//     rafale — des messages à moins d'une demi-heure les uns des autres. La
//     notification dans l'application suit, elle, chaque message.
//
// La règle se rejoue sur les messages des dernières 24 h (relecture du
// 15/10/2026). Elle ne regardait que le message précédent, et tenait un message
// non lu pour « déjà signalé » — or il avait pu être retenu par la demi-heure :
// message lu, deux autres envoyés à dix minutes puis à une heure, et le
// destinataire n'était plus prévenu ni par e-mail ni par SMS pendant 24 h.
// ═══════════════════════════════════════════════════════════════════════════

import { dateDuJourFr } from "./_temps.js";

/** Deux messages plus rapprochés forment une rafale : une seule alerte. */
export const DELAI_RAFALE_MS = 30 * 60 * 1000;
/** Sans alerte depuis ce délai, le message suivant en déclenche une. L'historique
 *  lu ne remontant qu'à 24 h, c'est en pratique « premier message depuis 24 h » ;
 *  le rappel d'un message non lu suit la règle du jour, plus bas. */
export const DELAI_NON_LU_MS = 24 * 3600 * 1000;

/** Au-delà, l'historique d'une journée est une avalanche : on ne prévient plus au dehors. */
export const HISTORIQUE_MAX = 200;

/**
 * Faut-il prévenir AUSSI par e-mail et SMS ?
 *
 * `historique` : les messages précédents du même expéditeur dans la
 * conversation, des dernières 24 h (`created_at`, `lu_at`), du plus ancien au
 * plus récent — ou un seul message, ou null. La règle y est rejouée pour
 * retrouver la dernière alerte réellement partie :
 *   - aucune depuis 24 h : alerte (un rappel, si rien n'a été lu depuis) ;
 *   - le destinataire a lu depuis la dernière alerte : alerte si le message
 *     précédent a une demi-heure ou plus — une rafale ne donne qu'une alerte ;
 *   - rien lu depuis : un rappel au premier message d'un autre jour que la
 *     dernière alerte (heure de Paris), hors rafale ; sinon rien.
 * Deux alertes ont donc toujours au moins une demi-heure d'écart.
 * Rien n'est enregistré de plus : les messages et leur `lu_at` suffisent.
 */
export function alerteExterieureDue(historique, maintenantMs = Date.now()) {
  const h = Array.isArray(historique) ? historique : (historique ? [historique] : []);
  const temps = h.map(m => ({ cree: Date.parse(m?.created_at), lu: Date.parse(m?.lu_at) }));
  // Date illisible : on ne sait pas si le destinataire vient d'être prévenu.
  if (temps.some(t => !Number.isFinite(t.cree)) || !Number.isFinite(maintenantMs)) return false;
  let derniere = null;   // la dernière alerte rejouée
  let precedent = null;  // le message précédent
  const due = (t) => {
    if (derniere === null || t - derniere >= DELAI_NON_LU_MS) return true;
    // Lu depuis la dernière alerte — connu à l'instant t ?
    const luDepuis = temps.some(x => Number.isFinite(x.lu) && x.lu > derniere && x.lu <= t);
    if (luDepuis) return t - precedent >= DELAI_RAFALE_MS;
    // Rien lu : un rappel par jour, au premier message d'une nouvelle journée
    // (heure de Paris). « 24 h après la dernière alerte » ne se retrouvait pas :
    // l'historique lu ne remonte qu'à 24 h, et le rejeu prend son premier
    // message pour une alerte — le rappel ne partait jamais tant que
    // l'expéditeur écrivait au moins une fois par jour (relecture du 16/10/2026).
    // Comparé au jour de la DERNIÈRE ALERTE, pas du message précédent : un
    // premier message du jour trop proche de l'alerte de la veille ne fait plus
    // sauter le rappel de toute la journée. Et hors rafale : une rafale qui
    // passe minuit ne donne pas un second e-mail (relecture du 20/10/2026).
    return dateDuJourFr(t) !== dateDuJourFr(derniere) && t - precedent >= DELAI_RAFALE_MS;
  };
  for (const t of temps) {
    if (due(t.cree)) derniere = t.cree;
    precedent = t.cree;
  }
  return due(maintenantMs);
}

/** « Prénom N. », lu dans le profil, réduit à des lettres (30 caractères au plus). */
export function nomExpediteur(profil, tag) {
  const propre = (s) => String(s || "").replace(/[^\p{L}\s'’-]/gu, "").replace(/\s+/g, " ").trim();
  const prenom = propre(profil?.prenom).slice(0, 30).trim();
  const initiale = propre(profil?.nom).charAt(0).toUpperCase();
  if (prenom) return initiale ? `${prenom} ${initiale}.` : prenom;
  return tag === "client" ? "votre client" : "votre prestataire";
}

/** Le SMS : le nom de l'expéditeur, et rien d'autre de sa main. */
export function texteSmsMessage(nom) {
  return `ALANE - Nouveau message de ${nom} dans votre messagerie. Ouvrez l'application pour le lire. alane.fr`;
}
