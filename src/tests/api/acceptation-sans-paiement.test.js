// Accepter une candidature n'attribue jamais la prestation sans paiement
// (relecture du 05/10/2026). Quand Stripe ne rend pas de paiement — erreur, ou
// double clic : même clé d'idempotence, « requête en cours » (409) —, le code
// retombait sur l'affectation : prestation attribuée, rien encaissé.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CAND = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));

function simuler(reponseStripe) {
  const affectations = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url);
    const m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: CLIENT });
    if (u.includes("select=status") && !u.includes("missions")) return json([{ status: "approved" }]);
    if (u.includes("/candidatures?id=eq.") && m === "GET") return json([{ id: CAND, prestataire_id: PRESTA }]);
    if (u.includes("/profiles?id=eq.") && u.includes("plan_abonnement")) return json([{ plan_abonnement: "elite", missions_completed_month: 0 }]);
    if (u.includes(`/missions?id=eq.${M}&select=`)) return json([{ client_id: CLIENT, status: "open", tarif_horaire: 13, hours: 8, date: "2026-10-12", heure_debut: "09:00", stripe_payment_intent: null }]);
    if (u.includes("api.stripe.com/v1/payment_intents") && m === "POST") return reponseStripe();
    if (u.includes("/missions?id=eq.") && m === "PATCH") { affectations.push(JSON.parse(o.body)); return json([{ id: M, prestataire_id: PRESTA }]); }
    return json([]);
  }));
  return affectations;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.end = () => r; r.setHeader = () => r; return r; };
const accepter = async () => {
  const r = reponse();
  const { default: handler } = await import("../../../api/missions.js");
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { action: "accept", mission_id: M, candidature_id: CAND } }, r);
  return r;
};

// Les variables sont lues au chargement de missions.js : posées avant l'import.
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

describe("accepter une candidature", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://b.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("Stripe répond « requête en cours » (double clic) : 409, et la prestation n'est pas attribuée", async () => {
    const affectations = simuler(() => json({ error: { type: "idempotency_error" } }, 409));
    const r = await accepter();
    expect(r.statut).toBe(409);
    expect(affectations.some(a => a.status === "assigned")).toBe(false);
  });

  it("Stripe en erreur : 502, et la prestation n'est pas attribuée", async () => {
    const affectations = simuler(() => json({ error: { type: "api_error" } }, 500));
    const r = await accepter();
    expect(r.statut).toBe(502);
    expect(affectations.some(a => a.status === "assigned")).toBe(false);
  });

  it("paiement créé : le client reçoit de quoi payer, rien n'est attribué avant", async () => {
    const affectations = simuler(() => json({ id: "pi_1", client_secret: "pi_1_secret" }));
    const r = await accepter();
    expect(r.statut).toBe(200);
    expect(r.corps.client_secret).toBe("pi_1_secret");
    expect(affectations.some(a => a.status === "assigned")).toBe(false);
  });
});
