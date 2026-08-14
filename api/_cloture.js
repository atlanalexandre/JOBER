// ═══════════════════════════════════════════════════════════════════════════
// Montants d'une prestation à sa clôture
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Une prestation se clôture par deux chemins : la validation par le client
// (api/missions.js, action « complete ») et l'auto-validation 24 h après la fin
// (api/cron-reset-monthly.js). Les deux calculaient les mêmes montants, chacun
// de son côté, et ils avaient divergé :
//
//   • le cron omettait le nombre de JOURS. Sur une prestation récurrente de
//     cinq jours, il retenait une seule journée ;
//   • le cron écrasait `montant_total` par la seule part horaire, effaçant les
//     frais de service déjà encaissés — donc la trace de ce que le client avait
//     réellement payé, sur laquelle se calculent ensuite la facture et tout
//     remboursement ;
//   • le cron ignorait le plafonnement des heures dû à un décalage d'horaire
//     jamais arbitré par le client.
//
// C'est le défaut récurrent du projet : une règle appliquée sur un chemin et
// pas sur l'autre. Le calcul vit désormais ici, et les deux chemins l'appellent.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nombre de jours facturés d'une prestation (les prestations multi-dates
 * comptent un jour par date).
 */
export function nombreDeJours(m) {
  return (m?.date_debut && m?.date_fin)
    ? Math.max(1, Math.round((new Date(m.date_fin) - new Date(m.date_debut)) / 86400000) + 1)
    : 1;
}

/**
 * Montants dus à la clôture d'une prestation.
 *
 * @param {object} m  la prestation, telle que lue en base
 * @returns {{
 *   heuresEffectives:number, jours:number, partPrestataire:number,
 *   fraisService:number, totalClient:number,
 *   ajustementRetard:{avant:number, apres:number, retard:number}|null
 * }}
 */
export function montantsDeCloture(m) {
  const jours        = nombreDeJours(m);
  const tarifHoraire = Number(m?.tarif_horaire || 0);

  let heuresEffectives = Number(m?.actual_hours ?? m?.hours ?? 0) || 0;
  let ajustementRetard = null;

  // Décalage d'horaire jamais arbitré par le client : la prestation est facturée
  // jusqu'à l'heure de fin initialement prévue, pas au-delà. Un refus explicite
  // (`rejected`) a déjà ajusté `hours` et `actual_hours` en amont.
  //
  // L'ajustement est renvoyé plutôt qu'appliqué en silence : une réduction que
  // l'intéressé découvre sans explication ni recours n'est plus un ajustement de
  // prix, c'est une sanction.
  if (m?.delay_status === "pending") {
    const retardH = (Number(m.arrival_delay_minutes) || 0) / 60;
    const plafonnees = Math.max(0, Math.round((Number(m.hours || 0) - retardH) * 100) / 100);
    if (plafonnees < heuresEffectives) {
      ajustementRetard = { avant: heuresEffectives, apres: plafonnees, retard: Number(m.arrival_delay_minutes) || 0 };
      heuresEffectives = plafonnees;
    }
  }

  const partPrestataire = Math.round(heuresEffectives * tarifHoraire * jours * 100) / 100;

  // Frais de service réellement encaissés : ce qui a été payé, moins la part
  // horaire prévue. On les déduit de l'encaissement plutôt que de reproduire ici
  // la grille tarifaire du tunnel de commande — une grille recopiée finit par
  // diverger. Ils sont conservés même si la durée réelle diffère de la prévue :
  // ils rémunèrent la mise en relation, pas les heures.
  const totalPaye  = Number(m?.montant_total || 0);
  const partPrevue = Math.round((Number(m?.hours) || 0) * tarifHoraire * jours * 100) / 100;
  const fraisService = (partPrevue > 0 && totalPaye > partPrevue)
    ? Math.round((totalPaye - partPrevue) * 100) / 100
    : 0;

  const totalClient = Math.round((partPrestataire + fraisService) * 100) / 100;

  return { heuresEffectives, jours, partPrestataire, fraisService, totalClient, ajustementRetard };
}
