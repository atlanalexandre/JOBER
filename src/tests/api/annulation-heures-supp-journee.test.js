// Annulation d'une prestation d'UNE journée dont le client avait payé une
// prolongation à part (relecture du 11/11/2026). Ces heures n'entrent pas dans
// `heures_ajoutees_detail` : aucune annulation ne les rendait, et l'annulation
// par le client demandait à la réservation plus qu'elle n'avait encaissé.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
// Réservation 8 h × 13 € (110,98 € encaissés), puis +1 h payée 15,40 € à part.
const MISSION = {
  id: M, client_id: CLIENT, prestataire_id: PRESTA, status: "assigned", sector: "hotellerie", metier: "Femme/Valet de chambre",
  date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), heure_debut: "09:00", hours: 9, tarif_horaire: 13,
  montant_total: 126.38, stripe_payment_intent: "pi_main", extra_hours_appliquees: 1, extra_hours_tarif: 13,
  extra_hours_payment_intent: "pi_sup", heures_ajoutees_total: 0, heures_ajoutees_detail: [], ville: "Paris", adresse: "x",
};
const PI = {
  pi_main: { id: "pi_main", status: "succeeded", amount: 11098, amount_received: 11098, latest_charge: { amount_refunded: 0 }, metadata: {} },
  pi_sup: { id: "pi_sup", status: "succeeded", amount: 1540, amount_received: 1540, latest_charge: { amount_refunded: 0 },
    metadata: { type: "heures_supp", mission: M, heures: "1", deja_appliquees: "0" } },
};

process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ appelant, recherche = [PI.pi_sup], mission = MISSION, mainKo = false, supKo = false } = {}) {
  const remb = [];
  remb.soldes = [];
  remb.tickets = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: appelant });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "approved" }]);
    if (u.includes(`/missions?id=eq.${M}`) && m === "GET" && u.includes("select=cashback_applique")) return json([{ cashback_applique: 0 }]);
    if (u.includes(`/missions?id=eq.${M}`) && m === "GET") return json([mission]);
    if (u.includes("/missions?") && m === "PATCH") return json([{ ...mission, status: "cancelled" }]);
    if (u.includes("/profiles?id=eq.") && u.includes("select=prepaid_balance")) return json([{ prepaid_balance: 0 }]);
    if (u.includes("/support_tickets") && m === "POST") { remb.tickets.push(JSON.parse(String(o.body))); return json([], 201); }
    if (u.includes("/support_tickets?subject=")) return json(remb.ticketOuvert ? [{ id: "t1" }] : []);
    if (u.includes("/profiles?id=eq.") && m === "PATCH") { remb.soldes.push(JSON.parse(String(o.body)).prepaid_balance); return json([{ id: CLIENT }]); }
    if (u.includes("/payment_intents/search")) return json({ data: recherche });
    if (u.includes("/v1/refunds?payment_intent=")) return json({ data: [] });
    if (u.includes("api.stripe.com/v1/refunds") && m === "POST") {
      const p = new URLSearchParams(String(o.body));
      if (mainKo && p.get("payment_intent") === "pi_main") return json({ error: { message: "panne" } }, 500);
      if (supKo && p.get("payment_intent") === "pi_sup") return json({ error: { message: "panne" } }, 500);
      remb.push({ pi: p.get("payment_intent"), montant: p.get("amount") ? Number(p.get("amount")) : null });
      return json({ id: `re_${remb.length}`, status: "succeeded" });
    }
    for (const id of Object.keys(PI)) if (u.includes(`/v1/payment_intents/${id}`)) return json(PI[id]);
    if (u.includes("/auth/v1/admin/users/")) return json({ email: "", user_metadata: {} });
    return json([]);
  }));
  return remb;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const appeler = async (body) => {
  const { default: handler } = await import("../../../api/missions.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body }, r);
  return r;
};

describe("prolongation payée à part, prestation d'une journée", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("le client annule : la prolongation est rendue (part du prestataire), la réservation sans dépasser ce qu'elle a encaissé", async () => {
    const remb = simuler({ appelant: CLIENT });
    const r = await appeler({ action: "cancel_client", mission_id: M });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const sup = remb.find(x => x.pi === "pi_sup"), main = remb.find(x => x.pi === "pi_main");
    expect(sup?.montant).toBe(1300);             // 1 h × 13 €, frais de la prolongation retenus
    expect(main?.montant).toBeGreaterThan(0);
    expect(main.montant).toBeLessThanOrEqual(11098);
    expect(main.montant).toBe(10400);            // 8 h × 13 €, frais de la réservation retenus
  });

  it("la recherche Stripe en retard : le dernier paiement connu est relu à part", async () => {
    const remb = simuler({ appelant: CLIENT, recherche: [] });
    const r = await appeler({ action: "cancel_client", mission_id: M });
    expect(r.statut).toBe(200);
    expect(remb.find(x => x.pi === "pi_sup")?.montant).toBe(1300);
  });

  it("le prestataire se désiste : la prolongation est rendue en entier, avec la réservation", async () => {
    const remb = simuler({ appelant: PRESTA });
    const r = await appeler({ action: "presta_cancel", mission_id: M });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(remb.find(x => x.pi === "pi_sup")?.montant).toBe(1540);
    expect(remb.some(x => x.pi === "pi_main")).toBe(true);
  });

  it("sans clé Stripe, le client ne peut pas annuler une prestation payée par carte : rien ne serait rendu", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    simuler({ appelant: CLIENT });
    const r = await appeler({ action: "cancel_client", mission_id: M });
    expect(r.statut).toBe(503);
  });

  it("désistement : la réservation refusée par Stripe, rien n'est rendu des heures ajoutées — la prestation reste entière (12/11/2026)", async () => {
    const remb = simuler({ appelant: PRESTA, mainKo: true });
    const r = await appeler({ action: "presta_cancel", mission_id: M });
    expect(r.statut).toBe(500);
    expect(remb.some(x => x.pi === "pi_sup")).toBe(false);
  });

  it("désistement d'une réservation réglée par le portefeuille : les heures ajoutées ne sont pas rendues deux fois (12/11/2026)", async () => {
    const remb = simuler({ appelant: PRESTA, mission: { ...MISSION, stripe_payment_intent: "wallet_abc" } });
    const r = await appeler({ action: "presta_cancel", mission_id: M });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(remb.find(x => x.pi === "pi_sup")?.montant).toBe(1540);
    expect(remb.soldes).toEqual([110.98]);       // 126,38 € − 15,40 € rendus sur la carte
  });
});

