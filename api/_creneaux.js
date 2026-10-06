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

// ═══════════════════════════════════════════════════════════════════════════
// Disponibilités déclarées par le prestataire — journée par journée
// ═══════════════════════════════════════════════════════════════════════════
//
// L'écran de réservation contrôlait les jours et créneaux déclarés (« pas le
// dimanche », « le matin seulement ») sur le PREMIER JOUR seulement : une
// période passant par un dimanche était acceptée chez un prestataire qui ne
// travaille pas ce jour-là (06/10/2026).

export const JOURS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/** L'heure (0-23) tombe-t-elle dans l'un des créneaux déclarés ? */
export function heureDansCreneaux(heure, creneaux) {
  return (creneaux.includes("Matin (6h-13h)") && heure >= 6 && heure < 13)
    || (creneaux.includes("Après-midi (13h-20h)") && heure >= 13 && heure < 20)
    || (creneaux.includes("Soir/Nuit (20h-6h)") && (heure >= 20 || heure < 6));
}

/**
 * La première journée où le prestataire n'a pas déclaré être disponible, ou null.
 * Une liste de jours vide, ou un jour sans créneaux, ne restreint rien : c'est
 * la règle historique de l'écran.
 *
 * @returns {null | { jour:string, jourFr:string, motif:"jour"|"creneau", creneaux:string[] }}
 */
export function premiereIndisponibilite({ jours, disponJours = [], creneaux = {}, heureDebut = "" }) {
  const h = parseInt(String(heureDebut).split(":")[0], 10);
  for (const jour of jours || []) {
    const jourFr = JOURS_FR[new Date(`${jour}T12:00:00Z`).getUTCDay()];
    if (disponJours.length > 0 && !disponJours.includes(jourFr)) return { jour, jourFr, motif: "jour", creneaux: [] };
    const duJour = creneaux[jourFr] || [];
    if (duJour.length > 0 && Number.isFinite(h) && !heureDansCreneaux(h, duJour)) {
      return { jour, jourFr, motif: "creneau", creneaux: duJour };
    }
  }
  return null;
}
