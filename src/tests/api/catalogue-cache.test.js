// Le catalogue est gardé 30 s par le réseau de Vercel (08/10/2026) — mais
// seulement complet. Une lecture de secours (avis, compteurs, comptes) rend une
// vitrine incomplète, qui ne doit pas être servie à tous (relecture du 09/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");

describe("mise en cache du catalogue", () => {
  it("n'est posée que sur un catalogue complet", () => {
    expect(code).toMatch(/if \(!degrade\) res\.setHeader\("Cache-Control"/);
    expect(code.match(/s-maxage/g)).toHaveLength(1);
  });

  it("chaque lecture de secours marque le catalogue incomplet", () => {
    for (const motif of ["avis illisibles", "prestations terminées illisibles", "métadonnées des prestataires illisibles"]) {
      const ligne = code.split("\n").find(l => l.includes(motif));
      expect(ligne, motif).toContain("degrade = true");
    }
  });

  it("une liste des comptes refusée n'est pas lue comme vide", () => {
    expect(code).toContain("if (!allUsersRes.ok) throw");
  });
});
