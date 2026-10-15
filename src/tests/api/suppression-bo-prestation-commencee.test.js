// Suppression d'un compte au back-office pendant une prestation commencée :
// refusée (décision D3 d'Alexandre, 14/10/2026 — `e2e/91` sur la recette).
// Elle remboursait la prestation en entier et l'annulait, sans payer le
// prestataire du travail déjà fait.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
const bloc = source.slice(source.indexOf('if (action === "delete")'), source.indexOf('if (action === "suspend")'));

describe("bo-action delete : prestation commencée", () => {
  it("lit le démarrage des prestations en cours", () => {
    expect(bloc).toMatch(/select=id,client_id,prestataire_id,status,started_at,/);
  });
  it("refuse (409) avant le moindre remboursement ou effacement", () => {
    const refus = bloc.indexOf('m.status === "assigned" && m.started_at');
    expect(refus).toBeGreaterThan(0);
    expect(bloc.slice(refus, refus + 400)).toMatch(/res\.status\(409\)/);
    expect(refus).toBeLessThan(bloc.indexOf("rembourserDepuisLeBO("));
    expect(refus).toBeLessThan(bloc.indexOf("supprimerCompteAuth("));
  });
});
