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
