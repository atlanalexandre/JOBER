// Litige dénoué par un remboursement, quand une partie du prix a DÉJÀ été rendue
// au client (étude d'octobre 2026, `e2e/80`).
//
// Constaté en recette sur une prestation de 8 h à 13 €, 110,98 € payés (6,98 € de
// frais), une heure de retard :
//   - décalage refusé (13 € rendus), puis litige remboursé AVANT la validation :
//     110,98 € rendus en tout ET 6,02 € versés au prestataire — 20 € de perte ;
//   - décalage plafonné à la validation (13 € rendus), puis litige remboursé :
//     110,98 € rendus, frais de service compris.
// Attendu (CGPS art. 17.1) : 104 € rendus en tout, frais retenus, rien au prestataire.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executerResolution, soldeDuLitige, resteAuPrestataire, montantRemboursable } from "../../../api/_resolution.js";

const PRIX = 110.98;
const AVANT_VALIDATION = {
  id: "m-avant", stripe_payment_intent: "pi_avant", status: "disputed",
  montant_total: PRIX, tarif_horaire: 13, hours: 8, actual_hours: 7, delay_status: "rejected",
  payout_amount: null, cashback_applique: 0, cashback_debite: false,
};
// Validée : `complete` a ramené montant_total au dû (7 h + frais) et figé la part.
const APRES_VALIDATION = {
  id: "m-apres", stripe_payment_intent: "pi_apres", status: "disputed",
  montant_total: 97.98, tarif_horaire: 13, hours: 8, actual_hours: 7, delay_status: "pending",
  arrival_delay_minutes: 60, payout_amount: 91, payout_status: "pending",
  cashback_applique: 0, cashback_debite: false,
};

describe("ce qu'il reste à partager", () => {
  it("avant la validation : le prix payé, moins ce qui a déjà été rendu", () => {
    const s = soldeDuLitige(AVANT_VALIDATION, 1300);
    expect(s.net).toBeCloseTo(97.98, 2);
    expect(s.frais).toBeCloseTo(6.98, 2);
    expect(montantRemboursable(AVANT_VALIDATION, 1300).centimes).toBe(9100);
  });

  it("après la validation : le dû enregistré, frais reconnus par la part figée", () => {
    const s = soldeDuLitige(APRES_VALIDATION, 1300);
    expect(s.net).toBeCloseTo(97.98, 2);
    expect(s.frais).toBeCloseTo(6.98, 2);
    expect(s.partMax).toBe(91);
    expect(montantRemboursable(APRES_VALIDATION, 1300).centimes).toBe(9100);
  });

  it("rien ne revient au prestataire quand tout le reste du prix est rendu", () => {
    const s = soldeDuLitige(AVANT_VALIDATION, 1300);
    expect(resteAuPrestataire({ ...s, rendu: 91 }).aVerser).toBe(false);
  });

  it("un remboursement partiel laisse au prestataire le reste, frais retenus", () => {
    const s = soldeDuLitige(AVANT_VALIDATION, 1300);
    const r = resteAuPrestataire({ ...s, rendu: 30 });
    expect(r.reste).toBeCloseTo(61, 2);
    // Le compte tombe juste : déjà rendu + rendu + frais + versé = payé.
    expect(13 + 30 + 6.98 + r.reste).toBeCloseTo(PRIX, 2);
  });

  it("sans remboursement antérieur, rien ne change", () => {
    const m = { ...AVANT_VALIDATION, actual_hours: 8, delay_status: null };
    expect(montantRemboursable(m, 0).centimes).toBe(10400);
  });
});

describe("l'exécution demande à Stripe ce qui reste dû, pas le prix entier", () => {
  let remboursements, ecritures;
  const SB = "https://exemple.supabase.co";

  function simuler(mission, dejaRendu) {
    remboursements = []; ecritures = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("select=*")) return { ok: true, json: async () => [mission] };
      if (u.includes("/v1/payment_intents/")) {
        return { ok: true, json: async () => ({ id: mission.stripe_payment_intent,
          latest_charge: { amount_captured: Math.round(PRIX * 100), amount_refunded: dejaRendu } }) };
      }
      if (u.includes("/v1/refunds")) {
        const montant = Number(new URLSearchParams(opts.body).get("amount"));
        remboursements.push(montant);
        return { ok: true, json: async () => ({ id: "re_1", amount: montant }) };
      }
      if (opts.method === "PATCH" && u.includes("/missions?id=eq.")) ecritures.push(JSON.parse(opts.body));
      return { ok: true, json: async () => [{}], text: async () => "" };
    }));
  }
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  for (const [nom, mission] of [["avant la validation", AVANT_VALIDATION], ["après la validation", APRES_VALIDATION]]) {
    it(`${nom} : 91 € rendus en plus des 13 €, frais retenus, rien au prestataire`, async () => {
      simuler(mission, 1300);
      const out = await executerResolution({ mission: { id: mission.id }, resolution: "rembourser_client",
        supabaseUrl: SB, headers: {}, stripeKey: "sk_test", cause: "justice" });
      expect(out.ok).toBe(true);
      expect(remboursements).toEqual([9100]);
      const cloture = ecritures.find(e => e.status);
      expect(cloture.status).toBe("closed");
      expect(cloture.payout_status).toBe("annule");
    });
  }

  it("Stripe illisible : rien n'est exécuté", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("select=*")) return { ok: true, json: async () => [AVANT_VALIDATION] };
      if (String(url).includes("/v1/payment_intents/")) return { ok: false, status: 500, json: async () => ({}) };
      throw new Error(`appel inattendu : ${url}`);
    }));
    const out = await executerResolution({ mission: { id: "m-avant" }, resolution: "rembourser_client",
      supabaseUrl: SB, headers: {}, stripeKey: "sk_test", cause: "justice" });
    expect(out.ok).toBe(false);
  });
});
