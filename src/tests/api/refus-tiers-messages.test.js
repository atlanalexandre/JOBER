// Prestation affectée par la plateforme, refusée par le prestataire pressenti :
// la commande TIENT (candidat suivant, diffusion, ou reprise par la tâche
// planifiée). L'e-mail, le SMS et la notification du téléphone disaient
// pourtant « refusé — choisissez un autre prestataire » : le client en
// réservait un second (relecture du 12/11/2026).
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

process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ basculeOk, rembourse = true, mission = MISSION }) {
  const sortie = { courriels: [], sms: [], notifs: [], patchs: [] };
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET", corps = o.body ? String(o.body) : "";
    if (u.endsWith("/auth/v1/user")) return json({ id: PRESTA });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes(`/missions?id=eq.${M}&prestataire_id=eq.`) && m === "GET") return json([mission]);
    if (u.includes(`/missions?id=eq.${M}&select=status`) && m === "GET") return json([{ status: "refused" }]);
    if (u.includes("/missions?") && m === "PATCH") {
      sortie.patchs.push(JSON.parse(corps));
      if (corps.includes('"status":"open"')) return basculeOk ? json([{ id: M }]) : json({ message: "refus" }, 500);
      return json([{ ...MISSION, status: "refused", prestataire_id: null }]);
    }
    if (u.includes("api.stripe.com/v1/refunds")) return rembourse ? json({ id: "re_1" }) : json({ error: { message: "panne" } }, 500);
    if (u.includes("api.stripe.com/v1/payment_intents/pi_1")) return json({ id: "pi_1", status: "succeeded", amount: 11098, amount_received: 11098, latest_charge: "ch_1" });
    if (u.includes("/auth/v1/admin/users/")) return json({ email: "client@exemple.fr", phone: "0600000000", user_metadata: { prenom: "Léa", telephone: "0600000000" } });
    if (u.includes("api.resend.com")) { sortie.courriels.push(JSON.parse(corps)); return json({ id: "e1" }); }
    if (u.includes("api.brevo.com")) { sortie.sms.push(JSON.parse(corps).content); return json({}); }
    if (u.includes("/notifications")) { sortie.notifs.push(corps); return json([{}], 201); }
    return json([]);
  }));
  return sortie;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const refuser = async () => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { action: "respond_mission", mission_id: M, response: "refuse" } }, r);
  return r;
};

describe("refus d'une prestation affectée par la plateforme : ce que lit le client", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("BREVO_API_KEY", "brevo_test");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("rediffusée : ni l'e-mail ni le SMS ne l'invitent à choisir un autre prestataire", async () => {
    const s = simuler({ basculeOk: true });
    expect((await refuser()).statut).toBe(200);
    const courriel = s.courriels.find(c => JSON.stringify(c.to).includes("client@exemple.fr"));
    expect(courriel?.subject).toContain("Nous recherchons un autre prestataire");
    expect(courriel.html).not.toContain("choisir un autre prestataire");
    for (const t of s.sms) expect(t).not.toContain("choisir un autre prestataire");
  });

  it("cascade ET remboursement en échec : remise en attente, et le client lit qu'il n'a pas à réserver de nouveau", async () => {
    const s = simuler({ basculeOk: false, rembourse: false });
    expect((await refuser()).statut).toBe(200);
    expect(s.patchs.some(p => p.status === "pending_acceptance")).toBe(true);
    const courriel = s.courriels.find(c => JSON.stringify(c.to).includes("client@exemple.fr"));
    expect(courriel?.html).toContain("Inutile de réserver à nouveau");
    expect(s.notifs.join(" ")).toContain("Inutile de réserver à nouveau");
  });

  it("heure de début passée : personne ne sera cherché, la reprise n'est pas annoncée (13/11/2026)", async () => {
    const hier = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const s = simuler({ basculeOk: false, rembourse: false, mission: { ...MISSION, date: hier } });
    expect((await refuser()).statut).toBe(200);
    expect(s.notifs.join(" ")).not.toContain("Inutile de réserver à nouveau");
    // Ni « choisissez un autre prestataire » : il n'en avait choisi aucun. Son remboursement est annoncé.
    const tout = [s.notifs.join(" "), ...s.courriels.map(c => c.subject + c.html), ...s.sms].join(" ");
    expect(tout).not.toContain("choisir un autre prestataire");
    expect(s.notifs.join(" ")).toContain("votre paiement vous sera intégralement remboursé");
  });
});

