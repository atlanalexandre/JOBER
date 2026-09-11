import { describe, it, expect, vi, afterEach } from "vitest";
import { CLES_PREMIERE_VISITE, effacerPremiereVisite, origineApp } from "../constants/premiere-visite.js";

// Faux localStorage : les tests tournent sans navigateur. Comme le vrai, les
// clés stockées sont des propriétés énumérables de l'objet — c'est ce que
// `Object.keys(localStorage)` parcourt.
function faireStockage(initial = {}) {
  const s = { ...initial };
  Object.defineProperty(s, "removeItem", { value: (k) => { delete s[k]; }, enumerable: false });
  return s;
}

describe("effacerPremiereVisite()", () => {
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

  it("efface le tutoriel ET les quatre autres repères, sans toucher au reste", () => {
    globalThis.localStorage = faireStockage({
      "alane_onboarded_abc-123": "1",
      "alane_presta_checklist_dismissed": "1",
      "alane_pwa_banner": "1",
      "alane_notif_asked": "1",
      "alane_presta_tour_done_abc-123": "1",
      "alane_stay_logged_in": "1",     // ne doit PAS partir : déconnecterait l'utilisateur
      "alane_booking_draft": "{}",     // ne doit PAS partir : c'est son travail en cours
    });
    expect(effacerPremiereVisite()).toBe(5);
    expect(Object.keys(globalThis.localStorage).sort())
      .toEqual(["alane_booking_draft", "alane_stay_logged_in"]);
  });

  it("les repères connus sont bien tous dans la liste", () => {
    expect(CLES_PREMIERE_VISITE).toHaveLength(6);
    expect(CLES_PREMIERE_VISITE).toContain("alane_onboarded");
    // Les deux guides des onglets, prestataire ET client. Le premier avait été
    // oublié au premier jet ; le second l'est resté après sa correction, si
    // bien que « Réinitialiser le tutoriel client » effaçait tout SAUF la clé
    // qui marque ce tutoriel comme déjà vu. Il ne se rejouait jamais.
    expect(CLES_PREMIERE_VISITE).toContain("alane_presta_tour_done");
    expect(CLES_PREMIERE_VISITE).toContain("alane_tour_done");
  });

  it("renvoie -1 si le stockage est inaccessible (navigation privée)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("accès refusé en navigation privée"); },
    });
    expect(effacerPremiereVisite()).toBe(-1);
  });
});

describe("origineApp()", () => {
  const poser = (href) => { globalThis.window = { location: new URL(href) }; };
  afterEach(() => { delete globalThis.window; });

  it("renvoie l'application depuis le back-office", () => {
    poser("https://admin.alane.fr/");
    expect(origineApp()).toBe("https://www.alane.fr");
  });

  it("garde l'origine courante quand il n'y a qu'un seul hôte", () => {
    poser("http://localhost:5173/backoffice");
    expect(origineApp()).toBe("http://localhost:5173");
    poser("https://www.alane.fr/backoffice");
    expect(origineApp()).toBe("https://www.alane.fr");
  });
});
