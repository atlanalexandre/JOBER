// Le remboursement des heures ajoutées non faites doit pouvoir être REJOUÉ.
//
// 06/10/2026 : plafonné sur le reste remboursable, son montant changeait au
// second essai, et Stripe refusait la requête (doublon divergent).
// 07/10/2026 : le montant d'une même opération change aussi avec les heures
// écoulées. On cherche désormais chez Stripe un remboursement portant
// l'étiquette de l'opération : s'il existe, c'est fait — ni échec, ni doublon.
import { describe, it, expect, vi, afterEach } from "vitest";
import { rembourserAjoutsNonFaits } from "../../../api/_remboursement_bo.js";

const json = (corps, statut = 200) => ({ ok: statut < 300, status: statut, json: async () => corps });

afterEach(() => vi.unstubAllGlobals());

function stripe({ existants = [], dejaRendu = 0, refus = null } = {}) {
  const envois = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opt) => {
    const u = String(url);
    if (u.includes("/v1/refunds?payment_intent=")) return json({ data: existants });
    if (u.includes("/payment_intents/")) {
      return json({ id: "pi_x", amount_received: 8160, latest_charge: { amount_refunded: dejaRendu } });
    }
    const corps = new URLSearchParams(opt.body);
    envois.push({ montant: corps.get("amount"), operation: corps.get("metadata[alane_operation]"), cle: opt.headers["Idempotency-Key"] });
    return refus ? json({ error: refus }, 400) : json({ id: "re_1" });
  }));
  return envois;
}

describe("rembourser les heures ajoutées non faites", () => {
  it("rembourse et étiquette l'opération", async () => {
    const a = stripe();
    const r = await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "2026-10-06-fin", "test");
    expect(r).toEqual({ ok: true, centimes: 8000 });
    expect(a).toEqual([{ montant: "8000", operation: "2026-10-06-fin", cle: "refund-ajout-pi_x-2026-10-06-fin-8000" }]);
  });

  it("rejouée, l'opération déjà remboursée n'est ni refaite ni refusée — même si le montant a changé", async () => {
    const a = stripe({ existants: [{ id: "re_1", amount: 3000, status: "succeeded", metadata: { alane_operation: "2026-10-06-jour" } }] });
    const r = await rembourserAjoutsNonFaits({ pi_x: 15 }, "sk", "2026-10-06-jour", "test");
    expect(r.ok).toBe(true);
    expect(a, "aucun nouveau remboursement").toEqual([]);
  });

  it("une AUTRE opération sur le même paiement est bien remboursée", async () => {
    const a = stripe({ existants: [{ id: "re_1", amount: 2000, status: "succeeded", metadata: { alane_operation: "2026-10-06-jour" } }] });
    await rembourserAjoutsNonFaits({ pi_x: 40 }, "sk", "2026-10-07-fin", "test");
    expect(a.map(e => e.montant)).toEqual(["4000"]);
  });

  it("jamais plus que ce qui reste remboursable sur le paiement", async () => {
    const a = stripe({ dejaRendu: 8000 });
    await rembourserAjoutsNonFaits({ pi_x: 80 }, "sk", "j", "test");
    expect(a.map(e => e.montant)).toEqual(["160"]);
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