describe("désistement : suivi des heures ajoutées (13/11/2026)", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("leur remboursement échoue : la prestation est annulée, et un ticket interne le signale à l'équipe", async () => {
    const remb = simuler({ appelant: PRESTA, supKo: true });
    const r = await appeler({ action: "presta_cancel", mission_id: M });
    expect(r.statut).toBe(200);
    expect(remb.tickets).toHaveLength(1);
    expect(remb.tickets[0].subject).toMatch(/^\[Interne\] Heures ajoutées à rembourser/);
    expect(remb.tickets[0].message).toContain("pi_sup");
    expect(remb.tickets[0].message).toContain("Vérifier d'abord dans Stripe");
  });

  it("un ticket déjà ouvert pour cette prestation : pas de second (13/11/2026, après-midi)", async () => {
    const remb = simuler({ appelant: PRESTA, supKo: true });
    remb.ticketOuvert = true;
    await appeler({ action: "presta_cancel", mission_id: M });
    expect(remb.tickets).toHaveLength(0);
  });

  it("portefeuille : un paiement du détail que la recherche n'a pas encore vu n'est pas rendu deux fois", async () => {
    const mission = { ...MISSION, stripe_payment_intent: "wallet_abc", extra_hours_appliquees: 0, extra_hours_payment_intent: null,
      heures_ajoutees_detail: [{ jour: MISSION.date, heures: 1, tarif: 13, paiement: "pi_sup" }], heures_ajoutees_total: 1 };
    const remb = simuler({ appelant: PRESTA, mission, recherche: [] });
    const r = await appeler({ action: "presta_cancel", mission_id: M });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(remb.find(x => x.pi === "pi_sup")?.montant).toBe(1540);
    expect(remb.soldes).toEqual([110.98]);
  });
});

describe("paiementsHeuresSupp", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("un paiement sans repère (antérieur au 01/10/2026) compte comme appliqué (12/11/2026)", async () => {
    const { paiementsHeuresSupp } = await import("../../../api/_remboursement_bo.js");
    vi.stubGlobal("fetch", vi.fn(() => json({ data: [{ ...PI.pi_sup, metadata: { type: "heures_supp", mission: M, heures: "1" } }] })));
    const [p] = await paiementsHeuresSupp(M, "sk", { compteur: 1 });
    expect(p.applique).toBe(true);
  });
});
