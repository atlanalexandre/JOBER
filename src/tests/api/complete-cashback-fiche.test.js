// Validation par le client (`complete`) et cashback (relecture du 21/11/2026) :
//   - fiche du client illisible : rien n'est crédité (le palier serait celui
//     d'un premier achat, et le solde de secours repartirait de zéro) ;
//   - le crédit de secours, en valeur absolue, est conditionné au solde et au
//     compteur lus — il effaçait un crédit ou un débit survenu entre-temps.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const MISSION = { id: M, client_id: CLIENT, prestataire_id: "44444444-4444-4444-8444-444444444444", status: "assigned", validation_prestataire: true,
  hours: 4, tarif_horaire: 15, montant_total: 66.1, stripe_payment_intent: "pi_1", metier: "Femme/Valet de chambre", sector: "hotellerie",
  date: "2026-11-20", heure_debut: "09:00", started_at: "2026-11-20T08:00:00Z" };
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ fiche, rpcOk = true }) {
  const a = { rpc: 0, secours: [], notifs: [] };
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: CLIENT });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes(`/missions?id=eq.${M}&select=`)) return json([MISSION]);
    if (u.includes(`/missions?id=eq.${M}&status=eq.assigned`) && m === "PATCH") return json([{ ...MISSION, status: "completed" }]);
    if (u.includes(`/profiles?id=eq.${CLIENT}&select=cashback_balance`)) return fiche ? json([fiche]) : json({ message: "panne" }, 503);
    if (u.includes("/rpc/increment_cashback")) { a.rpc++; return rpcOk ? json([{ cashback_balance: 1 }]) : json({ message: "non" }, 500); }
    if (u.includes(`/profiles?id=eq.${CLIENT}`) && m === "PATCH") { a.secours.push(u); return json([{ id: CLIENT }]); }
    if (u.includes("/rest/v1/notifications") && m === "POST") { a.notifs.push(String(o.body)); return json([]); }
    return json([]);
  }));
  return a;
}
const valider = async () => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = { statut: 0, corps: null };
  r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r;
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { action: "complete", mission_id: M } }, r);
  return r;
};

describe("validation par le client — cashback", () => {
  beforeEach(() => { vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"); for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("fiche du client illisible : rien n'est crédité, ni par la procédure ni en secours, et c'est journalisé", async () => {
    const a = simuler({ fiche: null });
    const r = await valider();
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(a.rpc).toBe(0);
    expect(a.secours).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("palier inconnu"));
    expect(a.notifs.filter(n => n.includes(CLIENT)).join(" ")).not.toContain("Cashback");
  });
  it("crédit refusé : le secours en valeur absolue est conditionné au solde et au compteur lus", async () => {
    const a = simuler({ fiche: { cashback_balance: 42, commandes_mois: 6 }, rpcOk: false });
    expect((await valider()).statut).toBe(200);
    expect(a.secours).toHaveLength(1);
    expect(a.secours[0]).toContain("cashback_balance=eq.42");
    expect(a.secours[0]).toContain("commandes_mois=eq.6");
  });
});
