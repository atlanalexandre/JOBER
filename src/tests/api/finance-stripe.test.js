// Écran Finance du back-office, bloc Stripe (relecture du 09/10/2026) : des
// montants de test présentés comme réels, une commission inventée, et une
// lecture coupée à 100 paiements.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const serveur = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
const bloc = serveur.slice(serveur.indexOf('action === "stripe_stats"'), serveur.indexOf('action === "list_paid_missions"'));
const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

describe("bloc Stripe de l'écran Finance", () => {
  it("dit si le compte est en mode test, d'après la clé", () => {
    expect(bloc).toMatch(/const mode = \/\^\(sk\|rk\)_live_\/\.test\(STRIPE_KEY\) \? "live" : "test"/);
    expect(ecran).toContain('stats?.mode === "test"');
    expect(ecran).toContain("MODE TEST");
  });

  it("n'invente plus de commission à 20 %", () => {
    expect(bloc).not.toMatch(/0\.20/);
    expect(ecran).not.toContain("Commission ALANE (20%)");
  });

  it("lit tous les paiements, page par page, remboursements déduits", () => {
    expect(bloc).toContain("starting_after");
    expect(bloc).toContain("amount_refunded");
    expect(bloc).toContain("v1/transfers");
  });
});
