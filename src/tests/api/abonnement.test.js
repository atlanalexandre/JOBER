// Échéance d'un abonnement prestataire : la date de fin se lit dans `profiles`.
import { describe, it, expect } from "vitest";
import { abonnementEchu } from "../../../api/_abonnement.js";

// 24/09/2026 à 12 h, heure de Paris.
const MIDI = Date.parse("2026-09-24T10:00:00Z");

describe("abonnementEchu", () => {
  it("un plan gratuit n'expire jamais", () => {
    expect(abonnementEchu({ plan_abonnement: "free", subscription_end_date: "2020-01-01" }, MIDI)).toBe(false);
    expect(abonnementEchu({}, MIDI)).toBe(false);
  });

  it("un plan payant sans date de fin n'expire pas", () => {
    expect(abonnementEchu({ plan_abonnement: "premium", subscription_end_date: null }, MIDI)).toBe(false);
  });

  it("l'abonnement vaut jusqu'à la fin de son dernier jour", () => {
    expect(abonnementEchu({ plan_abonnement: "premium", subscription_end_date: "2026-09-24" }, MIDI)).toBe(false);
    expect(abonnementEchu({ plan_abonnement: "premium", subscription_end_date: "2026-09-23" }, MIDI)).toBe(true);
  });

  it("lit l'horodatage que renvoie la base", () => {
    // `profiles.subscription_end_date` est un timestamptz : PostgREST rend l'heure.
    expect(abonnementEchu({ plan_abonnement: "elite", subscription_end_date: "2026-09-23T00:00:00+00:00" }, MIDI)).toBe(true);
    expect(abonnementEchu({ plan_abonnement: "elite", subscription_end_date: "2026-10-24T00:00:00+00:00" }, MIDI)).toBe(false);
  });

  it("le jour s'entend à l'heure de Paris", () => {
    // 23 h 30 UTC le 24 = 1 h 30 le 25 à Paris : un abonnement fini le 24 est échu.
    const nuit = Date.parse("2026-09-24T23:30:00Z");
    expect(abonnementEchu({ plan_abonnement: "premium", subscription_end_date: "2026-09-24" }, nuit)).toBe(true);
  });

  it("une date illisible ne rétrograde personne", () => {
    expect(abonnementEchu({ plan_abonnement: "premium", subscription_end_date: "bientôt" }, MIDI)).toBe(false);
  });
});
