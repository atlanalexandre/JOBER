import { describe, it, expect, vi, afterEach } from "vitest";
import { lireTout, PAGE } from "../../../api/_lignes.js";

// PostgREST ne rend jamais plus de 1 000 lignes : au-delà, le traitement des
// documents suspendait des prestataires en règle (recette, 30/09/2026).
afterEach(() => vi.unstubAllGlobals());

function base(total) {
  const urls = [];
  vi.stubGlobal("fetch", vi.fn(async (u) => {
    urls.push(String(u));
    const offset = Number(new URL(u).searchParams.get("offset"));
    const n = Math.max(0, Math.min(PAGE, total - offset));
    return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: offset + i }))), { status: 200 });
  }));
  return urls;
}

describe("lireTout()", () => {
  it("2 345 lignes : trois pages, rien de perdu, ordre stable ajouté", async () => {
    const urls = base(2345);
    const lignes = await lireTout("https://b/rest/v1/documents?type=eq.urssaf&select=id", {});
    expect(lignes).toHaveLength(2345);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("order=id.asc");
    expect(urls[2]).toContain("offset=2000");
  });
  it("exactement 1 000 : une seconde page, vide, pour s'en assurer", async () => {
    const urls = base(1000);
    expect(await lireTout("https://b/rest/v1/x?select=id", {})).toHaveLength(1000);
    expect(urls).toHaveLength(2);
  });
  it("garde l'ordre demandé", async () => {
    const urls = base(10);
    await lireTout("https://b/rest/v1/x?select=id&order=expires_at.asc,id.asc", {});
    expect(urls[0]).toContain("order=expires_at.asc,id.asc");
    expect(urls[0]).not.toContain("order=id.asc&");
  });
  it("une page refusée lève : jamais de lecture partielle prise pour complète", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(lireTout("https://b/rest/v1/x?select=id", {})).rejects.toThrow("lecture refusée");
  });
  it("refuse une URL qui porte déjà un limit", async () => {
    await expect(lireTout("https://b/rest/v1/x?select=id&limit=5000", {})).rejects.toThrow();
  });

  it("plafond atteint : erreur, jamais une lecture tronquée présentée comme complète", async () => {
    base(5000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lireTout("https://b/rest/v1/documents?select=id", {}, { max: 3000 }))
      .rejects.toThrow(/résultat incomplet/);
  });
});
