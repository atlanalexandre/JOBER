import { describe, it, expect } from "vitest";
import { prixClient, tarifInterim, economiePct, calcCashback, getCashbackTier } from "../constants/plans.js";

// ── Calcul du tarif client ────────────────────────────────────────
describe("prixClient", () => {
  it("retourne le tarifNet tel quel (0% commission)", () => {
    expect(prixClient(14, "restauration")).toBe(14);
    expect(prixClient(12, "proprete")).toBe(12);
  });
  it("ne peut pas retourner un montant négatif", () => {
    expect(prixClient(0, "divers")).toBeGreaterThanOrEqual(0);
  });
});

// ── Comparaison intérim ───────────────────────────────────────────
describe("tarifInterim", () => {
  it("calcule le coefficient ×2.2 de l'intérim", () => {
    expect(tarifInterim(10)).toBeCloseTo(22);
    expect(tarifInterim(14)).toBeCloseTo(30.8);
  });
  it("économie par rapport à l'intérim > 0", () => {
    expect(economiePct(14)).toBeGreaterThan(0);
    expect(economiePct(14)).toBeLessThan(100);
  });
});

// ── Cashback ──────────────────────────────────────────────────────
describe("getCashbackTier", () => {
  it("0 mission → Bronze", () => {
    expect(getCashbackTier(0).label).toBe("Bronze");
  });
  it("5 missions → Silver", () => {
    expect(getCashbackTier(5).label).toBe("Silver");
  });
  it("10 missions → Gold", () => {
    expect(getCashbackTier(10).label).toBe("Gold");
  });
  it("20 missions → Platinum", () => {
    expect(getCashbackTier(20).label).toBe("Platinum");
  });
});

describe("calcCashback", () => {
  it("Bronze (0-4 missions) → 1%", () => {
    expect(calcCashback(100, 0)).toBeCloseTo(1);
  });
  it("Silver (5-9 missions) → 2%", () => {
    expect(calcCashback(100, 5)).toBeCloseTo(2);
  });
  it("Gold (10-19 missions) → 3%", () => {
    expect(calcCashback(100, 10)).toBeCloseTo(3);
  });
  it("Platinum (20+ missions) → 5%", () => {
    expect(calcCashback(100, 20)).toBeCloseTo(5);
  });
  it("cashback proportionnel au montant", () => {
    expect(calcCashback(200, 0)).toBeCloseTo(2);
    expect(calcCashback(500, 10)).toBeCloseTo(15);
  });
});

// ── Calcul montant mission ────────────────────────────────────────
describe("Calcul montant total mission", () => {
  const calculMontant = (tarifHoraire, heures, nbJours = 1) =>
    tarifHoraire * heures * nbJours;

  it("mission simple 8h à 14€/h = 112€", () => {
    expect(calculMontant(14, 8)).toBe(112);
  });
  it("mission 3 jours × 8h × 12€ = 288€", () => {
    expect(calculMontant(12, 8, 3)).toBe(288);
  });
  it("mode urgence +2€/h", () => {
    const base = 14;
    const urgentSurcharge = 2;
    expect(calculMontant(base + urgentSurcharge, 4)).toBe(64);
  });
  it("le montant ne peut pas être négatif", () => {
    expect(calculMontant(0, 0)).toBeGreaterThanOrEqual(0);
  });
});
