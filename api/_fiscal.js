// ═══════════════════════════════════════════════════════════════════════════
// Obligations d'information fiscale de l'opérateur de plateforme
// (article 242 bis du Code général des impôts)
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// L'article 242 bis met deux obligations distinctes à la charge de l'opérateur
// de plateforme, et elles ne se confondent pas :
//
//   • À CHAQUE TRANSACTION — une information « loyale, claire et transparente »
//     sur les obligations fiscales et sociales qui incombent à celui qui perçoit
//     les sommes. Les CGPS rappelaient bien que le prestataire est responsable
//     de ses déclarations ; ce n'est pas ce que le texte demande. Il demande une
//     information délivrée AU MOMENT de la transaction, pas une clause acceptée
//     une fois pour toutes à l'inscription.
//
//   • EN JANVIER — un récapitulatif du montant brut perçu l'année précédente,
//     adressé à chaque utilisateur concerné.
//
// Le texte de l'information et le calcul du récapitulatif vivent ici, pour ne
// pas être recopiés dans les cinq endroits qui les affichent — c'est ainsi que
// naissent les versions divergentes, dont ce projet a déjà payé le prix.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Information fiscale et sociale délivrée au prestataire à chaque transaction.
 *
 * Rédigée pour être comprise par un auto-entrepreneur qui n'est pas comptable :
 * ce qu'il doit faire, où, et à quel rythme. Une information exacte mais
 * illisible ne remplit pas l'obligation de « loyale, claire et transparente ».
 *
 * Volontairement sans montant ni seuil chiffré : les plafonds changent, et un
 * chiffre périmé dans une mention légale est pire que pas de chiffre du tout.
 */
export const INFORMATION_FISCALE = {
  titre: "Vos obligations fiscales et sociales",
  texte:
    "Les sommes que vous percevez via ALANE constituent le chiffre d'affaires de votre "
    + "activité indépendante. Il vous appartient de les déclarer, ALANE ne le faisant pas "
    + "à votre place :\n\n"
    + "• à l'URSSAF, pour vos cotisations sociales, selon la périodicité que vous avez "
    + "choisie à votre immatriculation (mensuelle ou trimestrielle) ;\n"
    + "• à l'administration fiscale, dans votre déclaration de revenus annuelle.\n\n"
    + "Vous devez également surveiller les seuils de votre régime : leur dépassement "
    + "entraîne un changement de statut et, le cas échéant, l'assujettissement à la TVA.\n\n"
    + "ALANE déclare chaque année à l'administration fiscale les sommes qui vous ont été "
    + "versées, et vous en adresse une copie en janvier.",
  liens: [
    { libelle: "Déclarer et payer vos cotisations", url: "https://www.autoentrepreneur.urssaf.fr" },
    { libelle: "Vos impôts", url: "https://www.impots.gouv.fr" },
  ],
};

/**
 * Récapitulatif annuel d'un prestataire — article 242 bis, II.
 *
 * Ne retient que les prestations RÉELLEMENT VERSÉES : une prestation en attente
 * ou retenue n'a pas été perçue, et la faire figurer gonflerait un chiffre
 * d'affaires que l'intéressé recopiera dans sa déclaration.
 *
 * Le montant brut est celui figé au versement (`payout_amount`), jamais un
 * recalcul : c'est la somme qui a quitté ALANE, donc celle qu'il retrouvera sur
 * son relevé bancaire. Les retenues opérées au titre de l'article 8B.3 sont
 * comptées à part — elles font partie du chiffre d'affaires perçu, même si elles
 * n'ont pas transité par sa banque.
 *
 * @param {Array} missions  prestations de l'année, déjà filtrées sur le prestataire
 * @returns {{ operations:number, brut:number, retenues:number, verse:number }}
 */
export function recapitulatifAnnuel(missions) {
  const enC = (v) => Math.round(Number(v || 0) * 100);
  let operations = 0, brutC = 0, retenuesC = 0;

  for (const m of (Array.isArray(missions) ? missions : [])) {
    if (m?.payout_status !== "transferred") continue;
    operations += 1;
    brutC     += enC(m.payout_amount);
    retenuesC += enC(m.payout_compensation);
  }

  return {
    operations,
    brut:     Math.round(brutC) / 100,
    retenues: Math.round(retenuesC) / 100,
    // Ce qui est réellement arrivé sur son compte bancaire. La différence avec le
    // brut n'est pas une erreur : c'est ce qui a été retenu, et il doit pouvoir
    // la retrouver sans nous appeler.
    verse:    Math.round(brutC - retenuesC) / 100,
  };
}

/**
 * L'année sur laquelle porte le récapitulatif à envoyer maintenant.
 *
 * L'obligation vise « le mois de janvier » et porte sur l'année précédente.
 * Renvoie null hors janvier : envoyer un récapitulatif en juillet ne remplit
 * aucune obligation et sème le doute chez celui qui le reçoit.
 */
export function anneeARecapituler(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : null;
}

/**
 * Ce prestataire a-t-il déjà reçu le récapitulatif de cette année-là ?
 *
 * Le champ ne porte qu'une date d'envoi : on compare donc l'année civile de
 * l'envoi à celle qui suit l'année récapitulée. Sans ce contrôle, le traitement
 * passant toutes les deux heures enverrait le même courriel des centaines de
 * fois en janvier.
 */
export function recapitulatifDejaEnvoye(recapitulatifAnnuelAt, annee) {
  if (!recapitulatifAnnuelAt) return false;
  const d = new Date(recapitulatifAnnuelAt);
  if (isNaN(d.getTime())) return false;
  return d.getUTCFullYear() >= annee + 1;
}
