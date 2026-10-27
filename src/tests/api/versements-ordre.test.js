// File des versements (relecture du 26/10/2026) : les versements qui ne
// partiront jamais — prestataire sans compte de virement — ne doivent plus
// prendre la place de ceux qui peuvent partir.
import { describe, it, expect } from "vitest";
import { ordonnerVersements } from "../../../api/cron-reset-monthly.js";

const dus = (n, prefixe, presta) => Array.from({ length: n }, (_, i) => ({ id: `${prefixe}${i}`, prestataire_id: presta }));
const etats = new Map([["actif", { stripe_account_id: "acct_1", stripe_account_status: "enabled" }], ["sans", { stripe_account_id: null }]]);

describe("ordonnerVersements", () => {
  it("300 bloqués et 50 payables : les 50 payables sont tous traités", () => {
    const lots = ordonnerVersements([...dus(300, "b", "sans"), ...dus(50, "p", "actif")], etats, 200);
    expect(lots).toHaveLength(200);
    expect(lots.filter(m => m.prestataire_id === "actif")).toHaveLength(50);
  });
  it("plus de payables que de places : il reste au moins 20 places pour relire les autres comptes", () => {
    const lots = ordonnerVersements([...dus(30, "b", "sans"), ...dus(500, "p", "actif")], etats, 200);
    expect(lots.filter(m => m.prestataire_id === "sans")).toHaveLength(20);
    expect(lots.filter(m => m.prestataire_id === "actif")).toHaveLength(180);
  });
  it("une retenue à poser passe en tête, compte actif ou non", () => {
    const lots = ordonnerVersements([...dus(300, "b", "sans"), { id: "r", prestataire_id: "sans", payout_hold_reason: "opposition_bancaire" }], etats, 21, 20);
    expect(lots.map(m => m.id)).toContain("r");
  });
  it("une retenue ÉCHUE ne passe pas en tête : elle ne retient plus rien (relecture du 27/10/2026)", () => {
    const T = Date.parse("2026-10-27T12:00:00Z");
    const echues = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, prestataire_id: "sans", payout_hold_reason: "opposition_bancaire", payout_hold_until: "2026-10-01T00:00:00Z" }));
    const lots = ordonnerVersements([...echues, ...dus(50, "p", "actif")], etats, 200, 20, T);
    expect(lots.filter(m => m.prestataire_id === "actif")).toHaveLength(50);
    // Retenue en cours (terme à venir, ou sans terme) : toujours en tête.
    const enCours = ordonnerVersements([...dus(300, "b", "sans"),
      { id: "v", prestataire_id: "sans", payout_hold_reason: "opposition_bancaire", payout_hold_until: "2026-12-01T00:00:00Z" },
      { id: "s", prestataire_id: "sans", payout_hold_reason: "opposition_bancaire", payout_hold_until: null }], etats, 22, 20, T);
    expect(enCours.map(m => m.id)).toEqual(expect.arrayContaining(["v", "s"]));
  });
  it("comptes illisibles : tirage au hasard, comme avant", () => {
    expect(ordonnerVersements(dus(300, "b", "sans"), new Map(), 200)).toHaveLength(200);
  });
});
