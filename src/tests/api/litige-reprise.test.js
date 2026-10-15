// Litige dénoué par un remboursement, REPRIS après une panne (relecture du 15/10/2026).
//
// Le remboursement part chez Stripe, puis l'écriture en base échoue : la prestation
// reste en litige, et le traitement automatique — ou le back-office — recommence. Le
// second passage relisait chez Stripe ce qui avait « déjà été rendu »… y compris le
// remboursement qu'il venait lui-même de faire. Deux effets, sur la prestation de 8 h à
// 13 € des autres tests (110,98 € payés, 6,98 € de frais) :
//   - remboursement au montant ordinaire (104 €) : le second passage ne trouvait plus
//     rien à rendre et demandait « la totalité » sous la même clé d'idempotence. Stripe
//     refuse une clé réutilisée avec d'autres paramètres : le litige ne se fermait plus.
//     Passé les 24 h où Stripe garde la clé, il rendait les frais de service en plus ;
//   - remboursement partiel (30 €) : Stripe rejouait le même remboursement, mais les
//     30 € étaient déduits deux fois de ce qui revenait au prestataire — 44 € au lieu
//     de 74 €.
// Attendu : un passage repris retrouve le remboursement de CE litige, n'en fait pas
// un second, et répartit le reste comme le premier passage l'aurait fait.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executerResolution } from "../../../api/_resolution.js";

const SB = "https://exemple.supabase.co";
const PI = "pi_reprise";

/**
 * Stripe et la base, simulés avec l'état qui compte ici.
 * Stripe : le paiement, ses remboursements, et la règle de la clé d'idempotence —
 * même clé et mêmes paramètres : la même réponse ; même clé, autres paramètres : refus.
 * `cleOubliee` : la clé a plus de 24 h, Stripe ne s'en souvient plus.
 * La base : la première écriture de clôture échoue (`pannes` fois).
 */
function simuler(mission, { pannes = 1, autres = [] } = {}) {
  const etat = { refunds: [...autres], cles: new Map(), crees: 0, ecritures: [], pannes, cleOubliee: false };
  const rendu = () => etat.refunds.filter(r => !["failed", "canceled"].includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const methode = opts.method || "GET";
    if (u.includes("/rest/v1/missions") && u.includes("select=*")) return { ok: true, json: async () => [mission] };
    if (u.includes(`/v1/payment_intents/${PI}`)) {
      return { ok: true, json: async () => ({ id: PI, amount_received: 11098,
        latest_charge: { amount: 11098, amount_captured: 11098, amount_refunded: rendu() } }) };
    }
    if (u.includes("/v1/refunds") && methode === "GET") {
      expect(u).toContain(`payment_intent=${PI}`);
      return { ok: true, json: async () => ({ data: [...etat.refunds].reverse(), has_more: false }) };
    }
    if (u.includes("/v1/refunds") && methode === "POST") {
      const cle = opts.headers?.["Idempotency-Key"];
      const corps = String(opts.body || "");
      if (cle && etat.cles.has(cle) && !etat.cleOubliee) {
        const premier = etat.cles.get(cle);
        if (premier.corps !== corps) {
          return { ok: false, status: 400, json: async () => ({ error: { type: "idempotency_error",
            message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } }) };
        }
        return { ok: true, json: async () => premier.refund };
      }
      const p = new URLSearchParams(corps);
      const reste = 11098 - rendu();
      const montant = p.get("amount") ? Number(p.get("amount")) : reste;
      if (!(montant > 0) || montant > reste) {
        return { ok: false, status: 400, json: async () => ({ error: { code: "amount_too_large", message: "Refund amount is greater than unrefunded amount" } }) };
      }
      const metadata = {};
      for (const [k, v] of p) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v; }
      const refund = { id: `re_${++etat.crees}`, amount: montant, status: "succeeded", metadata };
      etat.refunds.push(refund);
      if (cle) etat.cles.set(cle, { corps, refund });
      return { ok: true, json: async () => refund };
    }
    if (methode === "PATCH" && u.includes(`/missions?id=eq.${mission.id}`) && !u.includes("cashback_debite")) {
      const corps = JSON.parse(opts.body);
      if (corps.status && etat.pannes > 0) {
        etat.pannes -= 1;
        return { ok: false, status: 503, text: async () => "base indisponible", json: async () => ({}) };
      }
      etat.ecritures.push(corps);
      return { ok: true, json: async () => [{}], text: async () => "" };
    }
    return { ok: true, json: async () => [{}], text: async () => "" };
  }));
  return { etat, rendu };
}

