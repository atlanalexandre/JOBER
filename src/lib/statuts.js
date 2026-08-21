// ═══════════════════════════════════════════════════════════════════════════
// Le vocabulaire des états d'une prestation, côté client
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Le même état portait deux noms selon l'écran : `assigned` s'affichait
// « Confirmée » sur la fiche d'une prestation et « Assignée » dans
// l'historique. Deux vocabulaires pour une seule réalité, c'est un utilisateur
// qui croit à deux choses différentes.
//
// Et plusieurs termes venaient du modèle de données plutôt que de ce que vit le
// client : « Ouverte » ne dit pas qu'on cherche quelqu'un, « Assignée » suppose
// qu'il a assigné quelqu'un — il n'a rien assigné, un professionnel a accepté.
//
// LA RÈGLE
//
// Un libellé décrit ce que le client doit comprendre, jamais l'état interne.
// `completed` et `closed` sont deux états distincts en base — validé des deux
// côtés, puis clos après versement — mais du point de vue du client, c'est la
// même chose : la prestation a eu lieu. Un seul mot.
//
// L'ÉTAT QUI MANQUAIT
//
// Une prestation terminée mais que le client n'a pas encore validée reste
// `assigned` en base. Elle s'affichait « Confirmée », comme une prestation à
// venir — alors que c'est le seul moment où une action lui est demandée, et que
// de cette action dépend le versement du prestataire. D'où « À valider ».

/** Fin d'une prestation, en millisecondes. `null` si l'horaire est illisible. */
function finMs(m) {
  const heures = Math.max(1, Number(m?.actual_hours ?? m?.hours) || 1);
  if (m?.started_at) {
    const t = new Date(m.started_at).getTime();
    if (!isNaN(t)) return t + heures * 3600000;
  }
  if (!m?.date) return null;
  const naive = new Date(`${m.date}T${m.heure_debut || "08:00"}:00`);
  if (isNaN(naive.getTime())) return null;
  return naive.getTime() + heures * 3600000;
}

const LIBELLES = {
  open:               "Recherche en cours",
  pending_acceptance: "Réponse attendue",
  assigned:           "Confirmée",
  needs_replacement:  "Remplaçant recherché",
  completed:          "Terminée",
  closed:             "Terminée",
  cancelled:          "Annulée",
  disputed:           "Litige en cours",
  refused:            "Refusée",
  rejected:           "Refusée",
};

/**
 * Ce que le client lit sur une prestation.
 *
 * @param {object} m         la prestation
 * @param {number} [nowMs]   pour les tests
 * @returns {string}
 *
 * Un état inconnu rend son nom brut plutôt qu'un libellé inventé : mieux vaut
 * un mot étrange qu'un mot rassurant et faux.
 */
export function libelleStatut(m, nowMs = Date.now()) {
  if (m?.status === "assigned") {
    const fin = finMs(m);
    if (fin && nowMs > fin && !m.validation_client) return "À valider";
  }
  return LIBELLES[m?.status] || m?.status || "—";
}

/**
 * La couleur qui accompagne le libellé.
 *
 * « À valider » est la seule qui appelle l'œil : c'est le seul état où le
 * client doit agir, et où son inaction retient le versement du prestataire.
 */
export function couleurStatut(m, couleurs, nowMs = Date.now()) {
  const libelle = libelleStatut(m, nowMs);
  const C = couleurs || {};
  if (libelle === "À valider")            return C.accentGold || "#F0B429";
  if (libelle === "Litige en cours")      return C.danger     || "#F25E5E";
  if (libelle === "Annulée")              return C.danger     || "#F25E5E";
  if (libelle === "Refusée")              return C.textMuted  || "#4A4E6A";
  if (libelle === "Terminée")             return C.success    || "#10D98F";
  if (libelle === "Remplaçant recherché") return "#F59E0B";
  if (libelle === "Recherche en cours")   return C.violet     || "#7C6FE0";
  if (libelle === "Réponse attendue")     return C.violet     || "#7C6FE0";
  return C.violet || "#7C6FE0";
}

/** Les onglets de l'historique, et ce que chacun retient. */
export const ONGLETS_PRESTATIONS = [
  { id: "all",           l: "Toutes" },
  { id: "open",          l: "En recherche" },
  { id: "assigned",      l: "Confirmées" },
  { id: "completed",     l: "Terminées" },
  { id: "prestataires",  l: "Prestataires" },
];
