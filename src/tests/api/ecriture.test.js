// Écriture vérifiée après un mouvement d'argent.
//
// Un refus de PostgREST résout normalement : `fetch` ne lève rien. Ce qui est
// éprouvé ici, c'est que ces refus — et l'écriture qui ne touche aucune ligne —
// sont bien lus comme des échecs, et jamais comme un succès.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ecrireVerifie } from "../../../api/_ecriture.js";

const repondre = (status, corps) => vi.fn().mockResolvedValue({
  ok: status >= 200 && status < 300, status,
  json: async () => corps,
});

describe("ecrireVerifie", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("réussit quand une ligne est écrite, et demande la ligne en retour", async () => {
    const f = repondre(200, [{ id: "m1" }]);
    vi.stubGlobal("fetch", f);
    expect(await ecrireVerifie("u", { status: "closed" }, { apikey: "k" }, "test")).toBe(true);
    const [, options] = f.mock.calls[0];
    expect(options.method).toBe("PATCH");
    expect(options.headers.Prefer).toBe("return=representation");
    expect(options.headers.apikey).toBe("k");
  });

  it("échoue sur un refus de la base (contrainte, colonne inconnue)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", repondre(400, { code: "23514", message: "violates check constraint" }));
    expect(await ecrireVerifie("u", { status: "x" }, {}, "test")).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("échoue quand aucune ligne n'est touchée (filtre qui ne correspond plus)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", repondre(200, []));
    expect(await ecrireVerifie("u", { status: "closed" }, {}, "test")).toBe(false);
  });

  it("échoue sans lever sur une coupure réseau", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await ecrireVerifie("u", {}, {}, "test")).toBe(false);
  });
});
