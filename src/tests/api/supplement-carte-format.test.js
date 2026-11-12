// Toute carte reçue du navigateur et placée dans une adresse Stripe appelée
// avec la clé secrète est contrôlée : la même règle que get_pm et detach_pm
// (relecture du 30/09/2026), qui manquait au paiement d'heures supplémentaires
// (relecture du 11/11/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../../api/stripe-intent.js", import.meta.url), "utf8");

describe("identifiant de carte reçu du navigateur", () => {
  it("le paiement d'heures supplémentaires vérifie son format avant de le lire chez Stripe", () => {
    const controle = src.indexOf("if (pmDemande && !/^pm_[A-Za-z0-9]+$/.test(String(pmDemande)))");
    const lecture = src.indexOf("v1/payment_methods/${encodeURIComponent(pmDemande)}");
    expect(controle).toBeGreaterThan(0);
    expect(lecture).toBeGreaterThan(controle);
  });
  it("aucune adresse Stripe ne reçoit pmDemande sans ce contrôle", () => {
    expect(src).not.toContain("payment_methods/${pmDemande}");
  });
});
