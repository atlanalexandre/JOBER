// E-mail d'annulation quand SEULE la modification de commande est remboursée
// (frais de service retenus sur le paiement principal) : il annonçait
// « Remboursement 0,00 € » et « aucun montant n'est dû », sous un objet
// annonçant un remboursement (relecture du 09/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
const debut = code.indexOf("Email au client — confirmation de remboursement");
const bloc = code.slice(debut, code.indexOf("Email admin uniquement si le remboursement Stripe a échoué", debut));

describe("e-mail d'annulation, modification seule remboursée", () => {
  it("n'affiche pas une ligne « Remboursement 0,00 € »", () => {
    expect(bloc).toContain("(refundAmount > 0 || ajoutsRembourses <= 0) ? `<tr>");
  });

  it("annonce le remboursement de la modification au lieu de « aucun montant n'est dû »", () => {
    const i = bloc.indexOf(": ajoutsRembourses > 0");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(bloc.indexOf("aucun montant supplémentaire n'est dû"));
    expect(bloc).toContain("La modification de commande a été remboursée automatiquement");
  });
});
