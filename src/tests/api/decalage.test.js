import { describe, it, expect, vi, afterEach } from "vitest";
import { valeurHeuresRetirees, rembourserHeuresRetirees } from "../../../api/_decalage.js";

// Audit du 30/09/2026 : un démarrage décalé réduisait les heures facturées sans
// jamais rembourser le client (110,98 € payés pour 8 h, 7 h facturées, 0 € rendu).

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("valeurHeuresRetirees()", () => {
  it("une heure à 13 € sur une journée : 13 €", () => {
    expect(valeurHeuresRetirees({ tarif_horaire: 13 }, 8, 7)).toBe(13);
  });
  it("sur trois jours, la réduction vaut pour chaque jour", () => {
    expect(valeurHeuresRetirees({ tarif_horaire: 13, date_debut: "2026-10-01", date_fin: "2026-10-03" }, 8, 7)).toBe(39);
  });
  it("la prolongation acceptée n'est pas touchée : la base absorbe la réduction", () => {
    // 8 h dont 2 h de prolongation à 17 € ; 1 h retirée → une heure de BASE (13 €).
    expect(valeurHeuresRetirees({ tarif_horaire: 13, extra_hours_tarif: 17, extra_hours_appliquees: 2 }, 8, 7)).toBe(13);
  });
  it("rien de retiré : rien à rendre", () => {
    expect(valeurHeuresRetirees({ tarif_horaire: 13 }, 8, 8)).toBe(0);
  });
});

describe("rembourserHeuresRetirees()", () => {
  it("rembourse le montant, une seule fois (clé d'idempotence), plafonné à la carte", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      appels.push({ url: String(url), o });
      if (String(url).includes("select=cashback_applique")) return new Response(JSON.stringify([{ cashback_applique: 0, cashback_debite: false }]), { status: 200 });
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }));
    const r = await rembourserHeuresRetirees({ mission: { id: "m1", montant_total: 110.98, stripe_payment_intent: "pi_123" }, euros: 13, supabaseUrl: "https://b", headers: {}, contexte: "test" });
    expect(r).toEqual({ ok: true, centimes: 1300, refundId: "re_1" });
    const stripe = appels.find(a => a.url.includes("api.stripe.com/v1/refunds"));
    expect(stripe.o.headers["Idempotency-Key"]).toBe("refund-decalage-m1");
    expect(new URLSearchParams(stripe.o.body).get("amount")).toBe("1300");
  });
  it("pas de paiement par carte : rien n'est tenté, et c'est dit", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await rembourserHeuresRetirees({ mission: { id: "m1", stripe_payment_intent: "wallet_x" }, euros: 13, supabaseUrl: "https://b", headers: {}, contexte: "test" });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
