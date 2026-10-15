// Accueil client : « pros dispo maintenant » et la rubrique « Dispo maintenant »
// lisaient `dispo_immediat`, que la fiche du catalogue ne reprenait pas — 0
// affiché, rubrique jamais montrée (étude du 13/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");

describe("accueil : disponibilité des prestataires", () => {
  it("la fiche du catalogue reprend dispo_immediat", () => {
    const fn = src.slice(src.indexOf("function mapperPrestataires"), src.indexOf("export async function rechargerPrestataires"));
    expect(fn).toMatch(/dispo_immediat:\s*p\.dispo_immediat !== false/);
  });
  it("les prestations réalisées de la plateforme viennent du serveur, pas de la lecture limitée au client", () => {
    expect(src).not.toMatch(/from\("missions"\)\.select\("id", \{ count:"exact", head:true \}\)\.eq\("status","completed"\)/);
    expect(src).toMatch(/open\.realisees/);
  });
});
