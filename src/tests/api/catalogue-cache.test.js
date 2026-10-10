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

describe("compteur de prestations réalisées (relecture du 09/10/2026)", () => {
  it("est demandé à la base, une ligne par prestataire", () => {
    expect(code).toContain("rpc/prestations_terminees_par_prestataire");
  });

  it("garde la lecture complète si la fonction n'est pas encore installée", () => {
    const i = code.indexOf("rpc/prestations_terminees_par_prestataire");
    const repli = code.indexOf("missions?status=eq.completed&prestataire_id=not.is.null", i);
    expect(repli).toBeGreaterThan(i);
  });

  it("la migration ne l'ouvre qu'au service role", () => {
    const sql = readFileSync(new URL("../../../migrations/2026-10-09_perf_compteur_prestations_terminees.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.prestations_terminees_par_prestataire\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.prestations_terminees_par_prestataire\(\) TO service_role/);
  });
});

describe("justificatifs et photos illisibles (relecture du 10/10/2026)", () => {
  it("rendent le catalogue incomplet, donc non mis en cache", () => {
    expect(code).toContain("if (justifs === null || photosCatalogue.incomplete) degrade = true;");
  });

  it("photosVerifiees signale chaque échec", () => {
    const photos = readFileSync(new URL("../../../api/_photos.js", import.meta.url), "utf8");
    expect((photos.match(/carte\.incomplete = true;/g) || []).length).toBe(3);
  });
});
