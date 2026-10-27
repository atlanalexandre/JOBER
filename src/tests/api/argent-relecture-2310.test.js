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

describe("candidature introuvable au paiement : l'équipe est prévenue, rien n'est remboursé d'office", () => {
  // Relecture du 24/10/2026 : le remboursement d'office croisait le rattachement
  // par l'application — prestation attribuée sur un paiement rendu.
  it("rien n'est affecté ni remboursé ; l'administrateur reçoit une alerte", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ADMIN_EMAIL", "admin@exemple.fr");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null }]],
      [(u) => u.includes("api.resend.com"), { id: "e1" }],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    expect(res.statut).toBe(200);
    expect(appels.some(a => a.u.includes("/v1/refunds"))).toBe(false);
    expect(appels.some(a => a.methode === "PATCH" && a.u.includes("/rest/v1/missions"))).toBe(false);
    expect(appels.some(a => a.u.includes("api.resend.com") && a.corps.includes("Paiement sans candidature"))).toBe(true);
  });
  it("une trace durable : un ticket de support au nom du client (relecture du 25/10/2026)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null }]],
      [(u) => u.includes("/rest/v1/support_tickets"), () => new Response("", { status: 201 })],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    const ticket = appels.find(a => a.u.includes("/rest/v1/support_tickets") && a.methode === "POST");
    expect(JSON.parse(ticket.corps).user_id).toBe("cl1");
    expect(JSON.parse(ticket.corps).subject).toMatch(/^\[Interne\] .*pi_1$/);
    expect(res.statut).toBe(200);
  });
  it("sans client dans le paiement, le ticket prend celui de la prestation ; et un seul ticket par paiement (relecture du 26/10/2026)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sansClient = { ...paiement, data: { object: { ...paiement.data.object, metadata: { mission: "m1", candidature_id: "cand1", prestataire_id: "p1" } } } };
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null, client_id: "cl9" }]],
      [(u, o) => u.includes("/rest/v1/support_tickets") && o.method === "POST", () => new Response("", { status: 201 })],
    ]);
    await handler(requete(sansClient), reponse());
    expect(JSON.parse(appels.find(a => a.methode === "POST" && a.u.includes("support_tickets")).corps).user_id).toBe("cl9");
    const deja = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null, client_id: "cl9" }]],
      [(u, o) => u.includes("/rest/v1/support_tickets?subject=like") && !o.method, [{ id: "t1" }]],
    ]);
    await handler(requete(sansClient), reponse());
    expect(deja.some(a => a.methode === "POST" && a.u.includes("support_tickets"))).toBe(false);
  });
  it("ni ticket ni courriel : 500, Stripe réémettra", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null }]],
      [(u) => u.includes("/rest/v1/support_tickets"), () => new Response("{}", { status: 500 })],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    expect(res.statut).toBe(500);
  });
  it("sans client (aucun ticket possible) et courriel en échec : 500, Stripe réémettra (relecture du 27/10/2026)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ADMIN_EMAIL", "admin@exemple.fr");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    const sansClient = { ...paiement, data: { object: { ...paiement.data.object, metadata: { mission: "m1", candidature_id: "cand1", prestataire_id: "p1" } } } };
    simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: null, client_id: null }]],
      [(u) => u.includes("api.resend.com"), () => new Response("{}", { status: 503 })],
    ]);
    const res = reponse();
    await handler(requete(sansClient), res);
    expect(res.statut).toBe(500);
  });
  it("déjà rattaché à la prestation : aucune alerte", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@exemple.fr");
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), []],
      [(u) => u.includes("/rest/v1/missions?id=eq.m1&select=stripe_payment_intent"), [{ stripe_payment_intent: "pi_1" }]],
    ]);
    await handler(requete(paiement), reponse());
    expect(appels.some(a => a.u.includes("api.resend.com") || a.u.includes("/v1/refunds"))).toBe(false);
  });
  it("candidatures illisibles (erreur de la base) : 500, ce n'est pas « introuvable »", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler([
      [(u) => u.includes("/rest/v1/candidatures?"), () => new Response(JSON.stringify({ message: "panne" }), { status: 503 })],
    ]);
    const res = reponse();
    await handler(requete(paiement), res);
    expect(res.statut).toBe(500);
    expect(appels.some(a => a.u.includes("/v1/refunds") || a.u.includes("api.resend.com"))).toBe(false);
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
