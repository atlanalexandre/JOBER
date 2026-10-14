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
//     le message précédent de cet expéditeur, et pas plus d'un par demi-heure dans
//     une même conversation. La notification dans l'application suit, elle,
//     chaque message.
// ═══════════════════════════════════════════════════════════════════════════

/** Deux messages plus rapprochés forment une rafale : une seule alerte. */
export const DELAI_RAFALE_MS = 30 * 60 * 1000;
/** Un message resté non lu plus longtemps peut être rappelé une fois. */
export const DELAI_NON_LU_MS = 24 * 3600 * 1000;

/**
 * Faut-il prévenir AUSSI par e-mail et SMS ?
 * `precedent` : le message précédent du même expéditeur dans la conversation
 * (`created_at`, `lu_at`), ou null s'il n'y en a pas.
 */
export function alerteExterieureDue(precedent, maintenantMs = Date.now()) {
  if (!precedent) return true;
  const age = maintenantMs - new Date(precedent.created_at).getTime();
  // Date illisible : on ne sait pas si le destinataire vient d'être prévenu.
  if (!Number.isFinite(age)) return false;
  // Le précédent attend encore d'être lu : il a déjà donné lieu à une alerte.
  if (!precedent.lu_at && age < DELAI_NON_LU_MS) return false;
  return age >= DELAI_RAFALE_MS;
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
