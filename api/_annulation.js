// ═══════════════════════════════════════════════════════════════════════════
// Annulation par le client : les frais de service sont-ils retenus ?
// ═══════════════════════════════════════════════════════════════════════════
//
// En principe, oui (CGPS art. 8.1) : ils rémunèrent la mise en relation, déjà
// effectuée. Deux cas font exception, où le client est remboursé de tout :
//
//   - la défaillance du prestataire (CGPS art. 8.2) : son retard au démarrage
//     dépasse le seuil, que `cancel_client` calcule (api/missions.js) ;
//   - PERSONNE N'A ÉTÉ TROUVÉ (décision D2 d'Alexandre, 14/10/2026). La
//     réservation payée est repartie en recherche — « open », quand la cascade
//     des candidats ou l'affectation par ALANE n'a trouvé personne — ou attend
//     un remplaçant — « needs_replacement », quand son prestataire s'est
//     désisté. La mise en relation n'a produit personne. À l'heure de début, la
//     tâche planifiée l'annule déjà et rend tout (api/cron-reset-monthly.js) ;
//     le client qui annulait lui-même avant cette heure se voyait, lui, retenir
//     ses frais.
// ═══════════════════════════════════════════════════════════════════════════

/** Statuts d'une réservation qu'aucun prestataire ne tient. */
export const STATUTS_SANS_PRESTATAIRE = ["open", "needs_replacement"];

/** Réservation PAYÉE que personne n'a reprise. */
export function sansPrestataireTrouve(mission) {
  return !!mission?.stripe_payment_intent && STATUTS_SANS_PRESTATAIRE.includes(mission?.status);
}

/**
 * Les frais de service sont-ils retenus sur l'annulation de ce client ?
 * `retardPrestataire` : le seuil de retard du prestataire est atteint.
 */
export function fraisRetenusAnnulationClient(mission, { retardPrestataire = false } = {}) {
  return !retardPrestataire && !sansPrestataireTrouve(mission);
}
