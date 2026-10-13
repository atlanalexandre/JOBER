// Écran « Validation » du client (13/10/2026) : il validait pour les deux
// parties, écrivait la note dans `missions` depuis le navigateur (refusé par
// la base, donc perdu) et annonçait un virement qui n'avait pas eu lieu.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");
const debut = code.indexOf("export function ValidationScreen(");
const ecran = code.slice(debut, code.indexOf("\nexport function ", debut + 10));

describe("ValidationScreen", () => {
  it("n'écrit plus rien dans missions depuis le navigateur", () => {
    expect(ecran).not.toMatch(/from\("missions"\)\.update/);
  });
  it("valide par le serveur, puis dépose l'avis par le serveur", () => {
    expect(ecran).toContain('action:"complete"');
    expect(ecran).toContain('action:"submit_rating"');
  });
  it("ne valide plus pour le prestataire ni ne règle les heures", () => {
    expect(ecran).not.toContain("Validation Prestataire");
    expect(ecran).not.toContain('type="range"');
  });
  it("n'annonce plus un virement immédiat", () => {
    expect(ecran).not.toContain("Paiement libéré");
    expect(ecran).not.toMatch(/ont été virés/);
  });
});
