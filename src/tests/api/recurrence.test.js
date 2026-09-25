import { describe, it, expect } from "vitest";
import { dateSuivante, montantOccurrence } from "../../../api/_recurrence.js";

// Série hebdomadaire (25/09/2026) : chaque semaine est payée à son tour, au même
// tarif, avec les frais d'une prestation simple.
describe("dateSuivante", () => {
  it("chaque semaine : sept jours plus tard, y compris d'un mois et d'une année sur l'autre", () => {
    expect(dateSuivante("2026-09-30", "weekly")).toBe("2026-10-07");
    expect(dateSuivante("2026-12-29", "weekly")).toBe("2027-01-05");
  });
  it("le changement d'heure ne décale pas le jour", () => {
    expect(dateSuivante("2026-10-22", "weekly")).toBe("2026-10-29");
    expect(dateSuivante("2027-03-25", "weekly")).toBe("2027-04-01");
  });
  it("mensuelle : fin de mois ramenée au dernier jour", () => {
    expect(dateSuivante("2027-01-31", "monthly")).toBe("2027-02-28");
  });
  it("récurrence inconnue ou date illisible : rien", () => {
    expect(dateSuivante("2026-09-30", "annuelle")).toBeNull();
    expect(dateSuivante("pas une date", "weekly")).toBeNull();
  });
});

describe("montantOccurrence", () => {
  it("part horaire + frais d'une prestation simple, au centime", () => {
    // 8 h × 13 € = 104 € ; frais par défaut de la recette : 6,98 €.
    expect(montantOccurrence(13, 8, { single: 4.9, range: 2.9, urgent: 9.9, pourcentage: 2 })).toBe(110.98);
  });
  it("sans tarif ni durée : pas de montant, donc pas de prélèvement", () => {
    expect(montantOccurrence(0, 8)).toBeNull();
    expect(montantOccurrence(13, null)).toBeNull();
  });
});
