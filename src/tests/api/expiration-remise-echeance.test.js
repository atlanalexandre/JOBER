// Expiration d'une prestation affectée par la PLATEFORME (chez un tiers) : la
// tâche planifiée efface l'échéance pour la prendre, puis cherche le candidat
// suivant. La cascade en échec, elle rembourse ; le remboursement en échec, elle
// remettait la prestation en attente SANS échéance — et plus aucun passage ne la
// relisait : payée, sans personne, jamais remboursée (relecture du 15/11/2026).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
const demain = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const Z = {
  id: M, client_id: CLIENT, prestataire_id: "44444444-4444-4444-8444-444444444444", metier: "Femme/Valet de chambre", titre: "Chambres",
  stripe_payment_intent: "pi_1", montant_total: 110.98, sector: "hotellerie", date: demain, heure_debut: "09:00", hours: 8, tarif_horaire: 13,
  ville: "Paris", adresse: "x", tiers_declaration: { lieu: "client", beneficiaire: "Hôtel" },
};
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";
process.env.CRON_SECRET = "secret";

function simuler({ rembourseOk }) {
  const ecrits = [], notifs = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET", corps = o.body ? String(o.body) : "";
    if (u.includes("/rest/v1/notifications") && m === "POST") { notifs.push(corps); return json([]); }
    if (u.includes("/missions?status=eq.pending_acceptance&acceptance_deadline=lt.") && m === "GET") return json([Z]);
    if (u.includes(`/missions?id=eq.${M}`) && m === "PATCH") {
      ecrits.push({ u, corps: JSON.parse(corps) });
      // La cascade échoue : ni candidat suivant ni diffusion ne s'écrivent.
      if (corps.includes('"status":"open"') || (corps.includes('"status":"pending_acceptance"') && corps.includes("prestataire_id"))) return json({ message: "refus" }, 500);
      return json([{ ...Z }]);
    }
    if (u.includes("api.stripe.com/v1/refunds")) return rembourseOk ? json({ id: "re_1", status: "succeeded" }) : json({ error: { message: "non" } }, 500);
    if (u.includes("api.stripe.com/v1/payment_intents/pi_1")) return json({ id: "pi_1", status: "succeeded", amount: 11098, amount_received: 11098, latest_charge: "ch_1", metadata: {} });
    return json([]);
  }));
  return { ecrits, notifs };
}
const reponse = () => { const r = { statut: 0 }; r.status = (s) => { r.statut = s; return r; }; r.json = () => r; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const passage = async () => {
  const { default: handler } = await import("../../../api/cron-reset-monthly.js");
  const r = reponse();
  await handler({ method: "GET", headers: { authorization: "Bearer secret" }, query: { action: "reminders" } }, r);
  return r;
};

describe("expiration d'une prestation affectée par la plateforme", () => {
  beforeEach(() => { vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"); for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("cascade et remboursement en échec : remise en attente AVEC une échéance passée, pour être relue", async () => {
    const { ecrits } = simuler({ rembourseOk: false });
    await passage();
    const remise = ecrits.find(e => e.u.includes("status=eq.refused") && e.corps.status === "pending_acceptance");
    expect(remise, JSON.stringify(ecrits.map(e => e.corps))).toBeTruthy();
    expect(Date.parse(remise.corps.acceptance_deadline)).toBeLessThanOrEqual(Date.now());
  });
  it("remboursée : le client n'est pas invité à « choisir un autre prestataire »", async () => {
    const { notifs } = simuler({ rembourseOk: true });
    await passage();
    const auClient = notifs.filter(n => n.includes(CLIENT)).join(" ");
    expect(auClient).toContain("intégralement remboursé");
    expect(auClient).not.toContain("choisir un autre prestataire");
  });

  // Relecture du 17/11/2026 : pendant la cascade de la tâche planifiée, le
  // prestataire refuse dans l'application — prestation « refusée », client
  // remboursé. La cascade la réaffectait ensuite (garde « refusée » admise).
  it("refusée et remboursée pendant la cascade : la cascade ne la réaffecte pas, la tâche ne rembourse pas une 2e fois", async () => {
    const ecrits = [];
    let remboursements = 0;
    vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
      const u = String(url), m = o.method || "GET", corps = o.body ? String(o.body) : "";
      if (u.includes("/missions?status=eq.pending_acceptance&acceptance_deadline=lt.") && m === "GET") return json([Z]);
      if (u.includes("/candidatures?")) return json([]);
      if (u.includes("/profiles?") && m === "GET") return json([{ id: "55555555-5555-4555-8555-555555555555", role: "prestataire", status: "approved", missions_enabled: true }]);
      if (u.includes(`/missions?id=eq.${M}`) && m === "PATCH") {
        ecrits.push(u);
        // La prise réussit ; ensuite la ligne est « refusée, sans prestataire » :
        // seule une écriture qui l'admet passerait.
        if (corps.includes('"acceptance_deadline":null') && !corps.includes("status")) return json([{ ...Z }]);
        return u.includes("status=eq.refused") ? json([{ ...Z, status: "refused" }]) : json([]);
      }
      if (u.includes("api.stripe.com/v1/refunds")) { remboursements++; return json({ id: "re_1" }); }
      return json([]);
    }));
    await passage();
    const cascade = ecrits.filter(u => u.includes("acceptance_deadline=is.null"));
    expect(ecrits.some(u => u.includes("status=in.("))).toBe(false);
    for (const u of cascade) expect(u).toContain("status=eq.pending_acceptance");
    expect(remboursements).toBe(0);
  });
});
