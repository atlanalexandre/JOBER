// Supprimer un compte effaçait les sommes qu'il devait à ALANE (étude du
// 13/10/2026) : `creances_prestataires` est rattachée au compte en cascade, et
// ni la suppression par l'utilisateur ni celle du back-office ne la regardait.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { CREANCES_OUVERTES, creancesOuvertes } from "../../../api/_suppression.js";

const reponse = (status, corps) => ({ ok: status >= 200 && status < 300, status, json: async () => corps });

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("creancesOuvertes", () => {
  it("compte les sommes actives et contestées — pas les éteintes ni abandonnées", async () => {
    expect(CREANCES_OUVERTES).toEqual(["active", "contestee"]);
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(200, [{ montant_restant: "12.40" }, { montant_restant: 7.6 }]));
    const r = await creancesOuvertes("u1", "https://x", {}, "t");
    expect(r).toEqual({ lisible: true, total: 20, nombre: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("statut=in.(active,contestee)");
  });
  it("rien de dû : nombre 0", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(200, []));
    expect((await creancesOuvertes("u1", "https://x", {}, "t")).nombre).toBe(0);
  });
  it("lecture refusée : illisible, jamais « rien de dû »", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(500, { message: "panne" }));
    expect((await creancesOuvertes("u1", "https://x", {}, "t")).lisible).toBe(false);
  });
});

describe("les deux chemins de suppression la vérifient avant d'effacer", () => {
  const chemins = [
    ["support.js", 'action === "delete_account"', "resilierAbonnement(userId"],
    ["bo-action.js", 'const ctx = "bo-action/delete"', "rembourserDepuisLeBO(pm"],
    ["cron-reset-monthly.js", "resiliation_prevue_at=lte.", "resilierAbonnement(p.id"],
  ];
  for (const [fichier, debut, irreversible] of chemins) {
    it(fichier, () => {
      const code = readFileSync(new URL(`../../../api/${fichier}`, import.meta.url), "utf8");
      const d = code.indexOf(debut);
      const i = code.indexOf("await creancesOuvertes(", d);
      expect(d).toBeGreaterThan(0);
      expect(i, "contrôle présent dans ce chemin").toBeGreaterThan(d);
      expect(i, "avant la première action irréversible").toBeLessThan(code.indexOf(irreversible, d));
      expect(code.slice(i, i + 900)).toMatch(/status\(409\)|continue;/);
    });
  }});
