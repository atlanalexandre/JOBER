// Relecture des chemins d'argent du 23/10/2026 : chaque constat retenu, prouvé.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import handler from "../../../api/stripe-webhook.js";
import { debiterCashback } from "../../../api/_cashback.js";

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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const paiement = { type: "payment_intent.succeeded", data: { object: {
  id: "pi_1", object: "payment_intent", status: "succeeded", amount: 11098, amount_received: 11098,
  metadata: { mission: "m1", client: "cl1", candidature_id: "cand1", prestataire_id: "p1" } } } };

function simuler(reponses) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: o.body, entetes: o.headers });
    for (const [motif, rep] of reponses) if (motif(u, o)) return typeof rep === "function" ? rep() : new Response(JSON.stringify(rep), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}

describe("candidature introuvable au paiement : le paiement est rendu", () => {
  it("rien n'est affecté, et le paiement encaissé est remboursé une fois (clé propre)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null }]],
      [(u) => u.includes("/v1/refunds"), { id: "re_1" }],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    expect(res.statut).toBe(200);
    const remb = appels.find(a => a.u.includes("/v1/refunds"));
    expect(remb, "remboursement demandé").toBeTruthy();
    expect(remb.entetes["Idempotency-Key"]).toBe("refund-orphelin-pi_1");
    expect(appels.some(a => a.methode === "PATCH" && a.u.includes("/rest/v1/missions"))).toBe(false);
  });
  it("déjà rattaché à la prestation (livraison répétée) : aucun remboursement", async () => {
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: "pi_1" }]],
    ]);
    await handler(requete(paiement), reponse());
    expect(appels.some(a => a.u.includes("/v1/refunds"))).toBe(false);
  });
  it("prestation illisible : 500, pas de remboursement à l'aveugle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), () => new Response("{}", { status: 503 })],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    expect(res.statut).toBe(500);
    expect(appels.some(a => a.u.includes("/v1/refunds"))).toBe(false);
  });
});

describe("un second paiement n'écrase pas le premier", () => {
  it("l'affectation par le webhook exige qu'aucun autre paiement ne soit rattaché", () => {
    const w = readFileSync(new URL("../../../api/stripe-webhook.js", import.meta.url), "utf8");
    expect(w).toMatch(/status=not\.in\.\(completed,closed,cancelled,refused,rejected,assigned\)`\n\s+\+ `&or=\(stripe_payment_intent\.is\.null,stripe_payment_intent\.eq\.\$\{encodeURIComponent\(intent\.id\)\}\)`/);
  });
  it("une contestation retrouve aussi la prestation par le paiement d'une prolongation", () => {
    const w = readFileSync(new URL("../../../api/stripe-webhook.js", import.meta.url), "utf8");
    const bloc = w.slice(w.indexOf('event.type === "charge.dispute.created"'));
    expect(bloc).toMatch(/missions\?or=\(stripe_payment_intent\.eq\.\$\{encodeURIComponent\(dispute\.payment_intent\)\},extra_hours_payment_intent\.eq\./);
  });
});

describe("cashback : payé plein tarif, rien n'est pris sur le solde", () => {
  const mission = { id: "m1", client_id: "cl1", montant_total: 110.98, cashback_applique: 5, cashback_debite: false, stripe_payment_intent: "pi_1" };
  it("la carte a payé le prix plein : pas de débit, la réduction inscrite retombe à zéro", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("api.stripe.com/v1/payment_intents/pi_1"), { id: "pi_1", amount: 11098, amount_received: 11098 }],
    ]);
    const r = await debiterCashback(mission, "https://b.test", {});
    expect(r).toEqual({ debite: 0, ok: true });
    const efface = appels.find(a => a.methode === "PATCH" && a.u.includes("/rest/v1/missions?id=eq.m1"));
    expect(JSON.parse(efface.corps)).toEqual({ cashback_applique: 0 });
    expect(appels.some(a => a.u.includes("/rest/v1/profiles") || a.u.includes("/rpc/"))).toBe(false);
  });
  it("la carte a payé le prix réduit : le débit suit son cours", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("api.stripe.com/v1/payment_intents/pi_1"), { id: "pi_1", amount: 10598, amount_received: 10598 }],
    ]);
    await debiterCashback(mission, "https://b.test", {});
    expect(appels.some(a => a.u.includes("/rpc/") || a.u.includes("cashback_debite"))).toBe(true);
  });
});

describe("série : semaine payée mais non affectée", () => {
  it("l'équipe est prévenue par courriel, comme pour le prélèvement incertain", () => {
    const r = readFileSync(new URL("../../../api/_recurrence.js", import.meta.url), "utf8");
    const bloc = r.slice(r.indexOf("PAYÉE (${pi}) mais NON affectée"));
    expect(bloc.slice(0, 1500)).toMatch(/sendEmail\(\{\s+to: admin,\s+subject: `⚠️ Série hebdomadaire : semaine payée mais non affectée`/);
  });
});
