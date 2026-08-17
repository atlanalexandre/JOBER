// Le cashback en réduction sur le paiement.
//
// Ce qui est éprouvé ici n'est pas le calcul — il tient en trois lignes — mais
// les BORNES : ce sont elles qui décident si un client peut ramener un paiement
// à zéro, si un solde peut partir en négatif, et si un remboursement peut
// dépasser ce qui a été prélevé.
import { describe, it, expect } from "vitest";
import {
  reductionCashback,
  montantCharge,
  RESTE_A_PAYER_MIN,
} from "../../../api/_cashback.js";

describe("reductionCashback — ce que le cashback peut absorber", () => {
  it("n'impute rien sans solde", () => {
    expect(reductionCashback(0, 100)).toBe(0);
    expect(reductionCashback(null, 100)).toBe(0);
    expect(reductionCashback(undefined, 100)).toBe(0);
  });

  it("impute le solde entier quand la prestation le dépasse largement", () => {
    expect(reductionCashback(5, 100)).toBe(5);
  });

  it("laisse toujours le minimum à la charge de la carte", () => {
    // Stripe refuse les tout petits paiements : le cashback ne peut jamais
    // solder une prestation à lui seul.
    expect(reductionCashback(100, 20)).toBe(20 - RESTE_A_PAYER_MIN);
    expect(reductionCashback(1000, 5)).toBe(4);
  });

  it("n'impute rien quand la prestation vaut le minimum ou moins", () => {
    expect(reductionCashback(50, RESTE_A_PAYER_MIN)).toBe(0);
    expect(reductionCashback(50, 0.5)).toBe(0);
  });

  it("arrondit au centime INFÉRIEUR", () => {
    // Arrondir vers le haut consommerait un centime que le client n'a pas, et
    // le solde passerait en négatif.
    expect(reductionCashback(2.999, 100)).toBe(2.99);
    expect(reductionCashback(0.017, 100)).toBe(0.01);
  });

  it("ne rend jamais de valeur négative", () => {
    expect(reductionCashback(-5, 100)).toBe(0);
    expect(reductionCashback(5, -100)).toBe(0);
  });

  it("laisse un montant à payer strictement positif", () => {
    for (const [solde, total] of [[3, 4], [50, 12.4], [0.5, 1.4], [999, 1000]]) {
      const r = reductionCashback(solde, total);
      expect(total - r).toBeGreaterThanOrEqual(RESTE_A_PAYER_MIN - 1e-9);
    }
  });

  it("n'impute jamais plus que le solde", () => {
    for (const [solde, total] of [[3, 400], [0.03, 90], [12.5, 13.6]]) {
      expect(reductionCashback(solde, total)).toBeLessThanOrEqual(solde);
    }
  });
});

describe("montantCharge — le plafond de tout remboursement", () => {
  it("vaut le prix quand aucun cashback n'a été appliqué", () => {
    expect(montantCharge({ montant_total: 119.14, cashback_applique: 0 })).toBe(119.14);
    expect(montantCharge({ montant_total: 119.14 })).toBe(119.14);
  });

  it("retranche la part réglée en cashback", () => {
    expect(montantCharge({ montant_total: 119.14, cashback_applique: 5 })).toBe(114.14);
  });

  it("ne descend jamais sous zéro", () => {
    // Cas qui ne devrait pas exister, mais dont le résultat ne doit pas être
    // un remboursement négatif — Stripe le refuserait avec un message opaque.
    expect(montantCharge({ montant_total: 10, cashback_applique: 40 })).toBe(0);
  });

  it("survit à une prestation sans montant", () => {
    expect(montantCharge({})).toBe(0);
    expect(montantCharge(null)).toBe(0);
  });
});

describe("l'invariant du prix", () => {
  it("le prix reste le prix : la réduction ne touche pas montant_total", () => {
    // C'est la raison d'être des deux colonnes. Si `montant_total` bougeait, la
    // facture du prestataire, les frais de service et le cashback suivant
    // seraient tous calculés sur un prix qui n'a jamais été facturé.
    const prix = 119.14;
    const reduction = reductionCashback(5, prix);
    const mission = { montant_total: prix, cashback_applique: reduction };

    expect(mission.montant_total).toBe(prix);
    expect(montantCharge(mission) + reduction).toBeCloseTo(prix, 2);
  });
});
