// ═══════════════════════════════════════════════════════════════════════════
// Ce que l'accueil client met en avant
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// L'accueil affichait deux blocs, alimentés par DEUX sources différentes :
// « à valider » venait de `/api/missions` toutes les 8 s, « en cours » d'une
// requête Supabase directe toutes les 60 s. La seconde oubliait `actual_hours`
// dans son `select` — une prestation prolongée disparaissait donc de l'écran
// avant d'être finie.
//
// Et il manquait le cas le plus courant : une prestation réservée pour demain
// n'apparaissait NULLE PART sur l'accueil. Il fallait ouvrir « Prestations »,
// puis l'onglet « Assignées », pour la retrouver.
//
// Le tri vit ici, hors du composant, pour être vérifiable : les dates de bord —
// une prestation qui vient de commencer, une qui vient de finir — ne se testent
// pas en cliquant dans une interface.
//
// LE TEMPS, ICI, EST CELUI DU NAVIGATEUR
//
// `heure_debut` est une heure locale française (voir `api/_temps.js`). Côté
// serveur, la conversion est obligatoire — Vercel tourne en UTC. Côté
// navigateur, l'horloge est celle de l'utilisateur : pour un client en France,
// c'est exact. Un client à l'étranger verrait l'horaire décalé de son propre
// décalage, ce qui est une limite connue et non un défaut de ce module.
// ═══════════════════════════════════════════════════════════════════════════

/** Instant (ms) du début prévu, dans le fuseau du navigateur. 0 si illisible. */
export function debutMs(m) {
  if (!m?.date) return 0;
  const t = new Date(`${m.date}T${m.heure_debut || "00:00"}`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Instant (ms) de la fin prévue. 0 si le début est illisible. */
export function finMs(m) {
  const d = debutMs(m);
  if (!d) return 0;
  const heures = Number(m.actual_hours ?? m.hours ?? 1) || 1;
  return d + heures * 3600000;
}

/**
 * Répartit les prestations du client en trois états d'accueil.
 *
 * Les trois sont exclusifs : une prestation dont le prestataire a confirmé la
 * fin est « à valider », et rien d'autre. Sans cette exclusion, elle serait
 * comptée aussi « en cours » tant que son créneau n'est pas écoulé, et le
 * client verrait deux blocs se contredire.
 *
 * @param {Array} missions  telles que renvoyées par l'action `list_client`
 * @param {number} nowMs
 * @returns {{aValider:Array, enCours:Array, prochaine:object|null}}
 */
export function etatAccueil(missions, nowMs = Date.now()) {
  const liste = Array.isArray(missions) ? missions : [];

  const aValider = liste.filter(m => m.status === "assigned" && m.validation_prestataire);

  const enCours = liste.filter(m => {
    if (m.status !== "assigned" || m.validation_prestataire) return false;
    const d = debutMs(m);
    return d > 0 && d <= nowMs && finMs(m) > nowMs;
  });

  // La prochaine : celle qui n'a pas encore commencé, la plus proche.
  // `pending_acceptance` en fait partie — le client a payé, il attend une
  // réponse, et c'est précisément le moment où il a besoin de la voir.
  const prochaine = liste
    .filter(m => ["assigned", "pending_acceptance"].includes(m.status)
              && !m.validation_prestataire
              && debutMs(m) > nowMs)
    .sort((a, b) => debutMs(a) - debutMs(b))[0] || null;

  return { aValider, enCours, prochaine };
}
