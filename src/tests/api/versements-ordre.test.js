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
  it("comptes illisibles : tirage au hasard, comme avant", () => {
    expect(ordonnerVersements(dus(300, "b", "sans"), new Map(), 200)).toHaveLength(200);
  });
});
