import { describe, it, expect, vi, afterEach } from "vitest";

// `__BUILD_ID__` est injecté par Vite à la compilation. Sous vitest il faut le
// poser à la main AVANT d'importer le module, qui le lit à son chargement.
const chargerAvecBuild = async (id) => {
  vi.resetModules();
  if (id === null) delete globalThis.__BUILD_ID__;
  else globalThis.__BUILD_ID__ = id;
  return import("../lib/version.js?" + Math.random());
};

afterEach(() => { delete globalThis.__BUILD_ID__; delete globalThis.fetch; vi.restoreAllMocks(); });

const repond = (corps, ok = true) => {
  globalThis.fetch = vi.fn(async () => ({ ok, json: async () => corps }));
};

describe("nouvelleVersionDisponible()", () => {
  it("signale une mise à jour quand l'estampille déployée diffère", async () => {
    const { nouvelleVersionDisponible } = await chargerAvecBuild("100");
    repond({ build: "200" });
    expect(await nouvelleVersionDisponible()).toBe(true);
  });

  it("ne signale rien quand c'est la même version", async () => {
    const { nouvelleVersionDisponible } = await chargerAvecBuild("100");
    repond({ build: "100" });
    expect(await nouvelleVersionDisponible()).toBe(false);
  });

  // Une bannière « nouvelle version » qui s'affiche à tort ferait recharger
  // pour rien, au milieu d'une réservation. Dans le doute : on se tait.
  it("se tait quand le réseau échoue", async () => {
    const { nouvelleVersionDisponible } = await chargerAvecBuild("100");
    globalThis.fetch = vi.fn(async () => { throw new Error("hors ligne"); });
    expect(await nouvelleVersionDisponible()).toBe(false);
  });

  it("se tait quand le fichier est absent ou illisible", async () => {
    const { nouvelleVersionDisponible } = await chargerAvecBuild("100");
    repond({ build: "200" }, false);
    expect(await nouvelleVersionDisponible()).toBe(false);

    repond({ rien: "du tout" });
    expect(await nouvelleVersionDisponible()).toBe(false);
  });

  it("ne fait rien en développement, où l'estampille n'existe pas", async () => {
    const { nouvelleVersionDisponible } = await chargerAvecBuild(null);
    globalThis.fetch = vi.fn();
    expect(await nouvelleVersionDisponible()).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
