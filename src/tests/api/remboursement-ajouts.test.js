// Le remboursement des heures ajoutées non faites (06/10/2026) doit pouvoir
// être REJOUÉ. Plafonné sur le reste remboursable, son montant changeait au
// second essai — le paiement étant déjà remboursé — et Stripe refusait la
// requête comme un doublon divergent : l'interruption ne passait plus jamais.
import { describe, it, expect, vi, afterEach } from "vitest";
import { rembourserAjoutsNonFaits } from "../../../api/_remboursement_bo.js";

const json = (corps, statut = 200) => ({ ok: statut < 300, status: statut, json: async () => corps });

afterEach(() => vi.unstubAllGlobals());

function stripe({ dejaRendu = 0, refus = null } = {}) {
  const envois = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opt) => {
    if (String(url).includes("/payment_intents/")) {
      return json({ id: "pi_x", amount_received: 8160, latest_charge: { amount_refunded: dejaRendu } });
    }
    envois.push({ montant: new URLSearchParams(opt.body).get("amount"), cle: opt.headers["Idempotency-Key"] });
    return refus ? json({ error: refus }, 400) : json({ id: "re_1" });
  }));
  return envois;
}

describe("rembourser les heures ajoutées non faites", () => {
  it("rejoué après un premier remboursement, il renvoie la MÊME requête", async () => {
    const a = stripe();
    await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "2026-10-06-fin", "test");
    const b = stripe({ dejaRendu: 8000 });
    const r = await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "2026-10-06-fin", "test");
    expect(r.ok).toBe(true);
    expect(b).toEqual(a);
    expect(a).toEqual([{ montant: "8000", cle: "refund-ajout-pi_x-2026-10-06-fin" }]);
  });

  it("jamais plus que ce que le paiement a encaissé", async () => {
    const a = stripe();
    await rembourserAjoutsNonFaits({ pi_x: 500 }, "sk", "j", "test");
    expect(a[0].montant).toBe("8160");
  });

  it("un paiement déjà entièrement rendu compte comme fait", async () => {
    stripe({ refus: { code: "charge_already_refunded" } });
    expect((await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "j", "test")).ok).toBe(true);
  });

  it("un autre refus de Stripe arrête tout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripe({ refus: { code: "amount_too_large" } });
    expect((await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "j", "test")).ok).toBe(false);
  });
});
