// Ce qui revient au prestataire après un remboursement de litige.
//
// La règle a été fixée par Alexandre le 24/08/2026 : sur ce que le client a
// payé et qui ne lui est pas rendu, ALANE ne garde que ses frais de service ;
// le reste va au prestataire.
//
//     prestataire = montant payé − remboursé au client − frais de service
//
// Elle n'est pas éprouvée ici par l'appel réseau — `executerResolution` parle à
// Stripe — mais par le CALCUL, qui est la seule chose qui décide de qui touche
// quoi. Un test sur ce calcul vaut mieux qu'un test sur la plomberie.
import { describe, it, expect } from "vitest";
import { montantsDeCloture } from "../../../api/_cloture.js";

/** Le calcul de `executerResolution`, isolé. */
function partAuPrestataire(mission, rembourseEuros) {
  const { partPrestataire, fraisService } = montantsDeCloture(mission);
  const paye  = Number(mission.montant_total || 0);
  const rendu = rembourseEuros === null ? paye : rembourseEuros;
  const brut  = Math.round((paye - rendu - fraisService) * 100) / 100;
  const reste = Math.max(0, Math.min(brut, Math.round(partPrestataire * 100) / 100));
  return { reste, aVerser: reste >= 1, fraisService, partPrestataire };
}

// La prestation du 21/08/2026 : 1 h à 15 €, 5,20 € de frais, 20,20 € payés.
const PRESTATION = { montant_total: 20.20, tarif_horaire: 15, hours: 1, actual_hours: 1 };

describe("le partage après un remboursement de litige", () => {
  it("établit bien 15,00 € de prestation et 5,20 € de frais", () => {
    const { partPrestataire, fraisService } = montantsDeCloture(PRESTATION);
    expect(partPrestataire).toBeCloseTo(15.00, 2);
    expect(fraisService).toBeCloseTo(5.20, 2);
  });

  it("verse au prestataire ce qui reste après remboursement et frais", () => {
    // Le cas réel : 30 % du prix rendus au client, soit 6,06 €.
    const r = partAuPrestataire(PRESTATION, 6.06);
    expect(r.reste).toBeCloseTo(8.94, 2);
    expect(r.aVerser).toBe(true);
    // Le compte doit tomber juste : rien ne se perd en route.
    expect(6.06 + 5.20 + r.reste).toBeCloseTo(20.20, 2);
  });

  it("ne verse rien sur un remboursement total du prix", () => {
    // 20,20 − 5,20 = 15,00 € rendus : l'ancien comportement, retrouvé sans
    // règle particulière. C'est la raison pour laquelle il n'y en a qu'une.
    const r = partAuPrestataire(PRESTATION, 15.00);
    expect(r.reste).toBe(0);
    expect(r.aVerser).toBe(false);
  });

  it("ne verse rien quand le remboursement absorbe tout", () => {
    expect(partAuPrestataire(PRESTATION, 20.20).reste).toBe(0);
    // Un remboursement supérieur au payé ne peut pas rendre un montant négatif.
    expect(partAuPrestataire(PRESTATION, 25).reste).toBe(0);
  });

  it("ne dépasse jamais ce que le prestataire aurait touché sans litige", () => {
    // Borne de sûreté : même si le remboursement était nul, il ne touche que
    // sa part — jamais les frais de service en plus.
    const r = partAuPrestataire(PRESTATION, 0);
    expect(r.reste).toBeCloseTo(15.00, 2);
    expect(r.reste).toBeLessThanOrEqual(r.partPrestataire);
  });

  it("annule le versement sous un euro plutôt que de le programmer", () => {
    // Stripe refuse les virements de moins d'un euro : un versement programmé
    // à 0,40 € finirait en `failed`, et le prestataire chercherait pourquoi.
    const r = partAuPrestataire(PRESTATION, 14.60); // reste 0,40 €
    expect(r.reste).toBeCloseTo(0.40, 2);
    expect(r.aVerser).toBe(false);
  });

  it("tient sur une prestation de plusieurs heures", () => {
    const m = { montant_total: 68.10, tarif_horaire: 20, hours: 3, actual_hours: 3 };
    const { partPrestataire, fraisService } = montantsDeCloture(m);
    expect(partPrestataire).toBeCloseTo(60.00, 2);
    expect(fraisService).toBeCloseTo(8.10, 2);
    const r = partAuPrestataire(m, 20);
    expect(r.reste).toBeCloseTo(40.00, 2);
    expect(20 + 8.10 + r.reste).toBeCloseTo(68.10, 2);
  });
});
