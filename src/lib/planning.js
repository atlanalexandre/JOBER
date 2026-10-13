// Les prestations du Planning, rangées par jour du mois affiché.
//
// Le Planning ne lisait que `date_debut`, qui n'est rempli que pour une
// prestation sur plusieurs jours : une prestation d'un jour (seulement `date`)
// n'y apparaissait jamais — 232 sur 303 en recette le 13/10/2026. Une série
// n'y apparaissait qu'à son premier jour. Les journées viennent désormais de
// `joursCouverts()`, la règle déjà suivie par la vérification des créneaux.
import { joursCouverts } from "../../api/_creneaux.js";

/** { parJour: { 13: [m, …] }, duMois: [{ m, premierJour }] } pour l'année et le mois (0-11). */
export function prestationsDuMois(prestations, annee, mois) {
  const prefixe = `${annee}-${String(mois + 1).padStart(2, "0")}-`;
  const parJour = {};
  const duMois = [];
  for (const m of prestations || []) {
    const jours = joursCouverts(m).filter(j => j.startsWith(prefixe));
    if (!jours.length) continue;
    for (const j of jours) {
      const jour = Number(j.slice(8, 10));
      (parJour[jour] ||= []).push(m);
    }
    duMois.push({ m, premierJour: jours[0], nbJours: jours.length });
  }
  duMois.sort((a, b) => a.premierJour.localeCompare(b.premierJour));
  return { parJour, duMois };
}
