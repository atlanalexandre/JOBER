// Taux de cashback crédité par le serveur = taux affiché à l'écran
// (relecture du 29/10/2026) : paliers triés, et un taux de 0 % reste 0 %.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tauxDuPalier } from "../../../api/_cashback.js";

const GRILLE = [{ min: 0, rate: 0.005 }, { min: 3, rate: 0.0075 }, { min: 6, rate: 0.01 }, { min: 10, rate: 0.015 }];

describe("tauxDuPalier", () => {
  it("le dernier palier atteint", () => {
    expect(tauxDuPalier(GRILLE, 0)).toBe(0.005);
    expect(tauxDuPalier(GRILLE, 4)).toBe(0.0075);
    expect(tauxDuPalier(GRILLE, 25)).toBe(0.015);
  });
  it("un taux réglé à 0 % reste 0 % (il devenait 1 %)", () => {
    expect(tauxDuPalier([{ min: 0, rate: 0 }, { min: 3, rate: 0.01 }], 1)).toBe(0);
  });
  it("paliers enregistrés dans le désordre : triés, comme à l'écran", () => {
    expect(tauxDuPalier([...GRILLE].reverse(), 4)).toBe(0.0075);
    expect(tauxDuPalier([{ min: 10, rate: 0.015 }, { min: 0, rate: 0.005 }, { min: 3, rate: 0.0075 }], 12)).toBe(0.015);
  });
  it("aucun palier atteint : le premier, comme getCashbackTier", () => {
    expect(tauxDuPalier([{ min: 2, rate: 0.004 }, { min: 5, rate: 0.01 }], 0)).toBe(0.004);
  });
  it("réglage illisible : l'ancien repli, 1 %", () => {
    expect(tauxDuPalier(null, 3)).toBe(0.01);
    expect(tauxDuPalier([{ min: 0, rate: "abc" }], 3)).toBe(0.01);
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
