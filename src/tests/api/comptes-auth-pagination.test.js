// Au-delà de 1 000 comptes (relecture du 26/10/2026) : `admin/users?per_page=10000`
// ne rend que 1 000 comptes, sans le dire. Tous les appelants passent par
// `lireComptesAuth`, qui lit page par page.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { lireComptesAuth } from "../../../api/_auth.js";

afterEach(() => vi.unstubAllGlobals());

describe("lireComptesAuth", () => {
  it("lit toutes les pages : 1 000 + 1 000 + 250 comptes", async () => {
    const tailles = [1000, 1000, 250];
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      appels.push(String(url));
      const page = Number(new URL(String(url)).searchParams.get("page"));
      return new Response(JSON.stringify({ users: Array.from({ length: tailles[page - 1] }, (_, i) => ({ id: `${page}-${i}` })) }), { status: 200 });
    }));
    const comptes = await lireComptesAuth("https://b.test", {});
    expect(comptes).toHaveLength(2250);
    expect(appels).toHaveLength(3);
    expect(appels[0]).toContain("per_page=1000&page=1");
  });
  it("une page refusée lève une erreur : jamais une liste tronquée prise pour complète", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(lireComptesAuth("https://b.test", {})).rejects.toThrow(/comptes illisibles/);
  });
});

describe("plus aucun appel à per_page=10000", () => {
  it("dans /api", () => {
    const dossier = new URL("../../../api/", import.meta.url);
    for (const f of readdirSync(dossier).filter(n => n.endsWith(".js") && n !== "_auth.js")) {
      expect(readFileSync(new URL(f, dossier), "utf8"), f).not.toMatch(/admin\/users\?per_page=10000/);
    }
  });
});
