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
 * Part horaire due au prestataire, tarif des heures supplémentaires compris.
 *
 * Une prestation prolongée porte DEUX tarifs : celui convenu à la commande, et
 * celui que le prestataire a annoncé pour la prolongation (CGPS art. 6.2). Les
 * calculer sur le seul `tarif_horaire` lui prend l'écart : une heure ajoutée à
 * 17 € sur une prestation à 15 € lui coûtait 2 €, et faisait paraître des frais
 * de service qu'ALANE n'avait pas encaissés.
 *
 * Le supplément est plafonné aux heures retenues, et c'est la part de BASE qui
 * absorbe une éventuelle réduction pour décalage d'horaire : le retard concerne
 * le début de la prestation, pas la prolongation acceptée en cours de route.
 *
 * @param {object} m       la prestation
 * @param {number} heures  heures retenues (réelles, prévues, ou plafonnées)
 * @param {number} jours   nombre de jours de la prestation
 */
export function partHoraire(m, heures, jours) {
  const h = Math.max(0, Number(heures) || 0);
  const tarif = Number(m?.tarif_horaire || 0);
  const supp = Math.min(h, Math.max(0, Number(m?.extra_hours_appliquees) || 0));
  const tarifSupp = Number(m?.extra_hours_tarif) > 0 ? Number(m.extra_hours_tarif) : tarif;
  const base = h - supp;
  return Math.round((base * tarif + supp * tarifSupp) * (Number(jours) || 1) * 100) / 100;
}

/**
 * Montants dus à la clôture d'une prestation.
 *
 * @param {object} m  la prestation, telle que lue en base. `heures_perdues`,
 *                     s'il est renseigné, retire de la part du prestataire les
 *                     heures convenues comme non effectuées.
 * @returns {{
 *   heuresEffectives:number, jours:number, partPrestataire:number,
 *   fraisService:number, totalClient:number,
 *   ajustementRetard:{avant:number, apres:number, retard:number, unJour?:boolean}|null,
 *   deductions:{heuresPerdues:number, valeurPerdue:number, valeurRetardUnJour:number}
 * }}
 */
export function montantsDeCloture(m) {
  const jours        = nombreDeJours(m);

  let heuresEffectives = Number(m?.actual_hours ?? m?.hours ?? 0) || 0;
  let ajustementRetard = null;

  // Décalage d'horaire jamais arbitré par le client : la prestation est facturée
  // jusqu'à l'heure de fin initialement prévue, pas au-delà. Un refus explicite
  // (`rejected`) a déjà ajusté `actual_hours` (un jour) ou `heures_perdues`
  // (plusieurs jours) en amont — `hours`, la durée réservée, ne bouge pas.
  //
  // L'ajustement est renvoyé plutôt qu'appliqué en silence : une réduction que
  // l'intéressé découvre sans explication ni recours n'est plus un ajustement de
  // prix, c'est une sanction.
  //
  // Sur plusieurs jours, le retard ne touche que LA journée où il a été mesuré
  // (le démarrage n'est pointé qu'une fois) : il se déduit une fois, en montant,
  // et non de la durée par jour — qui l'aurait retiré à chaque journée (étude du
  // 13/10/2026 : une heure de retard le lundi coûtait cinq heures sur cinq jours).
  // Rien n'est alors réécrit en base par les appelants (`unJour`) : le calcul
  // reste le même à chaque relecture tant que le décalage n'est pas arbitré.
  let valeurRetardUnJour = 0;
  if (m?.delay_status === "pending") {
    const retardH = (Number(m.arrival_delay_minutes) || 0) / 60;
    const plafonnees = Math.max(0, Math.round((Number(m.hours || 0) - retardH) * 10000) / 10000);
    if (plafonnees < heuresEffectives) {
      ajustementRetard = { avant: heuresEffectives, apres: plafonnees, retard: Number(m.arrival_delay_minutes) || 0 };
      if (jours > 1) {
        ajustementRetard.unJour = true;
        valeurRetardUnJour = Math.round((partHoraire(m, heuresEffectives, 1) - partHoraire(m, plafonnees, 1)) * 100) / 100;
      } else {
        heuresEffectives = plafonnees;
      }
    }
  }

  // Heures convenues comme non faites, à la suite d'une interruption de journée
  // (07/09/2026). Elles se déduisent de la part du prestataire : sans cela, une
  // prestation récurrente reprise le lendemain paierait à la clôture des heures
  // dont le client et le prestataire étaient convenus qu'elles ne seraient pas
  // effectuées.
  //
  // La déduction porte sur le MONTANT et non sur les heures : `heures_perdues`
  // est un total sur toute la prestation, alors que `heuresEffectives` est un
  // nombre d'heures PAR JOUR. Les soustraire l'une de l'autre mêlerait deux
  // unités et retirerait la perte autant de fois qu'il y a de jours.
  const heuresPerdues = Math.max(0, Number(m?.heures_perdues) || 0);
  const valeurPerdue = Math.round(heuresPerdues * (Number(m?.tarif_horaire) || 0) * 100) / 100;

  // Heures ajoutées à certaines journées seulement (prestation de plusieurs
  // jours, 06/10/2026) : cumulées en MONTANT, au tarif annoncé à chaque fois,
  // indépendamment de `hours` — qui vaut pour toutes les journées.
  const ajoutJournees = Math.max(0, Number(m?.montant_heures_ajoutees) || 0);

  const partPrestataire = Math.max(
    0,
    Math.round((partHoraire(m, heuresEffectives, jours) + ajoutJournees - valeurPerdue - valeurRetardUnJour) * 100) / 100
  );

  // Frais de service réellement encaissés : ce qui a été payé, moins la part
  // horaire prévue. On les déduit de l'encaissement plutôt que de reproduire ici
  // la grille tarifaire du tunnel de commande — une grille recopiée finit par
  // diverger. Ils sont conservés même si la durée réelle diffère de la prévue :
  // ils rémunèrent la mise en relation, pas les heures.
  const totalPaye  = Number(m?.montant_total || 0);
  const partPrevue = partHoraire(m, Number(m?.hours) || 0, jours) + ajoutJournees;
  const fraisService = (partPrevue > 0 && totalPaye > partPrevue)
    ? Math.round((totalPaye - partPrevue) * 100) / 100
    : 0;

  const totalClient = Math.round((partPrestataire + fraisService) * 100) / 100;

  // Ce qui est retiré de la part horaire, en montant : la facture le montre.
  const deductions = { heuresPerdues, valeurPerdue, valeurRetardUnJour };
  return { heuresEffectives, jours, partPrestataire, fraisService, totalClient, ajustementRetard, deductions };
}
