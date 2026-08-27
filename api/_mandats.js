// ═══════════════════════════════════════════════════════════════════════════
// Les deux mandats du prestataire
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI ILS CONDITIONNENT L'ACCÈS AUX PRESTATIONS
//
// L'article 7.2 des CGPS annonce que le mandat d'encaissement est recueilli
// « préalablement à tout encaissement ». Rien ne le vérifiait : ALANE encaissait
// et versait pour le compte de gens qui n'avaient rien signé. Et sans mandat de
// facturation, `api/invoice.js` n'émet qu'une attestation sans numéro — pas une
// facture opposable à la comptabilité du prestataire.
//
// Le contrôle est posé à l'OUVERTURE DE L'ACCÈS, et non au moment du versement.
// La différence compte : refuser l'accès n'immobilise l'argent de personne,
// alors que bloquer un virement retiendrait une somme due à quelqu'un qui a
// déjà travaillé.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quels mandats manquent à ce profil ?
 *
 * @param {{mandat_facturation_at?:string|null, mandat_encaissement_at?:string|null}} profil
 * @returns {string[]} libellés en français, prêts à être lus par un humain.
 *                     Tableau vide si les deux sont signés.
 *
 * Un profil absent ou illisible renvoie les DEUX comme manquants : en cas de
 * doute sur une pièce contractuelle, on n'ouvre pas.
 */
export function mandatsManquants(profil) {
  if (!profil || typeof profil !== "object") {
    return ["le mandat de facturation", "le mandat d'encaissement"];
  }
  const manquants = [];
  if (!profil.mandat_facturation_at)  manquants.push("le mandat de facturation");
  if (!profil.mandat_encaissement_at) manquants.push("le mandat d'encaissement");
  return manquants;
}

/** Le message rendu au back-office quand l'ouverture est refusée. */
export function messageMandatsManquants(manquants) {
  return `Accès non ouvert : ce prestataire n'a pas encore accepté ${manquants.join(" ni ")}. `
    + `Il le fait depuis son espace, onglet Revenus. Sans cela, ALANE ne peut ni encaisser `
    + `ni facturer en son nom (CGPS art. 7.2).`;
}
