// Vérification d'un paiement de réservation avant affectation.
//
// Constaté le 24/09/2026 par le scénario de recette e2e/07 : une prestation
// était proposée au prestataire sans paiement, avec un identifiant inventé, et
// avec un délai de réponse fixé par le navigateur. Ce qui est éprouvé ici, ce
// sont les refus — un contrôle qui laisse passer un seul de ces cas ne protège
// rien.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  controlerPaiement,
  bornesMontant,
  delaiReponseMinutes,
  verifierPaiementReservation,
  DELAI_REPONSE_MIN,
} from "../../../api/_paiement.js";
import { FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

const MISSION = "11111111-1111-4111-8111-111111111111";
const CLIENT  = "22222222-2222-4222-8222-222222222222";
// 13 €/h × 8 h = 104 € ; frais « single » : 4,90 + 2 % = 6,98 € → 110,98 €
const prestation = { montant_total: 110.98, tarif_horaire: 13, hours: 8 };

const pi = (surcharge = {}) => ({
  object: "payment_intent",
  id: "pi_3AbCdEfGhIjKlMn",
  status: "succeeded",
  currency: "eur",
  amount: 11098,
  amount_received: 11098,
  metadata: { mission: MISSION, client: CLIENT },
  latest_charge: { refunded: false, amount_refunded: 0 },
  ...surcharge,
});
const attendu = { missionId: MISSION, clientId: CLIENT, mission: prestation };

describe("controlerPaiement", () => {
  it("accepte un paiement abouti de ce client pour cette prestation", () => {
    expect(controlerPaiement(pi(), attendu)).toEqual({ ok: true });
  });

  it("refuse un paiement d'une autre prestation", () => {
    const r = controlerPaiement(pi({ metadata: { mission: "33333333-3333-4333-8333-333333333333", client: CLIENT } }), attendu);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(403);
  });

  it("refuse le paiement d'un autre client", () => {
    const r = controlerPaiement(pi({ metadata: { mission: MISSION, client: "44444444-4444-4444-8444-444444444444" } }), attendu);
    expect(r.ok).toBe(false);
  });

  it("refuse un complément d'heures ou une recharge, même rattachés à la prestation", () => {
    for (const type of ["heures_supp", "wallet_topup"]) {
      const r = controlerPaiement(pi({ metadata: { mission: MISSION, client: CLIENT, type } }), attendu);
      expect(r.ok).toBe(false);
    }
  });

  it("refuse un paiement qui n'a pas abouti", () => {
    for (const status of ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "canceled"]) {
      const r = controlerPaiement(pi({ status }), attendu);
      expect(r.ok, status).toBe(false);
      expect(r.code).toBe(402);
    }
  });

  it("refuse un paiement déjà remboursé, même partiellement", () => {
    expect(controlerPaiement(pi({ latest_charge: { refunded: true, amount_refunded: 11098 } }), attendu).ok).toBe(false);
    expect(controlerPaiement(pi({ latest_charge: { refunded: false, amount_refunded: 100 } }), attendu).ok).toBe(false);
  });

  it("refuse un montant qui ne correspond pas à la prestation", () => {
    const r = controlerPaiement(pi({ amount: 100, amount_received: 100 }), attendu);
    expect(r.ok).toBe(false);
    expect(r.raison).toMatch(/^montant_/);
  });

  it("accepte le prix réduit du cashback, et le prix plein si la réduction n'a pas été inscrite", () => {
    const avecCb = { ...attendu, mission: { ...prestation, cashback_applique: 5 } };
    expect(controlerPaiement(pi({ amount: 10598, amount_received: 10598 }), avecCb).ok).toBe(true);
    expect(controlerPaiement(pi(), avecCb).ok).toBe(true);
    expect(controlerPaiement(pi({ amount: 10000, amount_received: 10000 }), avecCb).ok).toBe(false);
  });

  it("refuse une réponse qui n'est pas un paiement", () => {
    expect(controlerPaiement(null, attendu).ok).toBe(false);
    expect(controlerPaiement({ error: { message: "No such payment_intent" } }, attendu).ok).toBe(false);
  });
});

describe("bornesMontant", () => {
  it("retombe sur tarif × heures sans montant total, comme stripe-intent", () => {
    expect(bornesMontant({ tarif_horaire: 13, hours: 8 })).toEqual({ min: 10400, max: 10400 });
  });
});

describe("delaiReponseMinutes — fixé par le serveur", () => {
  const maintenant = Date.parse("2026-09-24T10:00:00Z"); // 12 h à Paris

  it("20 minutes en urgence, reconnue aux frais encaissés", () => {
    // 104 € + 9,90 + 2 % = 115,98 €
    const m = { ...prestation, montant_total: 115.98, date: "2026-09-24" };
    expect(delaiReponseMinutes(m, FRAIS_PAR_DEFAUT, maintenant)).toBe(DELAI_REPONSE_MIN.urgent);
  });

  it("une heure pour une prestation du jour même", () => {
    expect(delaiReponseMinutes({ ...prestation, date: "2026-09-24" }, FRAIS_PAR_DEFAUT, maintenant)).toBe(60);
  });

  it("quatre heures sinon", () => {
    expect(delaiReponseMinutes({ ...prestation, date: "2026-10-02" }, FRAIS_PAR_DEFAUT, maintenant)).toBe(240);
  });

  it("le jour s'entend à l'heure française, pas en UTC", () => {
    // 23 h 30 UTC le 24 = 1 h 30 le 25 à Paris
    const nuit = Date.parse("2026-09-24T23:30:00Z");
    expect(delaiReponseMinutes({ ...prestation, date: "2026-09-25" }, FRAIS_PAR_DEFAUT, nuit)).toBe(60);
  });
});

describe("verifierPaiementReservation — avant tout appel", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const appel = (intentId) => verifierPaiementReservation({
    intentId, missionId: MISSION, clientId: CLIENT, supabaseUrl: "https://x.supabase.co", headers: {}, contexte: "test",
  });

  it("refuse l'absence de paiement, un identifiant wallet_ ou mal formé, sans rien interroger", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await appel(undefined)).ok).toBe(false);
    expect((await appel("wallet_1234")).raison).toBe("wallet");
    expect((await appel("pi_invente'; drop")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuse un identifiant inconnu de Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("https://api.stripe.com")) return new Response(JSON.stringify({ error: { message: "No such payment_intent" } }), { status: 404 });
      return new Response(JSON.stringify([{ ...prestation, stripe_payment_intent: null }]), { status: 200 });
    }));
    const r = await appel("pi_3Invente0000000000");
    expect(r.ok).toBe(false);
    expect(r.raison).toBe("inconnu_de_stripe");
  });

  it("accepte un paiement réel et rend la prestation relue", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("https://api.stripe.com")) return new Response(JSON.stringify(pi()), { status: 200 });
      return new Response(JSON.stringify([{ ...prestation, stripe_payment_intent: null, cashback_applique: 0 }]), { status: 200 });
    }));
    const r = await appel("pi_3AbCdEfGhIjKlMn");
    expect(r.ok).toBe(true);
    expect(r.intentId).toBe("pi_3AbCdEfGhIjKlMn");
    expect(r.mission.montant_total).toBe(110.98);
  });
});
