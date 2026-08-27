// ═══════════════════════════════════════════════════════════════════════════
// Heures supplémentaires — prix, et rien d'autre
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Les heures supplémentaires n'étaient facturées à PERSONNE. Le client
// demandait, le prestataire acceptait, et le code se contentait d'augmenter
// `hours`. Aucun paiement complémentaire n'était réclamé.
//
// À la clôture, `montantsDeCloture` calcule la part du prestataire depuis les
// heures, et les frais de service depuis ce qui reste du montant encaissé.
// Avec des heures gonflées et un encaissement inchangé, les deux dérivent
// ensemble :
//
//   1 h à 15 €/h, client débité 19,90 € (15 € + 4,90 € de frais)
//   → le client demande +1 h, le prestataire accepte
//   → dû au prestataire : 30,00 €   frais de service : 0,00 €
//   → ALANE verse 30 € pour 19,90 € encaissés, et perd ses frais au passage.
//
// Soit 10,10 € de perte sur une prolongation d'une heure. Sur une prestation
// de 8 h prolongée de 2 h à 25 €/h, la perte dépasse 50 €.
//
// D'où ce module : le prix d'une prolongation, écrit une fois, appelé par
// l'acceptation du prestataire, par la création du paiement et par sa
// confirmation. Trois endroits qui doivent annoncer le même chiffre.
//
// LES FRAIS DE SERVICE SUR UNE PROLONGATION
//
// La part FIXE n'est pas due une seconde fois : elle rémunère la mise en
// relation, qui a déjà eu lieu et qui est déjà payée. La part proportionnelle,
// elle, reste due — les CGPS disent qu'elle « couvre notamment les frais
// prélevés par le prestataire de services de paiement », et ces frais-là
// s'appliquent bien au nouvel encaissement.
//
// Avec cette seule part proportionnelle, les petites prolongations étaient
// déficitaires : 0,34 € encaissés sur une prolongation d'une heure à 17 €,
// pour environ 0,51 € de commission Stripe (1,5 % + 0,25 € fixes). D'où le
// plancher `minimum_prolongation`, ajouté le 27/08/2026. Ce n'est pas un taux
// plus élevé qu'il fallait : la commission fixe de Stripe est la même sur 17 €
// que sur 1 000 €, seuls les petits montants posaient problème.
//
// LE TARIF EST CELUI QUE LE PRESTATAIRE ANNONCE
//
// Il fixe librement son prix (CGPS art. 6.1), et une prolongation qu'il n'avait
// pas prévue n'a pas de raison d'être vendue au tarif d'un créneau réservé à
// l'avance. Le client voit le montant exact avant de payer, et reste libre de
// refuser : rien ne s'applique tant qu'il n'a pas réglé.
// ═══════════════════════════════════════════════════════════════════════════

import { FRAIS_PAR_DEFAUT } from "./_montant.js";

// Bornes du tarif proposé pour une prolongation.
//
// Le plancher évite le tarif nul ou négatif. Le plafond est un garde-fou contre
// la faute de frappe — 150 € au lieu de 15 € — pas un encadrement des prix :
// il est très au-dessus de tout tarif légitime de la plateforme.
export const TARIF_SUPP_MIN = 1;
export const TARIF_SUPP_MAX = 500;

/** Le tarif proposé est-il utilisable ? */
export function tarifSuppValide(tarif) {
  const t = Number(tarif);
  return Number.isFinite(t) && t >= TARIF_SUPP_MIN && t <= TARIF_SUPP_MAX;
}

/**
 * Prix d'une prolongation.
 *
 * @param {number} heures   nombre d'heures supplémentaires
 * @param {number} tarif    tarif horaire annoncé par le prestataire
 * @param {number} jours    nombre de jours de la prestation (récurrente)
 * @param {object} frais    grille de frais, telle que lue par `lireFraisService`
 * @returns {{partPrestataire:number, fraisService:number, total:number, centimes:number}}
 *
 * Retourne des montants nuls si les entrées ne permettent pas de calculer :
 * l'appelant doit alors refuser plutôt que d'encaisser un montant deviné.
 */
export function prixHeuresSupp(heures, tarif, jours = 1, frais = FRAIS_PAR_DEFAUT) {
  const h = Number(heures);
  const t = Number(tarif);
  const j = Math.max(1, Number(jours) || 1);
  if (!(h > 0) || !tarifSuppValide(t)) {
    return { partPrestataire: 0, fraisService: 0, total: 0, centimes: 0 };
  }

  const partPrestataire = Math.round(h * t * j * 100) / 100;

  // Part proportionnelle seule — voir l'en-tête. La grille vit dans
  // `_montant.js` ; on lit son pourcentage plutôt que d'en écrire un second.
  const bareme = { ...FRAIS_PAR_DEFAUT, ...(frais || {}) };
  const pourcentage = Number(bareme.pourcentage) || 0;
  const proportionnel = Math.round(partPrestataire * pourcentage) / 100;

  // Plancher. Les 2 % seuls ne couvraient pas la commission fixe de Stripe sur
  // les petits montants : 0,34 € encaissés sur une prolongation à 17 € pour
  // environ 0,51 € prélevés. ALANE payait pour prolonger. Le plancher cesse de
  // jouer dès que les 2 % le dépassent — au-delà de 45 € avec les valeurs par
  // défaut. Il ne peut jamais dépasser la part du prestataire : mieux vaut
  // renoncer aux frais que facturer une prolongation plus chère qu'elle ne
  // rapporte à celui qui la réalise.
  const minimum = Math.max(0, Number(bareme.minimum_prolongation) || 0);
  const fraisService = Math.round(Math.min(Math.max(proportionnel, minimum), partPrestataire) * 100) / 100;

  const total = Math.round((partPrestataire + fraisService) * 100) / 100;
  return { partPrestataire, fraisService, total, centimes: Math.round(total * 100) };
}
