import { describe, it, expect } from "vitest";
import { montantsDeCloture, nombreDeJours } from "../../../api/_cloture.js";

// Prestation de référence : 4 h à 28 €/h, un seul jour, 116,90 € encaissés
// (112 € de part horaire + 4,90 € de frais de service).
const BASE = {
  hours: 4, actual_hours: 4, tarif_horaire: 28,
  montant_total: 116.90,
};

describe("nombreDeJours", () => {
  it("rend 1 sans dates de début et de fin", () => {
    expect(nombreDeJours({})).toBe(1);
  });
  it("compte les deux bornes : du 6 au 10 août, cinq jours", () => {
    expect(nombreDeJours({ date_debut: "2026-08-06", date_fin: "2026-08-10" })).toBe(5);
  });
  it("ne descend jamais sous 1, même sur des dates incohérentes", () => {
    expect(nombreDeJours({ date_debut: "2026-08-10", date_fin: "2026-08-06" })).toBe(1);
  });
});

describe("montantsDeCloture", () => {
  it("sépare la part du prestataire des frais de service", () => {
    const r = montantsDeCloture(BASE);
    expect(r.partPrestataire).toBe(112);
    expect(r.fraisService).toBe(4.90);
    expect(r.totalClient).toBe(116.90);
  });

  it("multiplie par le nombre de jours — c'est ce que le cron oubliait", () => {
    // Cinq jours à 112 € : le prestataire doit toucher 560 €, pas 112 €.
    const r = montantsDeCloture({
      ...BASE, date_debut: "2026-08-06", date_fin: "2026-08-10", montant_total: 584.50,
    });
    expect(r.jours).toBe(5);
    expect(r.partPrestataire).toBe(560);
    expect(r.fraisService).toBe(24.50);
  });

  it("conserve les frais de service dans le total facturé, même si la durée réelle baisse", () => {
    // 2 h réellement faites au lieu de 4 : la part horaire baisse, les frais non.
    const r = montantsDeCloture({ ...BASE, actual_hours: 2 });
    expect(r.partPrestataire).toBe(56);
    expect(r.fraisService).toBe(4.90);
    expect(r.totalClient).toBe(60.90);
  });

  it("plafonne les heures quand un décalage d'horaire n'a jamais été arbitré", () => {
    // Arrivée avec 1 h de retard, décalage resté « pending » : la prestation est
    // facturée jusqu'à l'heure de fin prévue, donc 3 h et non 4.
    const r = montantsDeCloture({ ...BASE, delay_status: "pending", arrival_delay_minutes: 60 });
    expect(r.heuresEffectives).toBe(3);
    expect(r.partPrestataire).toBe(84);
    expect(r.ajustementRetard).toEqual({ avant: 4, apres: 3, retard: 60 });
  });

  it("ne plafonne pas un décalage déjà accepté par le client", () => {
    const r = montantsDeCloture({ ...BASE, delay_status: "accepted", arrival_delay_minutes: 60 });
    expect(r.partPrestataire).toBe(112);
    expect(r.ajustementRetard).toBeNull();
  });

  it("ne facture pas de frais négatifs quand l'encaissement est inférieur à la part prévue", () => {
    const r = montantsDeCloture({ ...BASE, montant_total: 50 });
    expect(r.fraisService).toBe(0);
    expect(r.totalClient).toBe(112);
  });

  it("rend 0 plutôt qu'un NaN sur une prestation sans tarif", () => {
    const r = montantsDeCloture({ hours: 4 });
    expect(r.partPrestataire).toBe(0);
    expect(r.totalClient).toBe(0);
  });

  it("ne renvoie jamais de centime flottant", () => {
    // 3,7 h × 21,30 € = 78,81 € exactement, et non 78,81000000000001.
    const r = montantsDeCloture({ hours: 3.7, actual_hours: 3.7, tarif_horaire: 21.30, montant_total: 0 });
    expect(r.partPrestataire).toBe(78.81);
  });
});
