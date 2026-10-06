// Conflit de créneau journée par journée (06/10/2026). Le contrôle ne comparait
// que le premier jour : une série ne voyait pas les prestations de ses jours
// suivants, et une prestation ponctuelle ne voyait pas une série en cours.
import { describe, it, expect } from "vitest";
import { joursCouverts, minutesDuCreneau, conflitDeCreneau, filtrePeriode } from "../../../api/_creneaux.js";

const serie = { id: "s", date: "2026-10-12", date_debut: "2026-10-12 00:00:00+00", date_fin: "2026-10-16 00:00:00+00", heure_debut: "09:00", hours: 4 };
const ponctuelle = (jour, heure = "10:00", hours = 2) => ({ id: `p-${jour}`, date: jour, heure_debut: heure, hours });

describe("les journées couvertes", () => {
  it("une série du lundi au vendredi couvre cinq jours", () => {
    expect(joursCouverts(serie)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  });
  it("une prestation ponctuelle couvre son jour", () => {
    expect(joursCouverts(ponctuelle("2026-10-14"))).toEqual(["2026-10-14"]);
  });
  it("une fin antérieure au début ne compte que le premier jour", () => {
    expect(joursCouverts({ date: "2026-10-14", date_fin: "2026-10-10" })).toEqual(["2026-10-14"]);
  });
  it("sans date lisible, aucune journée", () => {
    expect(joursCouverts({ date: "" })).toEqual([]);
  });
  it("le créneau se lit en minutes", () => {
    expect(minutesDuCreneau({ heure_debut: "09:30", hours: 2 })).toEqual([570, 690]);
    expect(minutesDuCreneau({ heure_debut: null })).toBeNull();
  });
});

describe("le conflit", () => {
  it("une série ne laisse plus passer une prestation déjà prise le mercredi", () => {
    expect(conflitDeCreneau(serie, [ponctuelle("2026-10-14")])?.id).toBe("p-2026-10-14");
  });
  it("une prestation le mercredi voit la série en cours ce jour-là", () => {
    expect(conflitDeCreneau(ponctuelle("2026-10-14"), [serie])?.id).toBe("s");
  });
  it("même jour, horaires distincts : pas de conflit", () => {
    expect(conflitDeCreneau(ponctuelle("2026-10-14", "14:00"), [serie])).toBeNull();
  });
  it("hors de la période : pas de conflit", () => {
    expect(conflitDeCreneau(ponctuelle("2026-10-17"), [serie])).toBeNull();
  });
  it("deux séries qui se recouvrent sur un jour", () => {
    const autre = { ...serie, id: "s2", date: "2026-10-16", date_debut: "2026-10-16", date_fin: "2026-10-20" };
    expect(conflitDeCreneau(autre, [serie])?.id).toBe("s");
  });
  it("une prestation sans heure de début n'est pas comparée", () => {
    expect(conflitDeCreneau(serie, [{ ...ponctuelle("2026-10-14"), heure_debut: null }])).toBeNull();
  });
});

it("le filtre de lecture couvre les deux formes de prestation", () => {
  expect(filtrePeriode("2026-10-12", "2026-10-16"))
    .toBe("or=(and(date.gte.2026-10-12,date.lte.2026-10-16),and(date_debut.lte.2026-10-16,date_fin.gte.2026-10-12))");
});

import { premiereIndisponibilite, heureDansCreneaux } from "../../../api/_creneaux.js";

describe("les disponibilités déclarées, sur chaque journée", () => {
  const semaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
  // Du vendredi 16 au lundi 19 octobre 2026.
  const periode = joursCouverts({ date: "2026-10-16", date_fin: "2026-10-19" });

  it("une période qui passe par le week-end est refusée au premier jour non travaillé", () => {
    expect(premiereIndisponibilite({ jours: periode, disponJours: semaine, heureDebut: "09:00" }))
      .toMatchObject({ jour: "2026-10-17", jourFr: "Samedi", motif: "jour" });
  });

  it("la même période passe chez un prestataire disponible tous les jours", () => {
    expect(premiereIndisponibilite({ jours: periode, disponJours: [...semaine, "Samedi", "Dimanche"], heureDebut: "09:00" })).toBeNull();
  });

  it("un créneau du matin seulement le lundi refuse un début à 14 h", () => {
    const r = premiereIndisponibilite({ jours: periode, creneaux: { Lundi: ["Matin (6h-13h)"] }, heureDebut: "14:00" });
    expect(r).toMatchObject({ jour: "2026-10-19", motif: "creneau" });
  });

  it("aucune déclaration ne restreint rien", () => {
    expect(premiereIndisponibilite({ jours: periode, heureDebut: "03:00" })).toBeNull();
  });

  it("les créneaux couvrent la nuit des deux côtés de minuit", () => {
    expect(heureDansCreneaux(23, ["Soir/Nuit (20h-6h)"])).toBe(true);
    expect(heureDansCreneaux(4, ["Soir/Nuit (20h-6h)"])).toBe(true);
    expect(heureDansCreneaux(12, ["Soir/Nuit (20h-6h)"])).toBe(false);
  });
});
