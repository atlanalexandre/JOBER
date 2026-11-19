// « Valider de force » au back-office (relecture du 18/11/2026) :
//   - la clôture est conditionnée au prestataire LU : une cascade a pu confier
//     la prestation à un autre entre la lecture et l'écriture ;
//   - un cashback non crédité n'est pas annoncé au client.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const MISSION = { id: M, status: "assigned", client_id: CLIENT, prestataire_id: PRESTA, hours: 4, tarif_horaire: 13, montant_total: 60.6,
  date: "2026-11-10", heure_debut: "09:00", metier: "Femme/Valet de chambre", sector: "hotellerie", stripe_payment_intent: "pi_1" };

function jeton() {
  const ts = String(Math.floor(Date.now() / 1000)), nonce = "abcdef0123456789";
  return `Bearer ${ts}.${nonce}.${crypto.createHmac("sha256", "secret").update(`${ts}.${nonce}`).digest("hex")}`;
}
function simuler({ cashbackOk = true } = {}) {
  const ecrits = [], notifs = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET", corps = o.body ? String(o.body) : "";
    if (u.includes(`/missions?id=eq.${M}&select=`)) return json([MISSION]);
    if (u.includes(`/missions?id=eq.${M}&status=eq.`) && m === "PATCH") { ecrits.push(u); return json([{ ...MISSION, status: "completed" }]); }
    if (u.includes("/rpc/increment_cashback")) return cashbackOk ? json({}) : json({ message: "non" }, 500);
    if (u.includes("/profiles?id=eq.") && m === "GET") return json([{ cashback_balance: 0, commandes_mois: 0 }]);
    if (u.includes("/rest/v1/notifications") && m === "POST") { notifs.push(corps); return json([]); }
    return json([]);
  }));
  return { ecrits, notifs };
}
const valider = async () => {
  const { default: handler } = await import("../../../api/bo-action.js");
  const r = { statut: 0, corps: null };
  r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r;
  await handler({ method: "POST", headers: { authorization: jeton() }, body: { action: "force_complete_mission", mission_id: M } }, r);
  return r;
};

describe("valider de force", () => {
  beforeEach(() => { vi.stubEnv("BO_SESSION_SECRET", "secret"); vi.stubEnv("VITE_SUPABASE_URL", "https://b.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("la clôture ne s'écrit que sur la prestation encore au prestataire lu", async () => {
    const { ecrits } = simuler();
    const r = await valider();
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(ecrits[0]).toContain(`prestataire_id=eq.${PRESTA}`);
  });
  it("cashback non crédité : ni annoncé au client, ni rendu comme crédité", async () => {
    const { notifs } = simuler({ cashbackOk: false });
    const r = await valider();
    expect(r.corps.cashback).toBe(0);
    expect(r.corps.cashbackNonCredite).toBe(true);
    expect(notifs.filter(n => n.includes(CLIENT)).join(" ")).not.toContain("Cashback");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("NON crédité"));
  });
  it("cashback crédité : annoncé", async () => {
    const { notifs } = simuler();
    const r = await valider();
    expect(r.corps.cashback).toBeGreaterThan(0);
    expect(notifs.filter(n => n.includes(CLIENT)).join(" ")).toContain("Cashback");
  });
});
