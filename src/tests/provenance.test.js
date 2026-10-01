import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SOURCES_CONNAISSANCE, LIBELLE_CONNAISSANCE } from "../constants/data.js";

// « Comment avez-vous connu ALANE ? » (01/10/2026)
describe("provenance des inscriptions", () => {
  it("des identifiants uniques et courts : la valeur va dans user_metadata, encodé dans le jeton", () => {
    const ids = SOURCES_CONNAISSANCE.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z_]{1,20}$/);
  });

  it("des libellés uniques : l'inscription retrouve l'identifiant à partir du libellé choisi", () => {
    const libelles = SOURCES_CONNAISSANCE.map(s => s.label);
    expect(new Set(libelles).size).toBe(libelles.length);
    expect(LIBELLE_CONNAISSANCE.proche).toBe("Un proche, un collègue");
  });

  it("les deux inscriptions envoient la réponse, et le back-office la reçoit", () => {
    const auth = readFileSync(new URL("../components/auth.jsx", import.meta.url), "utf8");
    expect(auth.match(/connu_par: connuPar \|\| null/g)?.length).toBe(2);
    const bo = readFileSync(new URL("../../api/bo-action.js", import.meta.url), "utf8");
    expect(bo).toContain('"connu_par"');
  });
});
