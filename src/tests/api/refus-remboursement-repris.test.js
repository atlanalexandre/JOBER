// Refus du prestataire, ou délai de réponse écoulé, et le remboursement échoue :
// la prestation restait « refusée », l'argent gardé, et rien ne la reprenait
// (relecture du 11/11/2026). Elle est remise en attente, délai échu et sans
// prestataire, pour que la tâche planifiée la rembourse à son passage suivant.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const MISSION = {
  id: M, client_id: CLIENT, prestataire_id: PRESTA, status: "pending_acceptance", sector: "hotellerie", metier: "Femme/Valet de chambre",
  date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), heure_debut: "09:00", hours: 8, tarif_horaire: 13, montant_total: 110.98,
  stripe_payment_intent: "pi_1", ville: "Paris", adresse: "x",
};

process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ appelant, mission, rembourse }) {
  const patchs = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: appelant });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes(`/missions?id=eq.${M}`) && m === "GET") return json([mission]);
    if (u.includes("/missions?") && m === "PATCH") { patchs.push({ u, corps: JSON.parse(String(o.body)) }); return json([{ ...mission, status: "refused", prestataire_id: null }]); }
    if (u.includes("api.stripe.com/v1/refunds")) return rembourse ? json({ id: "re_1", status: "succeeded" }) : json({ error: { message: "rate limit" } }, 429);
    if (u.includes("api.stripe.com/v1/payment_intents/pi_1")) return json({ id: "pi_1", status: "succeeded", amount: 11098, amount_received: 11098, latest_charge: "ch_1" });
    if (u.includes("/auth/v1/admin/users/")) return json({ email: "", user_metadata: {} });
    return json([]);
  }));
  return patchs;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const appeler = async (body) => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body }, r);
  return r;
};
const remise = (patchs) => patchs.find(p => p.corps.status === "pending_acceptance");

describe("refusée, remboursement en échec : reprise par la tâche planifiée", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("le prestataire refuse, Stripe refuse le remboursement : remise en attente, délai échu, le prestataire qui a refusé reste exclu", async () => {
    const patchs = simuler({ appelant: PRESTA, mission: { ...MISSION, acceptance_deadline: new Date(Date.now() + 3600e3).toISOString() }, rembourse: false });
    const r = await appeler({ action: "respond_mission", mission_id: M, response: "refuse" });
    expect(r.statut).toBe(200);
    const p = remise(patchs);
    expect(p?.u).toContain("status=eq.refused");
    // Il reste inscrit (13/11/2026) : la recherche du suivant l'exclut ainsi.
    expect(p.corps).not.toHaveProperty("prestataire_id");
    expect(Date.parse(p.corps.acceptance_deadline)).toBeLessThan(Date.now());
  });
  it("délai écoulé constaté par le client, remboursement en échec : même reprise", async () => {
    const patchs = simuler({ appelant: CLIENT, mission: { ...MISSION, acceptance_deadline: new Date(Date.now() - 3600e3).toISOString() }, rembourse: false });
    const r = await appeler({ action: "acceptance_timeout", mission_id: M });
    expect(r.statut).toBe(200);
    expect(remise(patchs)?.u).toContain("status=eq.refused");
  });
  it("remboursement réussi : la prestation reste refusée", async () => {
    const patchs = simuler({ appelant: PRESTA, mission: { ...MISSION, acceptance_deadline: new Date(Date.now() + 3600e3).toISOString() }, rembourse: true });
    await appeler({ action: "respond_mission", mission_id: M, response: "refuse" });
    expect(remise(patchs)).toBeUndefined();
  });
});
