// Deux paiements réussis pour une même réservation (étude du 13/10/2026, e2e/74).
//
// `stripe-intent` ne refusait un second paiement que si le premier était déjà
// RATTACHÉ à la prestation. Affectation perdue, le client revenait payer et était
// débité deux fois ; et l'affectation du second paiement était refusée sans rien
// rendre. Ce qui est éprouvé ici : le paiement abouti est retrouvé, un second
// paiement réel est reconnu comme doublon (et seulement lui), et l'écriture de
// l'affectation est conditionnée au paiement.
import { describe, it, expect, vi, afterEach } from "vitest";
import { paiementAboutiParmi, verifierPaiementReservation, messageDoublon } from "../../../api/_paiement.js";
import { filtrePaiementLibre } from "../../../api/missions.js";

const MISSION = "11111111-1111-4111-8111-111111111111";
const CLIENT  = "22222222-2222-4222-8222-222222222222";
const prestation = { montant_total: 110.98, tarif_horaire: 13, hours: 8 };
const pi = (id, surcharge = {}) => ({
  object: "payment_intent", id, status: "succeeded", currency: "eur", amount: 11098, amount_received: 11098,
  metadata: { mission: MISSION, client: CLIENT }, latest_charge: { refunded: false, amount_refunded: 0 }, ...surcharge,
});
const cible = { missionId: MISSION, clientId: CLIENT };

describe("paiementAboutiParmi", () => {
  it("retrouve le paiement abouti de cette réservation", () => {
    expect(paiementAboutiParmi([pi("pi_autre", { metadata: { mission: "x", client: CLIENT } }), pi("pi_bon")], cible)).toBe("pi_bon");
  });
  it("ignore un paiement inabouti, remboursé, d'un autre client ou d'un complément d'heures", () => {
    const liste = [
      pi("pi_1", { status: "requires_payment_method" }),
      pi("pi_2", { latest_charge: { refunded: true, amount_refunded: 11098 } }),
      pi("pi_3", { metadata: { mission: MISSION, client: "autre" } }),
      pi("pi_4", { metadata: { mission: MISSION, client: CLIENT, type: "heures_supp" } }),
    ];
    expect(paiementAboutiParmi(liste, cible)).toBeNull();
  });
  it("compte un paiement en cours de traitement : il engage déjà l'argent", () => {
    expect(paiementAboutiParmi([pi("pi_p", { status: "processing" })], cible)).toBe("pi_p");
  });
});

describe("verifierPaiementReservation — second paiement d'une prestation déjà réglée", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const appel = (intentId, paiementStripe) => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).startsWith("https://api.stripe.com")
      ? new Response(JSON.stringify(paiementStripe), { status: 200 })
      : new Response(JSON.stringify([{ ...prestation, stripe_payment_intent: "pi_PremierPaiement01", cashback_applique: 0 }]), { status: 200 })));
    return verifierPaiementReservation({ intentId, missionId: MISSION, clientId: CLIENT, supabaseUrl: "https://x.test", headers: {}, contexte: "test" });
  };

  it("un paiement réel du même client est un doublon, à rembourser", async () => {
    const r = await appel("pi_SecondPaiement02", pi("pi_SecondPaiement02"));
    expect(r.ok).toBe(false);
    expect(r.doublon).toBe(true);
    expect(r.intentId).toBe("pi_SecondPaiement02");
  });
  it("un paiement d'une autre prestation n'est jamais remboursé à ce titre", async () => {
    const r = await appel("pi_SecondPaiement02", pi("pi_SecondPaiement02", { metadata: { mission: "autre", client: CLIENT } }));
    expect(r.ok).toBe(false);
    expect(r.doublon).toBeFalsy();
    expect(r.raison).toBe("autre_paiement_deja_rattache");
  });
  it("le message ne promet un remboursement que s'il a eu lieu", () => {
    expect(messageDoublon(true)).toMatch(/intégralement remboursé/);
    expect(messageDoublon(false)).toMatch(/n'a pas pu être remboursé/);
  });
});

describe("filtrePaiementLibre", () => {
  it("n'autorise l'écriture que sur une prestation sans paiement, ou avec ce paiement", () => {
    expect(filtrePaiementLibre("pi_Abc123")).toBe("&or=(stripe_payment_intent.is.null,stripe_payment_intent.eq.pi_Abc123)");
  });
});
