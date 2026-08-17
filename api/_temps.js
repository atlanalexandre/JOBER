// ═══════════════════════════════════════════════════════════════════════════
// Conversion des horaires de prestation en instant réel
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// `missions.heure_debut` est une heure locale française : « 14:00 » veut dire
// 14 h à Paris. Vercel exécute les fonctions en UTC. Écrire
//
//     new Date(`${date}T${heure_debut}:00`)
//
// donne donc 14 h UTC, soit 16 h à Paris en été — deux heures trop tard.
//
// La formule de correction existait déjà en quatre exemplaires recopiés à la
// main dans le projet. Trois d'entre eux étaient faux :
//
//   • api/cron-abandon.js       — correction absente : l'alerte « prestataire
//     en retard », qui doit partir entre 15 et 45 min de retard, ne partait
//     qu'entre 2 h 15 et 2 h 45. Sur une prestation d'une heure, elle arrivait
//     après la fin. La fonctionnalité n'a jamais fonctionné.
//
//   • api/cron-reset-monthly.js — signe inversé (`naive - offset` au lieu de
//     `naive + offset`) : l'alerte « horaire dépassé sans pointage » partait
//     quatre heures trop tard en été.
//
//   • api/cron-reset-monthly.js — correction absente sur la relance de
//     validation : deux heures de retard.
//
// D'où ce module unique. Toute nouvelle conversion passe par ici ; on ne
// recopie plus la formule.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Décalage à AJOUTER à une date naïve interprétée en UTC pour obtenir
 * l'instant UTC réel de cette heure locale française.
 *
 * La valeur est NÉGATIVE : -2 h en heure d'été (CEST), -1 h en heure d'hiver
 * (CET). « 14:00 Paris en été » = 14 h UTC − 2 h = 12 h UTC.
 *
 * Les bascules suivent la règle européenne : dernier dimanche de mars et
 * dernier dimanche d'octobre, à 01:00 UTC dans les deux cas.
 */
export function frenchOffsetMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const marchEnd = new Date(Date.UTC(y, 2, 31)); marchEnd.setUTCDate(31 - marchEnd.getUTCDay()); marchEnd.setUTCHours(1, 0, 0, 0);
  const octEnd   = new Date(Date.UTC(y, 9, 31)); octEnd.setUTCDate(31 - octEnd.getUTCDay());     octEnd.setUTCHours(1, 0, 0, 0);
  return (d >= marchEnd && d < octEnd) ? -7200000 : -3600000;
}

/**
 * Instant UTC (ms) du début prévu d'une prestation.
 *
 * @param {string} date        « 2026-08-06 »
 * @param {string} heureDebut  « 14:00 » — 08:00 par défaut, comme partout ailleurs
 * @returns {number|null} null si la date est absente ou illisible
 */
export function debutPrestationMs(date, heureDebut) {
  if (!date) return null;
  const [h = 8, mn = 0] = String(heureDebut || "08:00").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
  const naive = new Date(`${date}T${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}:00`);
  const naiveMs = naive.getTime();
  if (isNaN(naiveMs)) return null;
  return naiveMs + frenchOffsetMs(naive);
}

/**
 * Instant UTC (ms) de la fin prévue d'une prestation.
 *
 * Si le prestataire a réellement pointé son démarrage, c'est ce pointage qui
 * fait foi — une prestation commencée avec du retard finit avec du retard.
 * Sans pointage, on retombe sur l'horaire prévu.
 *
 * @param {{date?:string, heure_debut?:string, hours?:number, actual_hours?:number, started_at?:string}} m
 * @returns {number|null}
 */
export function finPrestationMs(m) {
  if (!m) return null;
  const dureeH = Number(m.actual_hours ?? m.hours ?? 1) || 1;
  const dureeMs = dureeH * 3600000;
  if (m.started_at) {
    const debut = new Date(m.started_at).getTime();
    if (!isNaN(debut)) return debut + dureeMs;
  }
  const debutMs = debutPrestationMs(m.date, m.heure_debut);
  return debutMs === null ? null : debutMs + dureeMs;
}

