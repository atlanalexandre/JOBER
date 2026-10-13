// Relance « réservation non finalisée » : jamais pour une réservation payée
// (étude du 13/10/2026 — 83 relances de réservations payées sur la recette).
import { describe, it, expect } from "vitest";
import { relanceSansObjet } from "../../../api/cron-abandon.js";

const etat = new Map([
  ["payee", { id: "payee", status: "pending_acceptance", stripe_payment_intent: "pi_1" }],
  ["annulee", { id: "annulee", status: "cancelled", stripe_payment_intent: null }],
  ["en_cours", { id: "en_cours", status: "pending_acceptance", stripe_payment_intent: null }],
]);

describe("relanceSansObjet", () => {
  it("réservation payée : pas de relance", () => {
    expect(relanceSansObjet({ mission_id: "payee" }, etat)).toBe(true);
  });
  it("réservation annulée ou disparue : pas de relance", () => {
    expect(relanceSansObjet({ mission_id: "annulee" }, etat)).toBe(true);
    expect(relanceSansObjet({ mission_id: "inconnue" }, etat)).toBe(true);
  });
  it("réservation toujours à payer, ou brouillon sans prestation : relance", () => {
    expect(relanceSansObjet({ mission_id: "en_cours" }, etat)).toBe(false);
    expect(relanceSansObjet({ mission_id: null }, etat)).toBe(false);
  });
});
