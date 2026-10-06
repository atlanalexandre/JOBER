import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { plafonnerRemboursement } from "../../../api/_cashback.js";

// Remboursements partiels successifs (06/10/2026) : chacun sous le plafond de
// la prestation, ils pouvaient ensemble le dépasser — Stripe refusait alors le
// dernier. Le plafond tient compte de ce que Stripe a DÉJÀ rendu.

const SB = "https://base.test";
const H = { apikey: "k" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
const M = { id: "m1", montant_total: 110.98, cashback_applique: 0, stripe_payment_intent: "pi_1" };

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("plafond des remboursements cumulés", () => {
  it("un remboursement déjà fait réduit ce qui reste remboursable", async () => {
    // 110,98 € encaissés, 30 € déjà rendus pour un décalage : il reste 80,98 €.
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("payment_intents/pi_1")
      ? json({ id: "pi_1", latest_charge: { amount: 11098, amount_captured: 11098, amount_refunded: 3000 } })
      : json([])));
    expect(await plafonnerRemboursement(10400, M, SB, H)).toBe(8098);
    expect(await plafonnerRemboursement(5000, M, SB, H)).toBe(5000);
  });

  it("rien n'a encore été rendu : le plafond de la prestation, comme avant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "pi_1", latest_charge: { amount: 11098, amount_captured: 11098, amount_refunded: 0 } })));
    expect(await plafonnerRemboursement(20000, M, SB, H)).toBe(11098);
  });

  it("Stripe muet : on garde le plafond de la prestation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "x" } }, 500)));
    expect(await plafonnerRemboursement(20000, M, SB, H)).toBe(11098);
  });

  it("« la totalité » (null) traverse sans changement", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await plafonnerRemboursement(null, M, SB, H)).toBe(null);
    expect(f).not.toHaveBeenCalled();
  });
});
