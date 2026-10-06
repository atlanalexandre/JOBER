// ═══════════════════════════════════════════════════════════════════════════
// Conflit de créneau d'un prestataire — journée par journée (06/10/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le contrôle ne comparait que la DATE DU PREMIER JOUR (`date=eq.…`). Sur une
// prestation de plusieurs jours, c'était faux dans les deux sens :
//   • une nouvelle série du lundi au vendredi ne voyait pas la prestation déjà
//     acceptée le mercredi ;
//   • une prestation ponctuelle le mercredi ne voyait pas la série déjà en
//     cours ce jour-là, puisque cette série a pour `date` son lundi.
// Le prestataire pouvait se retrouver réservé deux fois au même moment.
//
// Deux prestations sont en conflit si elles ont au moins une JOURNÉE en commun
// et que leurs horaires se chevauchent ce jour-là. Les horaires sont ceux,
// identiques chaque jour, de `heure_debut` + `hours` (heure locale).

/** Les journées couvertes (AAAA-MM-JJ), de la première à la dernière. */
export function joursCouverts(m) {
  const premier = String(m?.date_debut || m?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(premier)) return [];
  const finLue = String(m?.date_fin || "").slice(0, 10);
  const dernier = /^\d{4}-\d{2}-\d{2}$/.test(finLue) && finLue > premier ? finLue : premier;
  const jours = [];
  const d = new Date(`${premier}T12:00:00Z`);
  for (let i = 0; i < 400; i++) {
    const j = d.toISOString().slice(0, 10);
    if (j > dernier) break;
    jours.push(j);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return jours;
}

/** [début, fin] en minutes depuis minuit, ou null sans heure de début lisible. */
export function minutesDuCreneau(m) {
  // `Number("")` vaut 0 : sans ce contrôle, une heure absente passait pour minuit.
  if (!/^\d{1,2}:\d{2}/.test(String(m?.heure_debut || ""))) return null;
  const [h, mn] = String(m.heure_debut).split(":").map(Number);
  const debut = h * 60 + (Number.isFinite(mn) ? mn : 0);
  return [debut, debut + Math.ceil((Number(m?.hours) || 1) * 60)];
}

/**
 * La première prestation existante en conflit avec `nouvelle`, ou null.
 * Une prestation sans heure de début n'est pas comparée (comportement
 * historique : on ne bloque pas sur un horaire qu'on ne connaît pas).
 */
export function conflitDeCreneau(nouvelle, existantes) {
  const creneau = minutesDuCreneau(nouvelle);
  const jours = new Set(joursCouverts(nouvelle));
  if (!creneau || !jours.size) return null;
  for (const e of existantes || []) {
    const ce = minutesDuCreneau(e);
    if (!ce) continue;
    if (!joursCouverts(e).some(j => jours.has(j))) continue;
    if (creneau[0] < ce[1] && ce[0] < creneau[1]) return e;
  }
  return null;
}

/** Filtre PostgREST : les prestations qui touchent la période [premier, dernier]. */
export function filtrePeriode(premier, dernier) {
  return `or=(and(date.gte.${premier},date.lte.${dernier}),and(date_debut.lte.${dernier},date_fin.gte.${premier}))`;
}
