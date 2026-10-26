// Les écrans clients affichent les paliers de cashback que le serveur applique
// (`platform_settings.cashback_rates`), pas la grille écrite dans le code
// (relecture du 23/10/2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { CASHBACK_TIERS, appliquerPaliersCashback, getCashbackTier, tauxCashback, calcCashback } from "../constants/plans.js";
import handler from "../../api/prestataires.js";

const origine = CASHBACK_TIERS.map(t => ({ ...t }));
afterEach(() => { CASHBACK_TIERS.splice(0, CASHBACK_TIERS.length, ...origine.map(t => ({ ...t }))); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("appliquerPaliersCashback", () => {
  it("un taux changé au back-office est celui affiché et calculé à l'écran", () => {
    expect(appliquerPaliersCashback([{ id: "platinum", min: 10, max: 999, rate: 0.02 }])).toBe(true);
    const platinum = getCashbackTier(12);
    expect(platinum.id).toBe("platinum");
    expect(tauxCashback(platinum)).toBe("2 %");
    expect(calcCashback(100, 12)).toBe(2);
    expect(platinum.label).toBe("Platinum");
  });
  it("seuils déplacés : le bon palier est choisi", () => {
    appliquerPaliersCashback([{ id: "silver", min: 2, max: 5, rate: 0.0075 }, { id: "standard", min: 0, max: 1, rate: 0.005 }]);
    expect(getCashbackTier(2).id).toBe("silver");
  });
  it("réponse vide ou invalide : la grille du code reste", () => {
    expect(appliquerPaliersCashback(null)).toBe(false);
    expect(appliquerPaliersCashback([{ id: "gold", rate: "abc" }])).toBe(false);
    expect(tauxCashback(getCashbackTier(7))).toBe("1 %");
  });
});

describe("/api/prestataires?action=paliers_cashback", () => {
  const reponse = () => { const r = { statut: 0, entetes: {} }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.setHeader = (k, v) => { r.entetes[k] = v; }; return r; };
  it("sert les seuils et les taux du réglage, rien d'autre", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://b.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ value: [{ id: "gold", min: 6, max: 9, rate: 0.012, secret: "x" }] }]), { status: 200 })));
    const res = reponse();
    await handler({ method: "GET", query: { action: "paliers_cashback" }, headers: {} }, res);
    expect(res.statut).toBe(200);
    expect(res.corps).toEqual({ paliers: [{ id: "gold", min: 6, max: 9, rate: 0.012 }] });
  });
});

describe("chargés au démarrage de l'application", () => {
  it("App appelle chargerPaliersCashback et redessine si la grille change", () => {
    const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
    expect(app).toMatch(/chargerPaliersCashback\(\)\.then\(change => \{ if \(change\) setPaliersCashback/);
  });
});
