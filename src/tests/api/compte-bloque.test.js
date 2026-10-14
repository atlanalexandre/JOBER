// Compte suspendu ou refusé : plus de paiement, de carte ni d'abonnement par un
// appel direct (étude du 13/10/2026).
//
// L'application déconnecte un compte suspendu, mais son jeton se rafraîchit
// auprès de Supabase : `verifyUser` ne regardant que le jeton, un appel direct
// enregistrait encore une carte, créait un paiement de réservation ou souscrivait
// un abonnement. Ce qui reste légitime (retirer sa carte, résilier, régler des
// heures déjà faites) reste ouvert.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import stripeIntent from "../../../api/stripe-intent.js";
import stripeSubscription from "../../../api/stripe-subscription.js";
import bookingDraft from "../../../api/booking-draft.js";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const MISSION = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("VITE_SUPABASE_URL", "https://base.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function reponse() {
  const r = { code: 0, corps: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.corps = b; return r; };
  r.end = () => r;
  return r;
}

// Base et Stripe simulés. `appels` garde chaque adresse contactée.
function monde({ statut, profilLisible = true }) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    appels.push(u);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.endsWith("/auth/v1/user")) return json({ id: CLIENT });
    if (u.includes("/rest/v1/profiles") && u.includes("select=status")) {
      return profilLisible ? json([{ status: statut }]) : json({ message: "panne" }, 500);
    }
    if (u.includes("/rest/v1/profiles")) return json([{ stripe_customer_id: "cus_1" }]);
    if (u.includes("/rest/v1/missions")) return json([{ id: MISSION, client_id: CLIENT, status: "assigned", hours: 4, tarif_horaire: 13 }]);
    if (u.includes("api.stripe.com/v1/payment_methods/")) return json({ id: "pm_1", customer: "cus_1" });
    return json({});
  }));
  return appels;
}

const req = (body) => ({ method: "POST", headers: { authorization: "Bearer jeton" }, body });

describe("compte suspendu", () => {
  it("ne peut plus enregistrer de carte", async () => {
    const appels = monde({ statut: "suspended" });
    const res = reponse();
    await stripeIntent(req({ action: "setup_card" }), res);
    expect(res.code).toBe(403);
    expect(res.corps.code).toBe("compte_bloque");
    expect(appels.some(u => u.includes("api.stripe.com")), "Stripe n'est pas contacté").toBe(false);
  });

  it("ne peut plus créer le paiement d'une réservation", async () => {
    const appels = monde({ statut: "suspended" });
    const res = reponse();
    await stripeIntent(req({ mission_id: MISSION }), res);
    expect(res.code).toBe(403);
    expect(appels.some(u => u.includes("api.stripe.com"))).toBe(false);
  });

  it("ne peut plus souscrire un abonnement", async () => {
    const appels = monde({ statut: "suspended" });
    const res = reponse();
    await stripeSubscription(req({ plan: "premium" }), res);
    expect(res.code).toBe(403);
    expect(appels.some(u => u.includes("api.stripe.com"))).toBe(false);
  });

  it("ne remplit plus de panier (donc pas de relance)", async () => {
    const appels = monde({ statut: "rejected" });
    const res = reponse();
    await bookingDraft(req({ action: "save", mission_id: MISSION }), res);
    expect(res.code).toBe(403);
    expect(appels.some(u => u.includes("booking_drafts"))).toBe(false);
  });

  it("peut toujours retirer sa carte", async () => {
    monde({ statut: "suspended" });
    const res = reponse();
    await stripeIntent(req({ action: "detach_pm", pmId: "pm_1" }), res);
    expect(res.code).not.toBe(403);
  });

  it("peut toujours résilier son abonnement", async () => {
    monde({ statut: "suspended" });
    const res = reponse();
    await stripeSubscription(req({ plan: "free" }), res);
    expect(res.corps?.code).not.toBe("compte_bloque");
  });

  it("peut toujours régler des heures déjà travaillées", async () => {
    monde({ statut: "suspended" });
    const res = reponse();
    await stripeIntent(req({ mission_id: MISSION, mode: "supplement" }), res);
    expect(res.corps?.code).not.toBe("compte_bloque");
  });
});

describe("compte approuvé ou en attente", () => {
  it("enregistre une carte comme avant", async () => {
    const appels = monde({ statut: "approved" });
    await stripeIntent(req({ action: "setup_card" }), reponse());
    expect(appels.some(u => u.includes("api.stripe.com"))).toBe(true);
  });
});

describe("statut illisible", () => {
  it("refuse sans laisser passer (503)", async () => {
    const appels = monde({ statut: "approved", profilLisible: false });
    const res = reponse();
    await stripeIntent(req({ action: "setup_card" }), res);
    expect(res.code).toBe(503);
    expect(appels.some(u => u.includes("api.stripe.com"))).toBe(false);
  });
});
