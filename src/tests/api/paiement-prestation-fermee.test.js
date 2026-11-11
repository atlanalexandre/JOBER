// Un paiement réel arrivé après la fermeture de sa prestation (clôturée faute
// de paiement, annulée) n'était rendu par personne : le webhook laisse
// l'affectation à l'application, et `assign_after_payment` répondait « déjà
// traitée » (relecture du 11/11/2026).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const DATE = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);

process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ statut, rattache = null }) {
  const remb = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: CLIENT, user_metadata: { date_naissance: "1980-01-01" } });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes("/profiles?id=eq.") && u.includes("date_naissance")) return json([{ date_naissance: "1980-01-01" }]);
    if (u.includes(`/missions?id=eq.${M}&select=cashback_applique`)) return json([{ cashback_applique: 0 }]);
    if (u.includes(`/missions?id=eq.${M}&select=`)) return json([{ client_id: CLIENT, status: statut, prestataire_id: null, montant_total: 110.98,
      tarif_horaire: 13, hours: 8, date: DATE, date_debut: null, date_fin: null, stripe_payment_intent: rattache }]);
    if (u.includes("api.stripe.com/v1/payment_intents/pi_3AbcDefGhiJkl")) return json({ id: "pi_3AbcDefGhiJkl", object: "payment_intent", status: "succeeded", currency: "eur",
      amount: 11098, amount_received: 11098, latest_charge: { refunded: false, amount_refunded: 0 }, metadata: { mission: M, client: CLIENT } });
    if (u.includes("api.stripe.com/v1/refunds") && m === "POST") {
      remb.push({ pi: new URLSearchParams(String(o.body)).get("payment_intent"), cle: o.headers?.["Idempotency-Key"] });
      return json({ id: "re_1" });
    }
    return json([]);
  }));
  return remb;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const affecter = async () => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" },
    body: { action: "assign_after_payment", mission_id: M, prestataire_id: PRESTA, stripe_payment_intent: "pi_3AbcDefGhiJkl" } }, r);
  return r;
};

describe("paiement arrivé sur une prestation déjà fermée", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  for (const statut of ["closed", "cancelled"]) {
    it(`${statut}, aucun paiement rattaché : remboursé, avec la clé du webhook`, async () => {
      const remb = simuler({ statut });
      const r = await affecter();
      expect(r.statut).toBe(409);
      expect(r.corps.code).toBe("prestation_fermee");
      expect(remb).toEqual([{ pi: "pi_3AbcDefGhiJkl", cle: "refund-doublon-pi_3AbcDefGhiJkl" }]);
    });
  }
  it("déjà affectée par CE paiement (nouvel essai) : rien n'est remboursé", async () => {
    const remb = simuler({ statut: "assigned", rattache: "pi_3AbcDefGhiJkl" });
    const r = await affecter();
    expect(r.statut).toBe(409);
    expect(remb).toHaveLength(0);
  });
});
