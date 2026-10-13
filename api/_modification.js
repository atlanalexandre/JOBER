// « Modifier » une prestation depuis le back-office (relecture du 12/10/2026).
//
// Le formulaire renvoie TOUS ses champs — date, heures, tarif, ville, métier —
// avec les valeurs lues à l'ouverture de la liste. Une heure supplémentaire
// payée entre-temps par le client (`hours` passé de 4 à 6) était donc
// réécrite à 4 dès qu'on changeait la ville : la clôture et la facture ne
// correspondaient plus à ce que le client avait payé. D'où trois règles :
//   1. on n'écrit que ce qui diffère de la base ;
//   2. la date, les heures et le tarif d'une prestation qui porte de l'argent
//      d'heures ajoutées (ou une demande en cours) ne se modifient pas ici ;
//   3. l'écriture n'a lieu que si la base vaut encore ce qu'on a lu.

import { nouvellePeriode } from "./_creneaux.js";

const jour = (v) => String(v ?? "").slice(0, 10);
const nombre = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const fourni = (v) => v !== undefined && v !== null && v !== "";

/** Des heures ajoutées payées, ou une demande en cours, sont rattachées à la prestation. */
export function porteHeuresAjoutees(m) {
  const ajouts = Array.isArray(m?.heures_ajoutees_detail) ? m.heures_ajoutees_detail : [];
  return ajouts.length > 0
    || Number(m?.extra_hours_appliquees || 0) > 0
    || ["pending", "accepte_presta"].includes(m?.extra_hours_status);
}

/**
 * Champs à écrire : seulement ceux que la saisie change par rapport à la base.
 * Une date changée entraîne sa période (prestation sur plusieurs jours).
 */
export function champsModifies(actuelle, saisie) {
  const updates = {};
  if (fourni(saisie.date) && jour(saisie.date) !== jour(actuelle.date)) {
    updates.date = saisie.date;
    Object.assign(updates, nouvellePeriode(actuelle, saisie.date));
  }
  if (fourni(saisie.hours) && Number(saisie.hours) !== nombre(actuelle.hours)) updates.hours = Number(saisie.hours);
  if (fourni(saisie.tarif_horaire) && Number(saisie.tarif_horaire) !== nombre(actuelle.tarif_horaire)) {
    updates.tarif_horaire = Number(saisie.tarif_horaire);
  }
  if (fourni(saisie.ville) && saisie.ville !== actuelle.ville) updates.ville = saisie.ville;
  if (fourni(saisie.metier) && saisie.metier !== actuelle.metier) updates.metier = saisie.metier;
  return updates;
}

/**
 * Heures et tarif : des nombres positifs (les heures entières, comme la
 * colonne). Rend le message d'erreur, ou null.
 */
export function valeursNumeriquesInvalides({ hours, tarif_horaire }) {
  if (fourni(hours) && !(Number.isInteger(Number(hours)) && Number(hours) > 0)) return "Heures invalides (nombre entier positif attendu)";
  if (fourni(tarif_horaire) && !(Number.isFinite(Number(tarif_horaire)) && Number(tarif_horaire) > 0)) return "Tarif invalide (nombre positif attendu, avec un point : 18.50)";
  return null;
}

/**
 * Champs modifiés dont la base ne vaut plus ce que l'écran affichait (`avant`).
 * Sans `avant` (écran d'une version antérieure), rien n'est comparé.
 */
export function champsPerimes(actuelle, avant, updates) {
  if (!avant || typeof avant !== "object") return [];
  const perimes = [];
  if ("date" in updates && "date" in avant && jour(avant.date) !== jour(actuelle.date)) perimes.push("date");
  if ("hours" in updates && "hours" in avant && nombre(avant.hours) !== nombre(actuelle.hours)) perimes.push("hours");
  if ("tarif_horaire" in updates && "tarif_horaire" in avant && nombre(avant.tarif_horaire) !== nombre(actuelle.tarif_horaire)) perimes.push("tarif_horaire");
  return perimes;
}

/** La modification touche-t-elle à ce qui fixe le prix ou les journées ? */
export function touchePrixOuJours(updates) {
  return "date" in updates || "hours" in updates || "tarif_horaire" in updates;
}

const egal = (col, v) => (v === null || v === undefined ? `${col}.is.null` : `${col}.eq.${v}`);

/**
 * Filtre PostgREST qui conditionne l'écriture : chaque champ modifié vaut
 * encore ce qui a été lu, et — si le prix ou les journées changent — aucune
 * heure ajoutée ni demande n'est apparue entre la lecture et l'écriture.
 */
export function gardeEcriture(actuelle, updates) {
  const conditions = [];
  if ("date" in updates) conditions.push(egal("date", actuelle.date ? jour(actuelle.date) : null));
  if ("hours" in updates) conditions.push(egal("hours", nombre(actuelle.hours)));
  if ("tarif_horaire" in updates) conditions.push(egal("tarif_horaire", nombre(actuelle.tarif_horaire)));
  if (touchePrixOuJours(updates)) {
    conditions.push(
      "or(heures_ajoutees_detail.is.null,heures_ajoutees_detail.eq.[])",
      "or(extra_hours_appliquees.is.null,extra_hours_appliquees.eq.0)",
      "or(extra_hours_status.is.null,extra_hours_status.not.in.(pending,accepte_presta))",
    );
  }
  return conditions.length ? `&and=(${conditions.join(",")})` : "";
}