/**
 * Fenêtre de contestation ouverte au client par l'article 17.1 des CGPS :
 * quarante-huit heures à compter de la FIN de la prestation.
 */
export const DELAI_CONTESTATION_MS = 48 * 3600000;

/**
 * Instant UTC (ms) à partir duquel le virement au prestataire devient émissible.
 *
 * Le point de départ est la fin de la prestation, jamais l'instant de la
 * validation : un client qui valide trois jours après coup a déjà laissé la
 * fenêtre se fermer, son prestataire ne doit pas attendre deux jours de plus.
 * À l'inverse, une validation immédiate en fin de service n'abrège pas la
 * fenêtre — c'est précisément ce que le versement immédiat faisait.
 *
 * @param {object} m       la prestation (voir finPrestationMs)
 * @param {number} nowMs   repli si l'horaire de la prestation est illisible
 * @returns {number}
 */
export function echeanceVersementMs(m, nowMs = Date.now()) {
  // `actual_hours` est neutralisé, exactement comme dans le contrôle du délai de
  // contestation de l'action `dispute`. Les deux doivent partir du MÊME instant :
  // sinon une prestation écourtée — 2 h déclarées sur 4 h commandées — voit son
  // versement partir deux heures avant la fermeture de la fenêtre du client, qui
  // se retrouve à pouvoir signaler un problème sur un argent déjà versé.
  const fin = finPrestationMs({ ...m, actual_hours: null });
  return (fin === null ? nowMs : fin) + DELAI_CONTESTATION_MS;
}

/**
 * Retard de démarrage, en minutes, par rapport à l'horaire prévu.
 * Négatif si l'on est encore en avance. null si l'horaire est inconnu.
 */
export function retardMinutes(date, heureDebut, nowMs = Date.now()) {
  const debutMs = debutPrestationMs(date, heureDebut);
  return debutMs === null ? null : Math.floor((nowMs - debutMs) / 60000);
}

/**
 * Fenêtre pendant laquelle la position du prestataire peut être partagée.
 *
 * POURQUOI ELLE EXISTE
 *
 * Le partage de position n'était borné par rien. Un prestataire qui l'activait
 * la veille — ou simplement en avance, le bouton étant visible dès l'affectation
 * — exposait au client sa position en direct pendant des heures. C'est-à-dire,
 * la plupart du temps, son domicile.
 *
 * Une fenêtre d'une heure existait déjà dans le code, mais elle ne gouvernait
 * que la notification « prestataire en route ». Le partage lui-même, et la
 * lecture par le client, n'étaient bornés ni l'un ni l'autre.
 *
 * Le rapport avec la prestation est ce qui rend ce traitement légitime : hors
 * de ce rapport, il n'y a plus de finalité, donc plus de base légale. La
 * fenêtre commence une heure avant le début — le temps du trajet — et se ferme
 * une heure après la fin, pour couvrir un dépassement d'horaire.
 */
export const AVANCE_POSITION_MS = 60 * 60 * 1000;
export const GRACE_POSITION_MS  = 60 * 60 * 1000;

/**
 * @param {object} m      la prestation (date, heure_debut, hours, actual_hours, started_at)
 * @param {number} nowMs
 * @returns {{ouverte:boolean, debut:number|null, fin:number|null, raison:string|null}}
 *
 * `raison` vaut "trop_tot", "trop_tard" ou "horaire_inconnu" — de quoi dire au
 * prestataire pourquoi le partage est indisponible plutôt que de le laisser
 * appuyer sur un bouton qui ne fait rien.
 *
 * Horaire illisible : la fenêtre est FERMÉE. À défaut de savoir si l'on est
 * dans le rapport de la prestation, on ne diffuse pas la position de quelqu'un.
 */
