import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import handler from "../../../api/stripe-webhook.js";

// Décision d'Alexandre du 30/09/2026 : une contestation bancaire retient le
// versement du prestataire (CGPS art. 7.4). Sans retenue, une contestation arrivée
// pendant les 48 h laissait partir le virement.

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
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function simuler(mission) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: o.body });
    if (u.includes("/rest/v1/missions?stripe_payment_intent")) return new Response(JSON.stringify([mission]), { status: 200 });
    if (u.includes("/rest/v1/missions?id=") && o.method === "PATCH") return new Response(JSON.stringify([{ id: mission.id }]), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}
const evenement = { type: "charge.dispute.created", data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 11098, reason: "fraudulent", status: "needs_response" } } };

describe("contestation bancaire", () => {
  it("versement en attente : retenu 90 jours au plus, motif « opposition bancaire », prestataire prévenu", async () => {
    const appels = simuler({ id: "m1", client_id: "c1", prestataire_id: "p1", payout_status: "pending", payout_amount: 104 });
    const res = reponse();
    await handler(requete(evenement), res);
    expect(res.statut).toBe(200);
    const retenue = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(retenue.u).toContain("payout_status=in.(pending,failed)");
    const corps = JSON.parse(retenue.corps);
    expect(corps.payout_status).toBe("held");
    expect(corps.payout_hold_reason).toBe("opposition_bancaire");
    const jours = (new Date(corps.payout_hold_until) - new Date(corps.payout_hold_at)) / 86400000;
    expect(Math.round(jours)).toBe(90);
    expect(appels.some(a => a.u.includes("/rest/v1/notifications") && a.corps.includes("opposition bancaire"))).toBe(true);
  });

  it("versement déjà parti : rien n'est réécrit", async () => {
    const appels = simuler({ id: "m1", client_id: "c1", prestataire_id: "p1", payout_status: "transferred", payout_amount: 104 });
    await handler(requete(evenement), reponse());
    expect(appels.some(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"))).toBe(false);
  });
});