const executer = (mission) => executerResolution({ mission: { id: mission.id }, resolution: "rembourser_client",
  supabaseUrl: SB, headers: {}, stripeKey: "sk_test", cause: "accord_tacite" });

// Contestée avant la validation : la part n'est pas figée, `montant_total` est le prix payé.
const AVANT_VALIDATION = {
  id: "m-reprise", stripe_payment_intent: PI, status: "disputed",
  montant_total: 110.98, tarif_horaire: 13, hours: 8, actual_hours: 8,
  payout_amount: null, cashback_applique: 0, cashback_debite: false,
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.STRIPE_SECRET_KEY; });

describe("litige repris après une panne de la base", () => {
  it("remboursement ordinaire : le second passage clôt sans rembourser une seconde fois", async () => {
    const { etat, rendu } = simuler(AVANT_VALIDATION);
    const premier = await executer(AVANT_VALIDATION);
    expect(premier.ok, "la clôture a échoué : le passage doit le dire").toBe(false);
    expect(rendu(), "le prix de la prestation est parti").toBe(10400);

    const second = await executer(AVANT_VALIDATION);
    expect(second.ok, second.detail).toBe(true);
    expect(etat.crees, "un seul remboursement chez Stripe").toBe(1);
    expect(rendu(), "frais de service retenus").toBe(10400);
    expect(etat.ecritures.at(-1)).toMatchObject({ status: "closed", payout_status: "annule" });
  });

  it("plus de 24 h après : Stripe a oublié la clé, les frais ne sont pas rendus pour autant", async () => {
    const { etat, rendu } = simuler(AVANT_VALIDATION);
    await executer(AVANT_VALIDATION);
    etat.cleOubliee = true;
    const second = await executer(AVANT_VALIDATION);
    expect(second.ok, second.detail).toBe(true);
    expect(etat.crees).toBe(1);
    expect(rendu()).toBe(10400);
  });

  it("remboursement partiel : le prestataire reçoit le reste une seule fois déduit", async () => {
    const mission = { ...AVANT_VALIDATION, resolution_montant: 30 };
    const { etat, rendu } = simuler(mission);
    await executer(mission);
    const second = await executer(mission);
    expect(second.ok, second.detail).toBe(true);
    expect(etat.crees).toBe(1);
    expect(rendu()).toBe(3000);
    // 110,98 € payés − 30 € rendus − 6,98 € de frais = 74 € au prestataire.
    expect(etat.ecritures.at(-1)).toMatchObject({ status: "completed", payout_status: "pending", payout_amount: 74 });
  });

  it("un remboursement antérieur d'une autre nature reste déduit", async () => {
    // L'heure de retard d'un décalage refusé (13 €), rendue avant le litige.
    const mission = { ...AVANT_VALIDATION, actual_hours: 7, delay_status: "rejected" };
    const autre = { id: "re_decalage", amount: 1300, status: "succeeded", metadata: { motif: "heures_non_faites", mission: mission.id } };
    const { etat, rendu } = simuler(mission, { autres: [autre] });
    await executer(mission);
    const second = await executer(mission);
    expect(second.ok, second.detail).toBe(true);
    expect(etat.crees, "un seul remboursement pour le litige").toBe(1);
    expect(rendu(), "13 € puis 91 € : 104 € en tout, frais retenus").toBe(10400);
    expect(etat.ecritures.at(-1)).toMatchObject({ status: "closed", payout_status: "annule" });
  });

  it("le remboursement du litige porte son étiquette, que le passage suivant reconnaît", async () => {
    const { etat } = simuler(AVANT_VALIDATION, { pannes: 0 });
    const out = await executer(AVANT_VALIDATION);
    expect(out.ok, out.detail).toBe(true);
    expect(etat.refunds[0].metadata).toMatchObject({ alane_operation: "resolution-m-reprise", mission: "m-reprise" });
  });
});
