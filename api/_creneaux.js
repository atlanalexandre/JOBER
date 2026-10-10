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
 * Les plages occupées, jour par jour : { "AAAA-MM-JJ": [[début, fin], …] } en
 * minutes. Deux choses que le seul couple heure de début + durée ignorait
 * (relecture du 07/10/2026) :
 *   • les heures AJOUTÉES à une journée (`heures_ajoutees_detail`) la
 *     prolongent ;
 *   • un créneau qui passe minuit déborde sur le lendemain — 22 h + 8 h
 *     occupe aussi le lendemain jusqu'à 6 h.
 */
export function plagesParJour(m) {
  const creneau = minutesDuCreneau(m);
  const plages = {};
  if (!creneau) return plages;
  const detail = Array.isArray(m?.heures_ajoutees_detail) ? m.heures_ajoutees_detail : [];
  const ajout = (j) => detail.filter(l => String(l?.jour || "").slice(0, 10) === j)
    .reduce((t, l) => t + (Number(l?.heures) || 0), 0);
  const ajouter = (j, d, f) => { (plages[j] ||= []).push([d, f]); };
  const jours = joursCouverts(m);
  const dernier = jours[jours.length - 1];
  for (const j of jours) {
    // Le dernier jour retient aussi le cumul `heures_ajoutees_dernier_jour`,
    // comme `joursDeLaPrestation()` : les deux calculs de la même fin ne
    // doivent pas diverger (relecture du 08/10/2026).
    const heuresAjoutees = j === dernier ? Math.max(ajout(j), Number(m?.heures_ajoutees_dernier_jour) || 0) : ajout(j);
    const fin = creneau[1] + Math.round(heuresAjoutees * 60);
    ajouter(j, creneau[0], Math.min(fin, 1440));
    if (fin > 1440) {
      const d = new Date(`${j}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      ajouter(d.toISOString().slice(0, 10), 0, Math.min(fin - 1440, 1440));
    }
  }
  return plages;
}

/**
 * La première prestation existante en conflit avec `nouvelle`, ou null.
 * Une prestation sans heure de début n'est pas comparée (comportement
 * historique : on ne bloque pas sur un horaire qu'on ne connaît pas).
 */
export function conflitDeCreneau(nouvelle, existantes) {
  for (const e of existantes || []) if (premierJourEnConflit(nouvelle, e)) return e;
  return null;
}

/**
 * Le premier jour où `nouvelle` et `existante` se chevauchent, ou null. Un
 * conflit né du débordement d'un créneau de nuit tombe la veille ou le
 * lendemain d'un jour réservé : le message nommait un jour libre, et le client
 * changeait la mauvaise date (relecture du 08/10/2026).
 */
export function premierJourEnConflit(nouvelle, existante) {
  const miennes = plagesParJour(nouvelle);
  const siennes = plagesParJour(existante);
  for (const j of Object.keys(miennes).sort()) {
    for (const [d1, f1] of miennes[j]) {
      if ((siennes[j] || []).some(([d2, f2]) => d1 < f2 && d2 < f1)) return j;
    }
  }
  return null;
}

/**
 * Filtre PostgREST : les prestations qui touchent la période [premier, dernier].
 * L'appelant élargit la période d'un jour avant : un créneau de nuit de la
 * veille déborde sur le premier jour.
 */
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

/**
 * Période d'une prestation sur plusieurs jours, décalée pour commencer à
 * `nouvelleDate` (« AAAA-MM-JJ »), sa durée conservée. Sert à « Modifier » du
 * back-office, qui changeait `date` seule : la période — que lisent la
 * vérification des créneaux et le calcul des journées — restait l'ancienne
 * (relecture du 09/10/2026). `date_debut` / `date_fin` sont des timestamptz
 * (« 2026-09-30 00:00:00+00 ») : on n'en garde que le jour (CLAUDE.md §4).
 *
 * @returns {{date_debut?: string, date_fin?: string}} vide pour une prestation
 *          d'un jour (sans `date_debut`)
 */
export function periodeDecalee(mission, nouvelleDate) {
  if (!mission?.date_debut) return {};
  const jour = (v) => Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`);
  // Ancré sur `date_debut`, et non sur `date` : la période commence au nouveau
  // jour même si `date` s'en était écartée — ce que faisait « Modifier » avant
  // le 09/10/2026. Ancré sur `date`, l'écart était conservé (relecture du 10/10).
  const decalage = jour(nouvelleDate) - jour(mission.date_debut);
  if (!Number.isFinite(decalage)) return {};
  const iso = (ms) => `${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`;
  const periode = { date_debut: iso(jour(mission.date_debut) + decalage) };
  if (mission.date_fin) periode.date_fin = iso(jour(mission.date_fin) + decalage);
  return periode;
}
