import { describe, it, expect } from "vitest";
import { empreinteParametres } from "../../../api/stripe-intent.js";

// 30/09/2026 : la clé d'idempotence ne portait que le montant. Cocher « mémoriser ma
// carte » après un refus renvoyait la même clé avec d'autres paramètres : Stripe
// refusait, et le client ne pouvait plus payer avant le lendemain.
describe("empreinteParametres()", () => {
  const base = { amount: "11098", currency: "eur", "metadata[mission]": "m1" };
  it("mêmes paramètres, même empreinte (double clic)", () => {
    expect(empreinteParametres({ ...base })).toBe(empreinteParametres({ ...base }));
  });
  it("ordre indifférent", () => {
    expect(empreinteParametres({ currency: "eur", amount: "11098", "metadata[mission]": "m1" })).toBe(empreinteParametres(base));
  });
  it("« mémoriser ma carte » cochée : autre empreinte, donc autre paiement", () => {
    expect(empreinteParametres({ ...base, setup_future_usage: "off_session" })).not.toBe(empreinteParametres(base));
  });
});
