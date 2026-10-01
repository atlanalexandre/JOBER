// Parrainage : « 3 filleuls abonnés = 1 mois offert » (décision d'Alexandre du 01/10/2026).
//
// Pour un parrain déjà ABONNÉ, on n'avançait que sa date de fin en base : Stripe
// continuait de le prélever, et le mois n'était pas offert. Un avoir du prix d'un
// mois est désormais créé chez Stripe, déduit de sa prochaine facture.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import handler from "../../../api/stripe-webhook.js";

const SECRET = "whsec_test";
function requete(evenement) {
  const corps = JSON.stringify(evenement);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${corps}`).digest("hex");
  const req = Readable.from([Buffer.from(corps)]);
  req.method = "POST";
  req.headers = { "stripe-signature": `t=${t},v1=${sig}` };
  return req;
}
const reponse = () => { const r = { statut: 0 }; r.status = (s) => { r.statut = s; return r; }; r.json = () => r; r.end = () => r; return r; };

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("VITE_SUPABASE_URL", "https://b.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const evenement = { type: "checkout.session.completed", data: { object: {
  metadata: { user_id: "filleul", plan: "premium", billing: "monthly" }, subscription: "sub_filleul", customer: "cus_filleul" } } };

function simuler({ parrain, reservationReussit = true }) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: o.body, cle: o.headers?.["Idempotency-Key"] });
    if (u.includes("/v1/subscriptions/sub_filleul")) return new Response(JSON.stringify({ current_period_end: 2_000_000_000 }), { status: 200 });
    if (u.includes("/v1/subscriptions/sub_parrain")) return new Response(JSON.stringify({ items: { data: [{ price: { unit_amount: 2999, recurring: { interval: "month" } } }] } }), { status: 200 });
    if (u.includes("/balance_transactions")) return new Response(JSON.stringify({ id: "cbtxn_1" }), { status: 200 });
    if (u.includes("/auth/v1/admin/users/filleul")) return new Response(JSON.stringify({ id: "filleul", user_metadata: {} }), { status: 200 });
    if (u.includes("profiles?id=eq.filleul&select=referred_by")) return new Response(JSON.stringify([{ referred_by: "parrain" }]), { status: 200 });
    if (u.includes("profiles?id=eq.parrain&select=")) return new Response(JSON.stringify([parrain]), { status: 200 });
    if (o.method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-2/3" } });
    if (u.includes("profiles?id=eq.parrain&referral_rewards_granted=eq.")) {
      return new Response(JSON.stringify(reservationReussit ? [{ id: "parrain" }] : []), { status: 200 });
    }
    if (o.method === "PATCH") return new Response(JSON.stringify([{ id: "x" }]), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}

describe("parrainage : mois offert", () => {
  it("parrain abonné : un avoir d'un mois chez Stripe, sans toucher à sa date de fin", async () => {
    const appels = simuler({ parrain: { plan_abonnement: "premium", subscription_end_date: "2026-10-20", referral_rewards_granted: 0,
      stripe_customer_id: "cus_parrain", stripe_subscription_id: "sub_parrain" } });
    await handler(requete(evenement), reponse());
    const avoir = appels.find(a => a.u.includes("/customers/cus_parrain/balance_transactions"));
    expect(avoir, "un avoir est créé chez Stripe").toBeTruthy();
    expect(avoir.corps).toContain("amount=-2999");
    expect(avoir.cle).toBe("parrainage-parrain-1");
    const majParrain = appels.filter(a => a.methode === "PATCH" && a.u.includes("profiles?id=eq.parrain"));
    expect(majParrain.every(a => !String(a.corps).includes("subscription_end_date")), "la date de fin reste celle de Stripe").toBe(true);
  });

  it("deux livraisons du webhook : la seconde n'accorde rien", async () => {
    const appels = simuler({ parrain: { plan_abonnement: "premium", referral_rewards_granted: 0,
      stripe_customer_id: "cus_parrain", stripe_subscription_id: "sub_parrain" }, reservationReussit: false });
    await handler(requete(evenement), reponse());
    expect(appels.some(a => a.u.includes("/balance_transactions"))).toBe(false);
  });

  it("parrain gratuit : un mois de Premium, comme avant, et pas d'avoir", async () => {
    const appels = simuler({ parrain: { plan_abonnement: "free", referral_rewards_granted: 0 } });
    await handler(requete(evenement), reponse());
    expect(appels.some(a => a.u.includes("/balance_transactions"))).toBe(false);
    const maj = appels.find(a => a.methode === "PATCH" && a.u.includes("profiles?id=eq.parrain&referral_rewards_granted=eq.0"));
    expect(JSON.parse(maj.corps).plan_abonnement).toBe("premium");
  });
});
