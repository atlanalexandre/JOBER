import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tirerAuHasard } from "../../../api/_lots.js";

// Relecture du 30/09/2026 : les files de remboursement et de clôture prenaient
// toujours les 20 premiers ; un remboursement en échec permanent y restait en
// tête et bloquait tous les suivants.

describe("tirerAuHasard()", () => {
  it("rend n éléments distincts de la liste, sans la modifier", () => {
    const liste = Array.from({ length: 200 }, (_, i) => i);
    const lot = tirerAuHasard(liste, 20);
    expect(lot).toHaveLength(20);
    expect(new Set(lot).size).toBe(20);
    expect(lot.every(x => liste.includes(x))).toBe(true);
    expect(liste[0]).toBe(0);
  });

  it("20 éléments bloqués en tête ne privent pas les suivants", () => {
    const liste = Array.from({ length: 200 }, (_, i) => i);
    let atteints = 0;
    for (let k = 0; k < 50; k++) if (tirerAuHasard(liste, 20).some(x => x >= 20)) atteints++;
    expect(atteints).toBe(50);
  });

  it("tolère une liste absente", () => {
    expect(tirerAuHasard(null, 20)).toEqual([]);
  });
});

describe("les files du traitement automatique", () => {
  const src = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  it("tirent au hasard au lieu de prendre toujours les 20 premiers", () => {
    expect(src).toContain("tirerAuHasard(await zRes.json().catch(() => []), 20)");
    expect(src).toContain("tirerAuHasard(pastMissions, 20)");
    expect(src).not.toContain("pastMissions.slice(0, 20)");
  });
  it("« déjà remboursée » n'est pas un échec", () => {
    expect(src).toContain('d?.error?.code === "charge_already_refunded"');
    const m = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    expect(m).toContain('d?.error?.code === "charge_already_refunded"');
  });
  it("l'accusé de réception sert les plus récents d'abord", () => {
    expect(src).toContain("accuse_inscription_at=is.null&select=id&order=created_at.desc");
  });
});
