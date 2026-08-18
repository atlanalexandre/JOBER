import { describe, it, expect } from "vitest";
import { montantsDeCloture, nombreDeJours, partHoraire } from "../../../api/_cloture.js";

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

// ═══════════════════════════════════════════════════════════════════════════
// Prestations récurrentes : le nombre de jours ne se devine pas
// ═══════════════════════════════════════════════════════════════════════════
//
// Le paiement d'une candidature acceptée calculait `tarif × heures`, sans les
// JOURS ni les FRAIS DE SERVICE — une troisième version du montant, distincte de
// celle du tunnel de réservation et de celle de la clôture.
//
// Sur cinq jours à 8 h et 15 €/h, il encaissait 120 € au lieu de 600 €. La
// clôture, elle, compte bien les cinq jours : ALANE versait 600 € pour 120 €
// encaissés. Et comme les frais se déduisent de ce qui reste du montant payé,
// ils tombaient à zéro par-dessus le marché.

describe("montant d'une prestation récurrente", () => {
  const recurrente = {
    tarif_horaire: 15, hours: 8,
    date_debut: "2026-09-01", date_fin: "2026-09-05",
  };

  it("compte cinq jours, pas un seul", () => {
    expect(nombreDeJours(recurrente)).toBe(5);
  });

  it("la part du prestataire porte sur tous les jours", () => {
    const c = montantsDeCloture({ ...recurrente, actual_hours: 8, montant_total: 600 });
    expect(c.partPrestataire).toBe(600);
  });

  // La perte que l'ancien calcul produisait, chiffrée.
  it("un encaissement calculé sur un seul jour fait tout perdre", () => {
    const c = montantsDeCloture({ ...recurrente, actual_hours: 8, montant_total: 120 });
    expect(c.partPrestataire).toBe(600);
    expect(c.fraisService).toBe(0);          // les frais s'évaporent aussi
    expect(c.partPrestataire - 120).toBe(480);
  });

  it("avec le bon encaissement, les frais réapparaissent", () => {
    const c = montantsDeCloture({ ...recurrente, actual_hours: 8, montant_total: 626.50 });
    expect(c.partPrestataire).toBe(600);
    expect(c.fraisService).toBeCloseTo(26.50, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Le tarif des heures supplémentaires
// ═══════════════════════════════════════════════════════════════════════════
//
// Constaté le 18/08/2026 au premier parcours complet : une heure ajoutée à
// 17 €/h sur une prestation à 15 €/h était versée 15 €. Le prestataire perdait
// l'écart, et ALANE paraissait retenir des frais qu'elle n'avait pas encaissés.
describe("partHoraire — deux tarifs sur une même prestation", () => {
  const base = {
    tarif_horaire: 15, hours: 2,
    extra_hours_tarif: 17, extra_hours_appliquees: 1,
  };

  it("paie la prolongation au tarif annoncé, pas à celui de la commande", () => {
    expect(partHoraire(base, 2, 1)).toBe(32);      // 15 + 17
    expect(partHoraire(base, 2, 1)).not.toBe(30);  // le défaut corrigé
  });

  it("retombe sur le tarif de base sans prolongation", () => {
    expect(partHoraire({ tarif_horaire: 15, hours: 2 }, 2, 1)).toBe(30);
  });

  it("ignore un tarif supplémentaire sans heures appliquées", () => {
    // La proposition a été chiffrée mais jamais réglée : rien n'est dû dessus.
    expect(partHoraire({ tarif_horaire: 15, extra_hours_tarif: 17 }, 2, 1)).toBe(30);
  });

  it("multiplie par le nombre de jours", () => {
    expect(partHoraire(base, 2, 3)).toBe(96);      // 32 × 3
  });

  it("réduit d'abord les heures de BASE quand la durée est plafonnée", () => {
    // Le décalage concerne le début de la prestation, pas la prolongation
    // acceptée en cours de route : c'est la part commandée qui se réduit.
    expect(partHoraire({ ...base, hours: 3 }, 2, 1)).toBe(32); // 1h base + 1h supp
    expect(partHoraire(base, 1, 1)).toBe(17);                  // il ne reste que la supp
    expect(partHoraire(base, 0, 1)).toBe(0);
  });

  it("ne compte jamais plus d'heures supplémentaires que d'heures retenues", () => {
    expect(partHoraire({ ...base, extra_hours_appliquees: 9 }, 2, 1)).toBe(34); // 2 × 17
  });

  it("laisse les frais de service refléter ce qui a été encaissé", () => {
    // 20,20 € réglés à la commande + 17,34 € de prolongation = 37,54 €.
    // La part du prestataire vaut 32 € : il reste 5,54 € de frais, exactement
    // ce qui a été perçu (4,90 + 0,30 + 0,34).
    const m = { ...base, montant_total: 37.54 };
    const r = montantsDeCloture(m);
    expect(r.partPrestataire).toBe(32);
    expect(r.fraisService).toBeCloseTo(5.54, 2);
  });
});
