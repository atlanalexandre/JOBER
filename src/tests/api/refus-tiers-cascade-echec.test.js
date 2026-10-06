// Réservation chez un tiers refusée par le prestataire, et la cascade échoue
// (ni candidat suivant ni diffusion n'ont pu être écrits) : la prestation, déjà
// « refusée », restait payée sans personne ni remboursement (relecture du
// 05/10/2026). Elle est désormais remboursée, comme un refus ordinaire.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const MISSION = {
  id: M, client_id: CLIENT, prestataire_id: PRESTA, sector: "hotellerie", metier: "Femme/Valet de chambre",
  date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), heure_debut: "09:00", hours: 8, tarif_horaire: 13, montant_total: 110.98,
  stripe_payment_intent: "pi_1", acceptance_deadline: new Date(Date.now() + 3600e3).toISOString(),
  tiers_declaration: { lieu: "client", beneficiaire: "Hôtel" }, ville: "Paris", adresse: "x",
};

// Les variables sont lues au chargement de missions.js : posées avant l'import.
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ basculeOk, statutApres = "refused", mission = MISSION }) {
  const appels = { remboursements: 0 };
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url);
    const m = o.method || "GET";
    const corps = o.body ? String(o.body) : "";
    if (u.endsWith("/auth/v1/user")) return json({ id: PRESTA });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes(`/missions?id=eq.${M}&prestataire_id=eq.`) && m === "GET") return json([mission]);
    if (u.includes(`/missions?id=eq.${M}&select=status`) && m === "GET") return json([{ status: statutApres }]);
    if (u.includes("/missions?") && m === "PATCH" && corps.includes('"status":"open"')) { appels.bascules = (appels.bascules || 0) + 1; return basculeOk ? json([{ id: M }]) : json({ message: "refus" }, 500); }
    if (u.includes("/missions?") && m === "PATCH" && corps.includes('"status":"pending_acceptance"')) { appels.affectations = (appels.affectations || 0) + 1; return json([{ id: M }]); }
    if (u.includes("/missions?") && m === "PATCH") return json([{ ...MISSION, status: "refused", prestataire_id: null }]);
    if (u.includes("api.stripe.com/v1/refunds")) { appels.remboursements++; return json({ id: "re_1", status: "succeeded" }); }
    if (u.includes("api.stripe.com/v1/payment_intents/pi_1")) return json({ id: "pi_1", status: "succeeded", amount: 11098, amount_received: 11098, latest_charge: "ch_1" });
    if (u.includes("/auth/v1/admin/users/")) return json({ email: "", user_metadata: {} });
    return json([]);
  }));
  return appels;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const refuser = async () => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { action: "respond_mission", mission_id: M, response: "refuse" } }, r);
  return r;
};

describe("refus d'une réservation chez un tiers", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("cascade en échec : le client est remboursé", async () => {
    const a = simuler({ basculeOk: false });
    const r = await refuser();
    expect(r.statut).toBe(200);
    expect(a.remboursements).toBe(1);
  });

  it("cascade réussie (diffusion) : la commande tient, aucun remboursement", async () => {
    const a = simuler({ basculeOk: true });
    const r = await refuser();
    expect(r.statut).toBe(200);
    expect(a.remboursements).toBe(0);
  });

  // Relecture du 06/10/2026 : la bascule a pu aboutir malgré une réponse perdue.
  it("cascade en échec mais prestation déjà rediffusée : pas de remboursement", async () => {
    const a = simuler({ basculeOk: false, statutApres: "open" });
    const r = await refuser();
    expect(r.statut).toBe(200);
    expect(a.remboursements).toBe(0);
  });

  it("refus après l'heure de début : pas de candidat suivant, remboursement", async () => {
    const hier = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const a = simuler({ basculeOk: true, mission: { ...MISSION, date: hier, acceptance_deadline: new Date(Date.now() + 3600e3).toISOString() } });
    const r = await refuser();
    expect(r.statut).toBe(200);
    expect(a.bascules || 0).toBe(0);
    expect(a.affectations || 0).toBe(0);
    expect(a.remboursements).toBe(1);
  });
});
