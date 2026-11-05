// L'accueil en mise en page d'ordinateur : jamais sur un téléphone, même tenu
// à l'horizontale (relecture du 04/11/2026).
import { describe, it, expect, afterEach, vi } from "vitest";
import { estEcranLarge } from "../lib/ecran-large.js";
import { REQUETE_MOBILE } from "../hooks/useResponsive.js";

const ecran = (correspond) => vi.stubGlobal("window", { matchMedia: (q) => ({ matches: correspond(q) }), innerWidth: 0 });
afterEach(() => vi.unstubAllGlobals());

describe("estEcranLarge", () => {
  it("un ordinateur de 1 440 px : oui", () => {
    ecran((q) => q === "(min-width: 900px)");
    expect(estEcranLarge()).toBe(true);
  });
  it("un grand téléphone à l'horizontale (932 px de large, tactile, peu haut) : non", () => {
    ecran((q) => q === REQUETE_MOBILE || q === "(min-width: 900px)");
    expect(estEcranLarge()).toBe(false);
  });
  it("une fenêtre d'ordinateur étroite : non", () => {
    ecran(() => false);
    expect(estEcranLarge()).toBe(false);
  });
});
