// Taux de cashback crédité par le serveur = taux affiché à l'écran
// (relecture du 29/10/2026) : paliers triés, et un taux de 0 % reste 0 %.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tauxDuPalier } from "../../../api/_cashback.js";

const GRILLE = [
  { id: "standard", min: 0, max: 2, rate: 0.005 }, { id: "silver", min: 3, max: 5, rate: 0.0075 },
  { id: "gold", min: 6, max: 9, rate: 0.01 }, { id: "platinum", min: 10, max: 999, rate: 0.015 },
];

describe("tauxDuPalier", () => {
  it("le dernier palier atteint", () => {
    expect(tauxDuPalier(GRILLE, 0)).toBe(0.005);
    expect(tauxDuPalier(GRILLE, 4)).toBe(0.0075);
    expect(tauxDuPalier(GRILLE, 25)).toBe(0.015);
  });
  it("un taux réglé à 0 % reste 0 % (il devenait 1 %)", () => {
    expect(tauxDuPalier([{ id: "standard", min: 0, max: 2, rate: 0 }], 1)).toBe(0);
  });
  it("paliers enregistrés dans le désordre : triés, comme à l'écran", () => {
    expect(tauxDuPalier([...GRILLE].reverse(), 4)).toBe(0.0075);
  });
  it("un palier non réglé garde la grille du code, comme à l'écran", () => {
    expect(tauxDuPalier([{ id: "platinum", min: 10, max: 999, rate: 0.02 }], 4)).toBe(0.0075);
    expect(tauxDuPalier([{ id: "platinum", min: 10, max: 999, rate: 0.02 }], 12)).toBe(0.02);
  });
  it("taux illisible (150 saisi pour 1,5) ou palier sans identifiant : écarté, comme à l'écran (relecture du 30/10/2026)", () => {
    expect(tauxDuPalier([{ id: "platinum", min: 10, max: 999, rate: 1.5 }], 12)).toBe(0.015);
    expect(tauxDuPalier([{ min: 10, max: 999, rate: 0.03 }], 12)).toBe(0.015);
  });
  it("réglage absent ou illisible : la grille du code", () => {
    expect(tauxDuPalier(null, 3)).toBe(0.0075);
    expect(tauxDuPalier([{ id: "standard", min: 0, max: 2, rate: "abc" }], 1)).toBe(0.005);
  });
});

describe("la grille du serveur est celle de l'écran", () => {
  it("PALIERS_CASHBACK_DEFAUT = CASHBACK_TIERS (seuils et taux)", async () => {
    const { CASHBACK_TIERS } = await import("../../constants/plans.js");
    const { PALIERS_CASHBACK_DEFAUT } = await import("../../../api/_cashback.js");
    expect(PALIERS_CASHBACK_DEFAUT).toEqual(CASHBACK_TIERS.map(({ id, min, max, rate }) => ({ id, min, max, rate })));
  });
  it("le serveur filtre les paliers comme les sert paliers_cashback", () => {
    const presta = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");
    const cb = readFileSync(new URL("../../../api/_cashback.js", import.meta.url), "utf8");
    const filtre = "t.id && Number.isFinite(t.min) && Number.isFinite(t.max) && Number.isFinite(t.rate) && t.rate >= 0 && t.rate < 1";
    expect(presta).toContain(filtre);
    expect(cb).toContain(filtre);
  });
});

describe("les trois chemins de crédit passent par tauxDuPalier", () => {
  for (const f of ["missions.js", "bo-action.js", "cron-reset-monthly.js"]) {
    it(f, () => {
      const code = readFileSync(new URL(`../../../api/${f}`, import.meta.url), "utf8");
      expect(code).toMatch(/const rate = tauxDuPalier\(CASHBACK_TIERS, \w+\);/);
      expect(code).not.toMatch(/CASHBACK_TIERS\]\.reverse\(\)\.find\([^)]*\)\?\.rate\s*\|\|/);
    });
  }
});
