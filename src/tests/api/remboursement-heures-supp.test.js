// Remboursement complet au back-office : les heures supplémentaires suivent
// (relecture du 04/10/2026). Une prolongation est un paiement distinct, que le
// remboursement complet ne rendait pas.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { rembourserDepuisLeBO } from "../../../api/_remboursement_bo.js";

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function simuler({ supp = [], rechercheOk = true }) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, corps: String(o.body || ""), cle: o.headers?.["Idempotency-Key"] });
    if (u.includes("/payment_intents/search")) {
      return rechercheOk
        ? new Response(JSON.stringify({ data: supp }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "interdit" } }), { status: 403 });
    }
    if (u.endsWith("/v1/refunds")) return new Response(JSON.stringify({ id: "re_" + appels.length }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
  return appels;
}

const mission = { id: "m1", stripe_payment_intent: "pi_resa", payout_status: "pending" };

describe("rembourserDepuisLeBO : heures supplémentaires", () => {
  it("rembourse la réservation ET chaque paiement d'heures supplémentaires abouti", async () => {
    const appels = simuler({ supp: [{ id: "pi_supp1", status: "succeeded" }, { id: "pi_supp2", status: "succeeded" }, { id: "pi_abandon", status: "canceled" }] });
    const r = await rembourserDepuisLeBO(mission, "test");
    expect(r.ok).toBe(true);
    const rembourses = appels.filter(a => a.u.endsWith("/v1/refunds")).map(a => new URLSearchParams(a.corps).get("payment_intent"));
    expect(rembourses).toEqual(["pi_resa", "pi_supp1", "pi_supp2"]);
    expect(r.heuresSupp).toEqual({ rembourses: 2, echecs: 0 });
    expect(appels.find(a => a.corps.includes("pi_supp1")).cle).toBe("bo-refund-supp-pi_supp1");
  });

  it("recherche impossible : le remboursement principal tient, l'échec est compté", async () => {
    simuler({ rechercheOk: false });
    const r = await rembourserDepuisLeBO(mission, "test");
    expect(r.ok).toBe(true);
    expect(r.heuresSupp.echecs).toBe(1);
  });
});
