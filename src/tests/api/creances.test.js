import { describe, it, expect } from "vitest";
import {
  repartirCompensation, creanceCompensable, dateExigibilite,
  PART_MAX_COMPENSABLE, DELAI_EXIGIBILITE_JOURS,
} from "../../../api/_creances.js";

const creance = (o = {}) => ({
  id: "c1", statut: "active", montant_restant: 100,
  notifiee_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T10:00:00Z",
  ...o,
});

describe("creanceCompensable", () => {
  it("accepte une créance active et notifiée", () => {
    expect(creanceCompensable(creance()).ok).toBe(true);
  });

  it("refuse une créance jamais notifiée — l'article impose l'information préalable", () => {
    const v = creanceCompensable(creance({ notifiee_at: null }));
    expect(v.ok).toBe(false);
    expect(v.motif).toMatch(/notifiée/);
  });

  it("refuse une créance contestée — la contestation suspend la compensation", () => {
    const v = creanceCompensable(creance({ statut: "contestee" }));
    expect(v.ok).toBe(false);
    expect(v.motif).toMatch(/contestée/);
  });

  it("refuse une créance éteinte ou abandonnée", () => {
    expect(creanceCompensable(creance({ statut: "eteinte" })).ok).toBe(false);
    expect(creanceCompensable(creance({ statut: "abandonnee" })).ok).toBe(false);
  });

  it("refuse une créance dont il ne reste rien", () => {
    expect(creanceCompensable(creance({ montant_restant: 0 })).ok).toBe(false);
  });
});

describe("repartirCompensation", () => {
  it("ne retient jamais plus de la moitié du versement", () => {
    const r = repartirCompensation(200, [creance({ montant_restant: 500 })]);
    expect(r.compensationTotale).toBe(100);
    expect(r.montantVerse).toBe(100);
    expect(PART_MAX_COMPENSABLE).toBe(0.5);
  });

  it("s'arrête au reste dû quand il est inférieur à la moitié", () => {
    const r = repartirCompensation(200, [creance({ montant_restant: 30 })]);
    expect(r.compensationTotale).toBe(30);
    expect(r.montantVerse).toBe(170);
    expect(r.imputations[0].restantApres).toBe(0);
  });

  it("plafonne sur le versement ENTIER, pas créance par créance", () => {
    // Deux créances de 500 € sur un versement de 200 € : la moitié fait 100 €,
    // pas 100 € puis encore 50 € sur ce qui reste.
    const r = repartirCompensation(200, [
      creance({ id: "a", montant_restant: 500, created_at: "2026-08-01T00:00:00Z" }),
      creance({ id: "b", montant_restant: 500, created_at: "2026-08-02T00:00:00Z" }),
    ]);
    expect(r.compensationTotale).toBe(100);
    expect(r.montantVerse).toBe(100);
  });

  it("sert la créance la plus ancienne en premier", () => {
    const r = repartirCompensation(200, [
      creance({ id: "recente", montant_restant: 500, created_at: "2026-08-10T00:00:00Z" }),
      creance({ id: "ancienne", montant_restant: 40,  created_at: "2026-08-01T00:00:00Z" }),
    ]);
    expect(r.imputations.map(i => i.creance_id)).toEqual(["ancienne", "recente"]);
    expect(r.imputations[0].montant).toBe(40);
    expect(r.imputations[1].montant).toBe(60);
    expect(r.compensationTotale).toBe(100);
  });

  it("écarte les créances non compensables en disant pourquoi", () => {
    const r = repartirCompensation(200, [
      creance({ id: "muette", notifiee_at: null }),
      creance({ id: "contestee", statut: "contestee" }),
    ]);
    expect(r.compensationTotale).toBe(0);
    expect(r.montantVerse).toBe(200);
    expect(r.ecartees.map(e => e.creance_id).sort()).toEqual(["contestee", "muette"]);
  });

  it("ne retient rien sans créance", () => {
    const r = repartirCompensation(200, []);
    expect(r.compensationTotale).toBe(0);
    expect(r.montantVerse).toBe(200);
  });

  it("compte en centimes entiers — pas de créance qui ne s'éteint jamais tout à fait", () => {
    // 64,89 € : la moitié fait 32,445 €, arrondie au centime INFÉRIEUR pour ne
    // jamais dépasser la limite contractuelle.
    const r = repartirCompensation(64.89, [creance({ montant_restant: 1000 })]);
    expect(r.compensationTotale).toBe(32.44);
    expect(r.montantVerse).toBe(32.45);
    expect(r.compensationTotale + r.montantVerse).toBe(64.89);
  });

  it("éteint exactement une créance sur plusieurs versements", () => {
    let restant = 100;
    let total = 0;
    for (let i = 0; i < 10 && restant > 0; i++) {
      const r = repartirCompensation(50, [creance({ montant_restant: restant })]);
      total += r.compensationTotale;
      restant = r.imputations[0]?.restantApres ?? 0;
    }
    expect(restant).toBe(0);
    expect(total).toBe(100);
  });

  it("ne retient rien sur un versement nul ou négatif", () => {
    expect(repartirCompensation(0, [creance()]).compensationTotale).toBe(0);
    expect(repartirCompensation(-10, [creance()]).compensationTotale).toBe(0);
  });
});

describe("dateExigibilite", () => {
  it("place l'exigibilité soixante jours après la notification", () => {
    const t = Date.UTC(2026, 7, 1, 12, 0, 0);
    expect(dateExigibilite(t)).toBe(new Date(t + 60 * 86400000).toISOString());
    expect(DELAI_EXIGIBILITE_JOURS).toBe(60);
  });
});
