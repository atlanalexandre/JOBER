import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { titresNonCouverts, metiersDeclares } from "../../api/_qualifications.js";
import { metiersSansExperience } from "../../api/_cv.js";

// Relecture du 03/10/2026 : le back-office contrôle le métier principal (#972),
// mais les écrans du prestataire ne regardaient que metiers_list. Il ne voyait
// donc ni le justificatif ni l'expérience qu'on lui reprochait.
describe("écrans du prestataire : le métier principal compte", () => {
  const meta = { metier: "Agent de sécurité", metiers_list: [{ metier: "Coursier / Livreur" }] };

  it("le justificatif d'un métier principal réglementé est demandé", () => {
    expect(titresNonCouverts(metiersDeclares(meta), null).length).toBeGreaterThan(0);
  });

  it("l'expérience manquante sur le métier principal est signalée", () => {
    const cv = { experiences: [{ poste: "Livreur", desc: "livraisons" }] };
    expect(metiersSansExperience(cv, metiersDeclares(meta))).toContain("Agent de sécurité");
  });

  it("les écrans ne lisent plus « metiers_list || [metier] »", () => {
    const src = readFileSync(new URL("../components/presta-screens.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/metiers_list\s*\|\|\s*\[/);
  });
});
