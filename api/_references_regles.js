// ═══════════════════════════════════════════════════════════════════════════
// Les règles des références d'expérience que l'écran partage avec le serveur
// ═══════════════════════════════════════════════════════════════════════════
//
// Sans dépendance (ni crypto, ni e-mail) : l'écran du prestataire les importe.
// Il recopiait « 30 jours » et le filtre des demandes vivantes à la main — avec
// une borne différente du serveur (relecture du 10/11/2026).

export const MAX_REFERENCES = 5;
export const DUREE_JETON_JOURS = 30;

/** Le lien a-t-il dépassé sa durée ? */
export const jetonExpire = (createdAt, maintenant = Date.now()) =>
  !(new Date(createdAt).getTime() + DUREE_JETON_JOURS * 86400000 > maintenant);

/**
 * La demande compte-t-elle encore — dans le plafond, et comme doublon ?
 * Confirmée, refusée, ou en attente dont le lien vaut encore.
 */
export const referenceVivante = (ref, maintenant = Date.now()) =>
  ref?.statut === "confirmee" || ref?.statut === "refusee"
  || (ref?.statut === "en_attente" && !jetonExpire(ref.created_at, maintenant));

/** Le statut à montrer : une demande au lien expiré est « sans réponse », même avant le balayage. */
export const statutAffiche = (ref, maintenant = Date.now()) =>
  ref?.statut === "en_attente" && jetonExpire(ref.created_at, maintenant) ? "expiree" : ref?.statut;
