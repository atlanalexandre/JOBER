// Délai de réponse annoncé (décision d'Alexandre du 26/10/2026) : 48 h ouvrées.
// « 24h ouvrées » était affiché sur sept écrans sans avoir été décidé, et une
// promesse écrite non tenue se retourne contre la plateforme.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ecrans = ["../components/client-screens.jsx", "../App.jsx"]
  .map(f => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");

describe("le délai de réponse annoncé est celui décidé", () => {
  it("plus aucun « 24h ouvrées »", () => {
    expect(ecrans).not.toMatch(/24 ?h(eures)? ouvrées/);
  });
  it("le support et le formulaire sans compte annoncent 48 h ouvrées", () => {
    expect(ecrans).toContain("Notre équipe répond sous 48 h ouvrées");
    expect(ecrans).toContain("notre équipe répond sous 48 h ouvrées");
  });
});
