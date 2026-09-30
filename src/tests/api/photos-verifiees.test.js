import { describe, it, expect, vi, afterEach } from "vitest";
import { photosVerifiees } from "../../../api/_photos.js";

// 30/09/2026 : seule la photo validée par ALANE est montrée aux clients.

const SB = "https://base.test";
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
afterEach(() => vi.unstubAllGlobals());

describe("photosVerifiees()", () => {
  it("ne lit que les photos validées, et les signe en un seul appel", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      appels.push({ u, body: o.body });
      if (u.includes("/rest/v1/documents")) return json([
        { prestataire_id: "a", storage_path: "a/photo" },
        { prestataire_id: "b", storage_path: "b/photo" },
      ]);
      if (u.endsWith("/storage/v1/object/sign/Documents")) return json([
        { path: "a/photo", signedURL: "/object/sign/Documents/a/photo?token=1", error: null },
        { path: "b/photo", signedURL: null, error: "Object not found" },
      ]);
      return json({}, 404);
    }));
    const carte = await photosVerifiees(["a", "b", "c", "a"], SB, {});
    expect(appels[0].u).toContain("type=eq.photo&verified=eq.true");
    expect(appels[0].u).toContain("prestataire_id=in.(a,b,c)");
    expect(JSON.parse(appels[1].body)).toEqual({ expiresIn: 3600, paths: ["a/photo", "b/photo"] });
    expect(appels).toHaveLength(2);
    expect(carte.get("a")).toBe(`${SB}/storage/v1/object/sign/Documents/a/photo?token=1`);
    expect(carte.has("b")).toBe(false); // fichier absent : pas de photo, pas d'erreur
    expect(carte.has("c")).toBe(false); // aucune photo validée
  });

  it("250 prestataires : trois lots de lecture", async () => {
    const lectures = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => { lectures.push(String(url)); return json([]); }));
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    await photosVerifiees(ids, SB, {});
    expect(lectures.filter(u => u.includes("/rest/v1/documents"))).toHaveLength(3);
  });

  it("base ou stockage en panne : aucune photo, jamais d'exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "boom" }, 500)));
    expect((await photosVerifiees(["a"], SB, {})).size).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
    expect((await photosVerifiees(["a"], SB, {})).size).toBe(0);
  });

  it("aucun prestataire : aucun appel", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await photosVerifiees([], SB, {});
    expect(f).not.toHaveBeenCalled();
  });
});
