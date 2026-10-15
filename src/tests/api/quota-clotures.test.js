// Une prestation close autrement que par la validation compte aussi au quota du mois
// (relecture du 15/10/2026, `e2e/96`).
//
// Seules la validation par le client et la validation automatique comptaient. Le
// dénouement d'un litige qui paie le prestataire et l'arrêt complet d'une prestation en
// cours la faisaient quitter les « en cours » sans l'ajouter au compteur ; la validation
// forcée par le back-office tenait sa propre version (une journée, jamais « épuisé »).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { executerResolution } from "../../../api/_resolution.js";

const SB = "https://exemple.supabase.co";

function simuler(mission) {
  const quota = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/missions") && u.includes("select=*")) return { ok: true, json: async () => [mission] };
    if (u.includes("/rest/v1/profiles") && u.includes("select=missions_completed_month")) {
      return { ok: true, json: async () => [{ missions_completed_month: 4, trial_exhausted: false, plan_abonnement: "premium" }] };
    }
    if (u.includes("/v1/payment_intents/")) {
      return { ok: true, json: async () => ({ id: mission.stripe_payment_intent,
        latest_charge: { amount_captured: Math.round(Number(mission.montant_total) * 100), amount_refunded: 0 } }) };
    }
    if (u.includes("/v1/refunds") && opts.method === "POST") {
      const montant = Number(new URLSearchParams(opts.body).get("amount"));
      return { ok: true, json: async () => ({ id: "re_1", amount: montant }) };
    }
    if (opts.method === "PATCH" && u.includes("/rest/v1/profiles?id=eq.")) quota.push(JSON.parse(opts.body));
    return { ok: true, json: async () => [{}], text: async () => "" };
  }));
  return quota;
}

// La clé de Stripe décide si le reste remboursable est lu : fixée ici, le test ne
// dépend pas de l'environnement qui le lance.
let cleAvant;
beforeEach(() => {
  cleAvant = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (cleAvant === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = cleAvant;
});

// Trois jours de 8 h à 13 €, contestée avant la validation : jamais clôturée.
const CONTESTEE_AVANT = {
  id: "m-q", prestataire_id: "p-q", client_id: "c-q", stripe_payment_intent: "pi_q", status: "disputed",
  montant_total: 332.94, tarif_horaire: 13, hours: 8, actual_hours: 8,
  date_debut: "2026-10-12", date_fin: "2026-10-14",
  payout_amount: null, payout_due_at: null, cashback_applique: 0, cashback_debite: false,
};

describe("litige dénoué en faveur du prestataire", () => {
  it("contestée avant la validation : ses journées comptent au quota", async () => {
    const quota = simuler(CONTESTEE_AVANT);
    const out = await executerResolution({ mission: { id: "m-q" }, resolution: "verser_prestataire", supabaseUrl: SB, headers: {}, cause: "justice" });
    expect(out.ok, out.detail).toBe(true);
    expect(quota).toEqual([{ missions_completed_month: 7 }]);
  });

  it("contestée après la validation : déjà comptée, pas une seconde fois", async () => {
    const quota = simuler({ ...CONTESTEE_AVANT, payout_amount: 312, payout_due_at: "2026-10-16T00:00:00Z" });
    const out = await executerResolution({ mission: { id: "m-q" }, resolution: "verser_prestataire", supabaseUrl: SB, headers: {}, cause: "justice" });
    expect(out.ok, out.detail).toBe(true);
    expect(quota).toEqual([]);
  });
});

describe("litige dénoué par un remboursement", () => {
  it("partiel, une part revient au prestataire : la prestation compte", async () => {
    const quota = simuler({ ...CONTESTEE_AVANT, resolution_montant: 30 });
    const out = await executerResolution({ mission: { id: "m-q" }, resolution: "rembourser_client", supabaseUrl: SB, headers: {}, stripeKey: "sk_test", cause: "justice" });
    expect(out.ok, out.detail).toBe(true);
    expect(out.statut).toBe("completed");
    expect(quota).toEqual([{ missions_completed_month: 7 }]);
  });

  it("intégral : rien au prestataire, la prestation ne compte pas", async () => {
    const quota = simuler(CONTESTEE_AVANT);
    const out = await executerResolution({ mission: { id: "m-q" }, resolution: "rembourser_client", supabaseUrl: SB, headers: {}, stripeKey: "sk_test", cause: "justice" });
    expect(out.ok, out.detail).toBe(true);
    expect(out.statut).toBe("closed");
    expect(quota).toEqual([]);
  });
});

describe("validation forcée et arrêt complet", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  it("la validation forcée compte par la fonction commune, chaque journée", () => {
    const bloc = bo.slice(bo.indexOf('if (action === "force_complete_mission")'), bo.indexOf('if (action === "manual_refund")'));
    expect(bloc).toMatch(/compterAuQuota\(m\.prestataire_id, jours, SUPABASE_URL, headers, "bo\/force_complete"\)/);
    expect(bloc).not.toMatch(/currentMC \+ 1/);
  });
  it("l'arrêt complet d'une prestation en cours compte les journées faites", () => {
    const bloc = missions.slice(missions.indexOf('if (action === "cancel_in_progress")'));
    expect(bloc).toMatch(/compterAuQuota\(mission\.prestataire_id, Math\.max\(1, joursPrestation - joursRestants\)/);
  });
});
