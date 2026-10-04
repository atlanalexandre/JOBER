// Un second paiement pour une prestation déjà réglée est remboursé
// (relecture du 04/10/2026). Deux candidatures acceptées, deux onglets : le
// webhook du second paiement trouvait la prestation déjà traitée et s'arrêtait,
// l'argent restant encaissé sans contrepartie.
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

const evenement = { type: "payment_intent.succeeded", data: { object: {
  id: "pi_second", amount: 11098, metadata: { mission: "m1", candidature_id: "c1", prestataire_id: "p1" } } } };

function simuler({ paiementEnBase }) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: String(o.body || ""), cle: o.headers?.["Idempotency-Key"] });
    if (u.includes("/candidatures?id=eq.c1")) return new Response(JSON.stringify([{ id: "c1" }]), { status: 200 });
    if (u.includes("stripe_payment_intent=eq.pi_second")) return new Response("[]", { status: 200 });
    if (u.includes("/profiles?")) return new Response(JSON.stringify([{ id: "p1", status: "approved", missions_enabled: true }]), { status: 200 });
    if (o.method === "PATCH" && u.includes("/missions?id=eq.m1")) return new Response("[]", { status: 200 }); // déjà traitée
    if (u.includes("/missions?id=eq.m1&select=stripe_payment_intent,status")) {
      return new Response(JSON.stringify([{ stripe_payment_intent: paiementEnBase, status: "assigned" }]), { status: 200 });
    }
    if (u.endsWith("/v1/refunds")) return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}

describe("webhook : paiement en double", () => {
  it("prestation déjà réglée par un AUTRE paiement : le second est remboursé", async () => {
    const appels = simuler({ paiementEnBase: "pi_premier" });
    const r = reponse();
    await handler(requete(evenement), r);
    expect(r.statut).toBe(200);
    const remb = appels.find(a => a.u.endsWith("/v1/refunds"));
    expect(remb, "un remboursement est émis").toBeTruthy();
    expect(new URLSearchParams(remb.corps).get("payment_intent")).toBe("pi_second");
    expect(remb.cle).toBe("refund-doublon-pi_second");
  });

  it("prestation réglée par CE paiement (livraison répétée) : rien n'est remboursé", async () => {
    const appels = simuler({ paiementEnBase: "pi_second" });
    await handler(requete(evenement), reponse());
    expect(appels.some(a => a.u.endsWith("/v1/refunds"))).toBe(false);
  });
});
