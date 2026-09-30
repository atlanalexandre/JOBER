import { describe, it, expect } from "vitest";
import { refusPassager } from "../../../api/cron-reset-monthly.js";

// 30/09/2026 : un refus de virement passait le versement en « échoué » pour
// toujours. Le plus probable à 48 h — solde disponible insuffisant — se règle seul.
describe("refusPassager()", () => {
  it("solde disponible insuffisant : réessayé au passage suivant", () => {
    expect(refusPassager({ code: "balance_insufficient", type: "invalid_request_error" }, 400)).toBe(true);
  });
  it("Stripe indisponible ou limite de débit : réessayé", () => {
    expect(refusPassager({ type: "api_error" }, 500)).toBe(true);
    expect(refusPassager(null, 429)).toBe(true);
    expect(refusPassager(null, 503)).toBe(true);
  });
  it("compte de paiement invalide : échoué, à relancer à la main une fois corrigé", () => {
    expect(refusPassager({ code: "account_invalid", type: "invalid_request_error" }, 400)).toBe(false);
  });
});
