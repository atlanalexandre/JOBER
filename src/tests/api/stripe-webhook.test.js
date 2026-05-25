import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ── Vérification signature Stripe (logique extraite du webhook) ───
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
  const timestamp = parts["t"];
  const sig = parts["v1"];
  if (!timestamp || !sig) return false;
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return expected === sig;
}

const SECRET = "whsec_test_secret_1234";

function makeSignature(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = `${timestamp}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("Stripe webhook — vérification signature HMAC", () => {
  const body = JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_test" } } });

  it("signature valide → true", () => {
    const sig = makeSignature(body, SECRET);
    expect(verifyStripeSignature(body, sig, SECRET)).toBe(true);
  });

  it("signature avec mauvais secret → false", () => {
    const sig = makeSignature(body, "wrong_secret");
    expect(verifyStripeSignature(body, sig, SECRET)).toBe(false);
  });

  it("header manquant → false", () => {
    expect(verifyStripeSignature(body, null, SECRET)).toBe(false);
  });

  it("secret manquant → false", () => {
    const sig = makeSignature(body, SECRET);
    expect(verifyStripeSignature(body, sig, null)).toBe(false);
  });

  it("body modifié après signature → false", () => {
    const sig = makeSignature(body, SECRET);
    expect(verifyStripeSignature(body + "tampered", sig, SECRET)).toBe(false);
  });
});

// ── Calcul montant en centimes pour Stripe ────────────────────────
describe("Conversion montant → centimes Stripe", () => {
  const toCents = (euros) => Math.round(Number(euros) * 100);

  it("112€ → 11200 centimes", () => {
    expect(toCents(112)).toBe(11200);
  });
  it("14.50€ → 1450 centimes", () => {
    expect(toCents(14.50)).toBe(1450);
  });
  it("0.01€ → 1 centime", () => {
    expect(toCents(0.01)).toBe(1);
  });
  it("montant string → conversion correcte", () => {
    expect(toCents("99")).toBe(9900);
  });
  it("jamais négatif ou NaN pour les entrées valides", () => {
    expect(toCents(0)).toBeGreaterThanOrEqual(0);
    expect(isNaN(toCents(0))).toBe(false);
    expect(isNaN(toCents("0"))).toBe(false);
  });
});
