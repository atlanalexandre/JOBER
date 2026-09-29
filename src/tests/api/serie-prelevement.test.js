// Semaine suivante d'une série : un seul prélèvement, et jamais « rien n'a été
// débité » quand on ne le sait pas (relecture du 29/09/2026).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { programmerOccurrenceSuivante } from "../../../api/_recurrence.js";

const PARENT = {
  id: "11111111-1111-4111-8111-111111111111", client_id: "22222222-2222-4222-8222-222222222222",
  prestataire_id: "33333333-3333-4333-8333-333333333333", sector: "hotellerie", metier: "Femme/Valet de chambre",
  date: "2026-10-05", hours: 4, heure_debut: "09:00", tarif_horaire: 15, recurrence: "weekly",
  stripe_payment_intent: "pi_parent", status: "completed",
};
const json = (corps, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(corps), { status }));

/** Routeur de réponses simulées : base (PostgREST) et Stripe. */
function simuler({ stripeCreation }) {
  const appels = { creations: [], suppressions: 0, notifications: [] };
  vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
    const u = String(url);
    const m = opts.method || "GET";
    if (u.includes("api.stripe.com/v1/payment_intents/pi_parent")) return json({ payment_method: "pm_1", customer: "cus_1" });
    if (u.includes("api.stripe.com/v1/payment_intents") && m === "POST") {
      appels.creations.push(opts.headers["Idempotency-Key"]);
      return stripeCreation(appels.creations.length);
    }
    if (u.includes("/rest/v1/missions?id=eq.") && m === "GET") return json([PARENT]);
    if (u.includes("parent_mission_id=eq.")) return json([]);
    if (u.includes("platform_settings")) return json([{ value: { single: 4.9, pourcentage: 2 } }]);
    if (u.includes("/rest/v1/missions") && m === "POST") return json([{ id: JSON.parse(opts.body).id }], 201);
    if (u.includes("/rest/v1/missions") && m === "DELETE") { appels.suppressions++; return json(null, 204); }
    if (u.includes("/rest/v1/missions") && m === "PATCH") return json([{ id: "x" }]);
    if (u.includes("/rest/v1/notifications")) { appels.notifications.push(JSON.parse(opts.body)); return json(null, 201); }
    return json([]);
  }));
  return appels;
}

describe("semaine suivante d'une série", () => {
  beforeEach(() => { process.env.STRIPE_SECRET_KEY = "sk_test_x"; vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("clé d'idempotence fixe par prestation d'origine, pas tirée au hasard", async () => {
    const a = simuler({ stripeCreation: () => json({ id: "pi_2", status: "succeeded" }) });
    await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    expect(a.creations).toHaveLength(2);
    expect(a.creations[0]).toBe(`serie-suivante-${PARENT.id}`);
    expect(a.creations[1]).toBe(a.creations[0]);
  });

  it("appel concurrent : erreur d'idempotence = déjà programmée, doublon retiré, client non alerté", async () => {
    const a = simuler({ stripeCreation: () => json({ error: { type: "idempotency_error" } }, 400) });
    const r = await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    expect(r.mode).toBe("deja_programmee");
    expect(a.suppressions).toBe(1);
    expect(a.notifications.some(n => /interrompue/.test(n.title || ""))).toBe(false);
  });

  it("réponse perdue une fois : la requête est rejouée avec la même clé, et le paiement retrouvé", async () => {
    const a = simuler({ stripeCreation: (n) => n === 1 ? Promise.reject(new Error("ECONNRESET")) : json({ id: "pi_2", status: "succeeded" }) });
    const r = await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    expect(a.creations).toHaveLength(2);
    expect(a.creations[1]).toBe(a.creations[0]);
    expect(r.mode).not.toBe("paiement_refuse");
  });

  it("issue inconnue : jamais « rien n'a été débité »", async () => {
    const a = simuler({ stripeCreation: () => Promise.reject(new Error("ECONNRESET")) });
    const r = await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    expect(r.mode).toBe("echec");
    expect(a.notifications.some(n => /débité/.test(n.body || ""))).toBe(false);
  });

  it("carte refusée : la série s'arrête et le client est prévenu", async () => {
    const a = simuler({ stripeCreation: () => json({ error: { type: "card_error", decline_code: "insufficient_funds" } }, 402) });
    const r = await programmerOccurrenceSuivante(PARENT.id, "https://x", {});
    expect(r.mode).toBe("paiement_refuse");
    expect(a.notifications.some(n => /interrompue/.test(n.title || ""))).toBe(true);
  });
});
