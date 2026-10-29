// Facture du prestataire (décision d'Alexandre du 29/10/2026) : le nom de la
// plateforme n'y apparaît pas. Le logo ALANE en tête la faisait passer pour le
// vendeur de la prestation — l'inverse de sa qualité d'intermédiaire.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../../../api/invoice.js", import.meta.url), "utf8");
const debut = code.indexOf("const html = `<!DOCTYPE html>");
const gabarit = code.slice(debut, code.indexOf("`;", debut));

describe("la facture est celle du prestataire", () => {
  it("le nom de la plateforme n'apparaît nulle part dans le document", () => {
    expect(debut).toBeGreaterThan(0);
    expect(gabarit).not.toMatch(/ALANE/i);
  });
  it("en tête : le prestataire, émetteur de la facture", () => {
    expect(gabarit).toContain('<div class="logo">${escHtml(prestaCompany || prestaName || "Prestataire")}</div>');
  });
  it("le mandat de facturation reste mentionné, sans nommer le mandataire", () => {
    expect(gabarit).toContain("Facture établie par le mandataire de facturation du prestataire, en son nom et pour son compte");
    expect(gabarit).toContain("art. 289, I-2 du CGI");
  });
});
