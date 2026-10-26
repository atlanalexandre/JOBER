// Prolongations payées mais jamais appliquées (relecture du 23/10/2026) :
// le client fermait l'application entre le paiement et la confirmation.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../api/missions.js", () => ({ appliquerHeuresSupp: vi.fn() }));
const { appliquerHeuresSupp } = await import("../../../api/missions.js");
const { decisionRattrapage, rattraperProlongations, DELAI_AVANT_RATTRAPAGE_MS } = await import("../../../api/_rattrapage_heures_supp.js");

const T = Date.parse("2026-10-26T12:00:00Z");
const ancien = Math.floor((T - DELAI_AVANT_RATTRAPAGE_MS - 60000) / 1000);
const pi = (extra = {}) => ({ id: "pi_hs", created: ancien, amount_received: 4200, metadata: { type: "heures_supp", mission: "m1", client: "c1", deja_appliquees: "0" }, latest_charge: { refunded: false, amount_refunded: 0 }, ...extra });
const mission = (extra = {}) => ({ id: "m1", client_id: "c1", status: "assigned", extra_hours_payment_intent: null, extra_hours_appliquees: 0, heures_ajoutees_total: 0, heures_ajoutees_detail: [], ...extra });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); appliquerHeuresSupp.mockReset(); });

describe("decisionRattrapage", () => {
  it("payé, non rattaché, compteur inchangé : appliquer", () => {
    expect(decisionRattrapage(mission(), pi(), T)).toBe("appliquer");
  });
  it("moins de 15 minutes : l'application a encore la main", () => {
    expect(decisionRattrapage(mission(), pi({ created: Math.floor(T / 1000) - 60 }), T)).toBe("rien");
  });
  it("déjà rattaché (prestation d'un jour, ou détail par journée) : rien", () => {
    expect(decisionRattrapage(mission({ extra_hours_payment_intent: "pi_hs" }), pi(), T)).toBe("rien");
    expect(decisionRattrapage(mission({ heures_ajoutees_detail: [{ jour: "2026-10-26", paiement: "pi_hs" }] }), pi(), T)).toBe("rien");
  });
  it("déjà remboursé : rien", () => {
    expect(decisionRattrapage(mission(), pi({ latest_charge: { refunded: true } }), T)).toBe("rien");
  });
  it("le compteur a bougé : une prolongation a été appliquée — un humain tranche, ni application ni remboursement", () => {
    expect(decisionRattrapage(mission({ extra_hours_appliquees: 2 }), pi(), T)).toBe("signaler");
  });
  it("paiement sans repère : signaler", () => {
    expect(decisionRattrapage(mission(), pi({ metadata: { type: "heures_supp", mission: "m1", client: "c1" } }), T)).toBe("signaler");
  });
  it("prestation absente de cette base (compte Stripe de test partagé entre recette et production) : rien", () => {
    expect(decisionRattrapage(null, pi(), T)).toBe("rien");
  });
});

function simuler({ paiements, prestation }) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: o.body, entetes: o.headers });
    if (u.includes("payment_intents/search")) return new Response(JSON.stringify({ data: paiements }), { status: 200 });
    if (u.includes("/rest/v1/missions?id=eq.")) return new Response(JSON.stringify(prestation ? [prestation] : []), { status: 200 });
    if (u.includes("/v1/refunds")) return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}

describe("rattraperProlongations", () => {
  it("applique par la même fonction que l'application, au nom du client du paiement", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    simuler({ paiements: [pi()], prestation: mission() });
    appliquerHeuresSupp.mockResolvedValue({ code: 200, corps: { ok: true } });
    const bilan = await rattraperProlongations({ SUPABASE_URL: "https://b.test", headers: {}, cleStripe: "sk", maintenantMs: T });
    expect(appliquerHeuresSupp).toHaveBeenCalledWith(expect.objectContaining({ missionId: "m1", paymentIntent: "pi_hs", clientId: "c1" }));
    expect(bilan).toEqual({ appliquees: 1, remboursees: 0, signalees: 0 });
  });
  it("plus applicable et jamais appliqué : remboursé, avec la clé de l'application (jamais deux remboursements)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = simuler({ paiements: [pi()], prestation: mission() });
    appliquerHeuresSupp.mockResolvedValue({ code: 409, corps: { error: "Aucune prolongation en attente" } });
    const bilan = await rattraperProlongations({ SUPABASE_URL: "https://b.test", headers: {}, cleStripe: "sk", maintenantMs: T });
    const remb = appels.find(a => a.u.includes("/v1/refunds"));
    expect(remb.entetes["Idempotency-Key"]).toBe("refund-heures-supp-pi_hs");
    expect(bilan.remboursees).toBe(1);
  });
  it("panne passagère : ni remboursement ni ticket, au prochain passage", async () => {
    const appels = simuler({ paiements: [pi()], prestation: mission() });
    appliquerHeuresSupp.mockResolvedValue({ code: 502, corps: { error: "Stripe" } });
    await rattraperProlongations({ SUPABASE_URL: "https://b.test", headers: {}, cleStripe: "sk", maintenantMs: T });
    expect(appels.some(a => a.u.includes("/v1/refunds") || a.u.includes("support_tickets"))).toBe(false);
  });
  it("dans le doute : un ticket, une seule fois, et rien d'autre", async () => {
    const appels = simuler({ paiements: [pi()], prestation: mission({ extra_hours_appliquees: 2 }) });
    await rattraperProlongations({ SUPABASE_URL: "https://b.test", headers: {}, cleStripe: "sk", maintenantMs: T });
    expect(appliquerHeuresSupp).not.toHaveBeenCalled();
    expect(appels.some(a => a.u.includes("/v1/refunds"))).toBe(false);
    expect(appels.some(a => a.methode === "POST" && a.u.includes("support_tickets"))).toBe(true);
  });
});

describe("branché sur cron-abandon, et l'application passe par la même fonction", async () => {
  const { readFileSync } = await import("node:fs");
  it("cron-abandon appelle le rattrapage ; confirmer_heures_supp appelle appliquerHeuresSupp", () => {
    const cron = readFileSync(new URL("../../../api/cron-abandon.js", import.meta.url), "utf8");
    const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    expect(cron).toMatch(/await rattraperProlongations\(/);
    expect(missions).toMatch(/const resultat = await appliquerHeuresSupp\(\{ missionId: mission_id, paymentIntent: payment_intent, clientId: caller\.id/);
  });
});

describe("appliquerHeuresSupp : extraite sans rien changer", async () => {
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const fonction = code.slice(code.indexOf("export async function appliquerHeuresSupp"), code.indexOf("export default async function handler"));
  it("les noms de colonnes et l'adresse Stripe ne sont pas renommés avec les variables", () => {
    // L'extraction du 26/10/2026 avait d'abord transformé `extra_hours_payment_intent`
    // en `extra_hours_paymentIntent` : la base refusait la lecture (« Prestation
    // introuvable »). La recette l'a vu, pas les tests unitaires.
    expect(fonction).not.toMatch(/_paymentIntent|paymentIntents\//);
    expect(fonction).toContain("extra_hours_payment_intent,");
    expect(fonction).toContain("https://api.stripe.com/v1/payment_intents/");
    expect(fonction).toContain("extra_hours_payment_intent: paymentIntent,");
    // Paramètre de l'API Stripe, pas la variable : le remboursement échouait.
    expect(fonction).toContain("new URLSearchParams({ payment_intent: pi.id, reason: \"requested_by_customer\" })");
    expect(fonction).not.toMatch(/\{ paymentIntent: /);
  });
});
