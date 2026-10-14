// Annulation par le client d'une réservation payée que personne n'a reprise :
// remboursement intégral, frais de service compris (décision D2 d'Alexandre,
// 14/10/2026 — `e2e/86` sur la recette).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fraisRetenusAnnulationClient, sansPrestataireTrouve, STATUTS_SANS_PRESTATAIRE } from "../../../api/_annulation.js";

const paye = { stripe_payment_intent: "pi_test" };

describe("fraisRetenusAnnulationClient", () => {
  it("personne n'a repris la réservation payée : rien n'est retenu", () => {
    expect(fraisRetenusAnnulationClient({ ...paye, status: "open" })).toBe(false);
    expect(fraisRetenusAnnulationClient({ ...paye, status: "needs_replacement" })).toBe(false);
  });
  it("un prestataire tient ou peut encore accepter la réservation : les frais sont retenus", () => {
    expect(fraisRetenusAnnulationClient({ ...paye, status: "pending_acceptance" })).toBe(true);
    expect(fraisRetenusAnnulationClient({ ...paye, status: "assigned" })).toBe(true);
  });
  it("le retard du prestataire rend tout, quel que soit le statut (CGPS art. 8.2)", () => {
    expect(fraisRetenusAnnulationClient({ ...paye, status: "assigned" }, { retardPrestataire: true })).toBe(false);
  });
  it("une demande jamais payée n'est pas « sans prestataire trouvé » : il n'y a rien à rendre", () => {
    expect(sansPrestataireTrouve({ status: "open", stripe_payment_intent: null })).toBe(false);
  });
  it("mêmes statuts que la clôture faute de prestataire de la tâche planifiée", () => {
    const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    expect(cron).toContain(`status=in.(${STATUTS_SANS_PRESTATAIRE.join(",")})`);
  });
});

describe("cancel_client applique la règle", () => {
  const source = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = source.slice(source.indexOf('if (action === "cancel_client")'), source.indexOf('if (action === "cancel_in_progress")'));
  it("la retenue des frais passe par fraisRetenusAnnulationClient", () => {
    expect(bloc).toMatch(/const retenirFrais = fraisRetenusAnnulationClient\(mission, \{ retardPrestataire: annulationPourRetard \}\)/);
  });
  it("l'e-mail dit pourquoi tout est rendu, et ne parle de prestataire absent que s'il l'était", () => {
    expect(bloc).toContain("Personne n'avait encore été trouvé pour votre prestation");
    const absent = bloc.indexOf("Votre prestataire ne s'est pas présenté");
    expect(bloc.slice(absent - 200, absent)).toMatch(/annulationPourRetard/);
  });
});

describe("écran du client", () => {
  const src = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
  it("« Annuler » est proposé quand un remplaçant est recherché", () => {
    expect(src).toMatch(/selected\.status === "pending_acceptance" \|\| selected\.status === "needs_replacement" \|\|/);
  });
  it("la confirmation annonce le remboursement intégral quand personne n'a été trouvé", () => {
    const modale = src.slice(src.indexOf("{showCancelConfirm && ("));
    expect(modale.slice(0, 3000)).toMatch(/\["open", "needs_replacement"\]\.includes\(selected\.status\)/);
    expect(modale.slice(0, 3000)).toContain("Personne n'a encore été trouvé pour votre prestation.");
  });
  it("la politique d'annulation affichée avant le paiement le dit", () => {
    expect(src).toContain('["Aucun prestataire trouvé", "Remboursement intégral, frais compris", "#10D98F"]');
  });
});
