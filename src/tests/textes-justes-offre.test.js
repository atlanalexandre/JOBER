// Ce qui est annoncé correspond à ce qui est appliqué (étude du 13/10/2026).
//
// Constatés : Premium annoncé « illimité » (c'est Elite ; Premium = 8/mois) avec
// « Urgences » (ouvertes à tous) ; le cashback « crédité 24 h après », « expire
// 6 mois après », « minimum 10 € » (rien de cela n'existe) ; le client accueilli
// par « notre équipe va valider votre compte » (il l'est d'office).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

describe("textes de l'offre et du cashback", () => {
  it("Premium n'est jamais annoncé illimité", () => {
    const presta = lire("src/components/presta-screens.jsx");
    expect(presta).not.toMatch(/Passez Premium pour accepter des prestations illimitées/);
    expect(presta).not.toMatch(/Prestations illimitées · Badge vérifié · Urgences/);
  });
  it("le cashback n'expire pas et n'a pas de minimum", () => {
    const client = lire("src/components/client-screens.jsx");
    expect(client).not.toMatch(/expire <strong[^>]*>6 mois/);
    expect(client).not.toMatch(/Montant minimum d'utilisation/);
    expect(client).not.toMatch(/24h après validation/);
  });
  it("le client n'attend aucune validation", () => {
    const support = lire("api/support.js");
    expect(support).not.toMatch(/Notre équipe va valider votre compte/);
  });
});
