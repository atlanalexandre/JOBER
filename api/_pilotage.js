// Pilotage de l'activité (demande d'Alexandre du 01/11/2026) : les trois
// chiffres à suivre chaque semaine pour savoir si la plateforme « tourne ».
//
//   1. Les demandes servies : parmi les réservations PAYÉES, la part qui a
//      trouvé un prestataire. Bas, il manque des prestataires.
//   2. Le délai d'acceptation : entre la réservation et le « oui » du
//      prestataire. Long, les clients attendent et repartent.
//   3. Le retour des clients : la part des clients servis qui ont réservé au
//      moins deux fois. Bas, c'est la qualité ou le prix.
//
// Fonctions pures : la lecture de la base est dans `bo-action.js`
// (`pilotage_activite`). Seules comptent les réservations payées
// (`stripe_payment_intent`) : un panier abandonné n'est pas une demande.

// Servie : un prestataire est là — la prestation est confirmée, faite, close ou
// contestée. Une annulation n'est jamais « servie », même après une acceptation :
// le prestataire qui se retire la veille laisse le client sans personne.
export const STATUTS_SERVIS = ["assigned", "completed", "closed", "disputed"];
// En attente : ni servie, ni perdue. `needs_replacement` en fait partie — le
// webhook la pose aussi sur un paiement dont le prestataire n'a PAS été retenu,
// sans que personne ait jamais accepté (relecture du 02/11/2026).
export const STATUTS_EN_ATTENTE = ["open", "pending_acceptance", "needs_replacement"];

/**
 * La réservation a-t-elle trouvé un prestataire ?
 *
 * Une annulation compte comme NON servie. La base ne dit pas qui a annulé (le
 * motif manque presque toujours) : le client, ou le traitement automatique qui
 * annule et rembourse une réservation restée sans prestataire. Les retirer du
 * calcul, comme le faisait la première version, gonflait le taux exactement
 * dans le cas qu'il doit révéler — le manque de prestataires. Le chiffre est
 * donc prudent : il peut sous-estimer, jamais rassurer à tort (02/11/2026).
 */
export function estServie(m) {
  return STATUTS_SERVIS.includes(m.status);
}

const mediane = (valeurs) => {
  if (!valeurs.length) return null;
  const t = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

/**
 * Les trois chiffres, sur les réservations payées créées depuis `depuisMs`.
 *
 * @param {Array} missions  id, client_id, prestataire_id, status, created_at,
 *                          stripe_payment_intent, sector, et `acceptee_at` s'il existe
 * @param {object} o        { depuisMs, delaiDisponible }
 */
export function chiffresPilotage(missions, { depuisMs, delaiDisponible = false } = {}) {
  const payees = (Array.isArray(missions) ? missions : []).filter(m => m.stripe_payment_intent);
  const periode = payees.filter(m => Date.parse(m.created_at) >= depuisMs);

  const enAttente = periode.filter(m => STATUTS_EN_ATTENTE.includes(m.status)).length;
  // Tranchées : servies, ou non (refusées, expirées, annulées — voir estServie).
  const tranchees = periode.filter(m => !STATUTS_EN_ATTENTE.includes(m.status));
  const annulees = tranchees.filter(m => m.status === "cancelled").length;
  const servies = tranchees.filter(estServie).length;

  // Délai d'acceptation, en minutes : seulement si la base enregistre le moment
  // de l'acceptation (`missions.acceptee_at`, migration 2026-11-01).
  const delais = delaiDisponible
    ? periode.filter(m => m.acceptee_at).map(m => (Date.parse(m.acceptee_at) - Date.parse(m.created_at)) / 60000)
      .filter(d => Number.isFinite(d) && d >= 0)
    : [];

  // Retour : sur tout ce qui a été lu (douze mois), pas seulement la période —
  // un client servi il y a deux mois qui revient cette semaine est un retour.
  // Les semaines suivantes d'une série (`parent_mission_id`) ne comptent pas :
  // elles se réservent seules, et tout client en série paraissait « revenu »
  // dès la deuxième semaine (relecture du 02/11/2026).
  const serviesParClient = new Map();
  for (const m of payees) {
    if (!m.client_id || !estServie(m) || m.parent_mission_id) continue;
    serviesParClient.set(m.client_id, (serviesParClient.get(m.client_id) || 0) + 1);
  }
  const clientsServis = serviesParClient.size;
  const clientsRevenus = [...serviesParClient.values()].filter(n => n >= 2).length;

  // Par secteur, pour voir où il manque des prestataires.
  const parSecteur = new Map();
  for (const m of tranchees) {
    const s = m.sector || "—";
    const cur = parSecteur.get(s) || { secteur: s, demandes: 0, servies: 0 };
    cur.demandes++;
    if (estServie(m)) cur.servies++;
    parSecteur.set(s, cur);
  }

  return {
    demandes: periode.length,
    en_attente: enAttente,
    annulees,
    tranchees: tranchees.length,
    servies,
    taux_servies: tranchees.length ? servies / tranchees.length : null,
    delai_disponible: delaiDisponible,
    delai_mediane_min: delaiDisponible ? mediane(delais) : null,
    delai_mesures: delais.length,
    clients_servis: clientsServis,
    clients_revenus: clientsRevenus,
    taux_retour: clientsServis ? clientsRevenus / clientsServis : null,
    par_secteur: [...parSecteur.values()].sort((a, b) => b.demandes - a.demandes),
  };
}