export function fenetrePartagePosition(m, nowMs = Date.now()) {
  const debutMs = debutPrestationMs(m?.date, m?.heure_debut);
  const finMs   = finPrestationMs(m);
  if (debutMs === null || finMs === null) {
    return { ouverte: false, debut: null, fin: null, raison: "horaire_inconnu" };
  }
  const debut = debutMs - AVANCE_POSITION_MS;
  const fin   = finMs + GRACE_POSITION_MS;
  if (nowMs < debut) return { ouverte: false, debut, fin, raison: "trop_tot" };
  if (nowMs > fin)   return { ouverte: false, debut, fin, raison: "trop_tard" };
  return { ouverte: true, debut, fin, raison: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fenêtres de pointage : arrivée sur place, puis démarrage
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI ELLES EXISTENT
//
// Les deux gestes étaient bornés de quatre façons différentes :
//
//   • « Je suis sur place », côté écran : à partir de l'heure de début, pas
//     avant. Un prestataire arrivé en avance ne pouvait donc rien déclarer —
//     c'est ce qu'a constaté Alexandre le 17/08/2026 ;
//   • « Je suis sur place », côté serveur : AUCUNE borne. On pouvait pointer
//     son arrivée trois jours avant ;
//   • « Je commence », côté écran : à partir d'une heure avant le début ;
//   • « Je commence », côté serveur : cinq minutes avant, jusqu'à H+2 h.
//
// Le bouton apparaissait donc une heure avant, et le serveur refusait pendant
// cinquante-cinq minutes.
//
// LA RÈGLE, MAINTENANT UNIQUE
//
//   arrivée   : de H−15 min à H+2 h
//   démarrage : de H à H+2 h, et seulement après une arrivée déclarée
//
// Un quart d'heure d'avance couvre le prestataire ponctuel sans lui permettre
// de déclarer une présence qui n'a rien à voir avec la prestation. La borne
// haute est la même pour les deux : au-delà de deux heures de retard, ce n'est
// plus un pointage, c'est un litige.
//
// POURQUOI CETTE FONCTION PREND UN INSTANT ET NON UNE PRESTATION
//
// `debutPrestationMs` interprète une date naïve dans le fuseau du runtime, puis
// applique le décalage français : c'est juste sur Vercel, qui tourne en UTC, et
// FAUX dans un navigateur, qui est déjà à l'heure française. Chaque côté
// calcule donc l'instant à sa façon, et cette fonction ne porte que la règle.
export const AVANCE_ARRIVEE_MS   = 15 * 60000;
export const FENETRE_POINTAGE_MS = 2 * 3600000;

/**
 * @param {number|null} debutMs  instant du début prévu, déjà calculé par l'appelant
 * @param {number} nowMs
 * @returns {{arrivee:boolean, demarrage:boolean, ouvreArrivee:number|null,
 *            ouvreDemarrage:number|null, ferme:number|null, horaireInconnu:boolean}}
 *
 * Horaire illisible : les deux gestes sont AUTORISÉS. Empêcher un prestataire
 * de déclarer qu'il travaille parce qu'une date est mal formée serait le punir
 * d'un défaut qui n'est pas le sien — et le client, lui, attend sur place.
 */
export function fenetrePointage(debutMs, nowMs = Date.now()) {
  if (!debutMs || Number.isNaN(debutMs)) {
    return { arrivee: true, demarrage: true, ouvreArrivee: null, ouvreDemarrage: null, ferme: null, horaireInconnu: true };
  }
  const ouvreArrivee = debutMs - AVANCE_ARRIVEE_MS;
  const ferme        = debutMs + FENETRE_POINTAGE_MS;
  return {
    arrivee:   nowMs >= ouvreArrivee && nowMs <= ferme,
    demarrage: nowMs >= debutMs      && nowMs <= ferme,
    ouvreArrivee,
    ouvreDemarrage: debutMs,
    ferme,
    horaireInconnu: false,
  };
}
