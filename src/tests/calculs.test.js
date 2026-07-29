import { describe, it, expect } from "vitest";
import { prixClient, tarifInterim, economiePct, calcCashback, getCashbackTier, CASHBACK_TIERS } from "../constants/plans.js";

// ── Calcul du tarif client ────────────────────────────────────────
describe("prixClient", () => {
  it("retourne le tarifNet tel quel (0% commission)", () => {
    expect(prixClient(14, "restauration")).toBe(14);
    expect(prixClient(12, "proprete")).toBe(12);
  });
  it("ne peut pas retourner un montant négatif", () => {
    expect(prixClient(0, "divers")).toBeGreaterThanOrEqual(0);
  });
});

// ── Comparaison intérim ───────────────────────────────────────────
describe("tarifInterim", () => {
  it("calcule le coefficient ×2.2 de l'intérim", () => {
    expect(tarifInterim(10)).toBeCloseTo(22);
    expect(tarifInterim(14)).toBeCloseTo(30.8);
  });
  it("économie par rapport à l'intérim > 0", () => {
    expect(economiePct(14)).toBeGreaterThan(0);
    expect(economiePct(14)).toBeLessThan(100);
  });
});

// ── Cashback ──────────────────────────────────────────────────────
// Grille de référence, confirmée par Alexandre le 29/07/2026 :
//   Standard  0-2 missions   0,5 %
//   Silver    3-5 missions   0,75 %
//   Gold      6-9 missions   1 %
//   Platinum  10+ missions   1,5 %
// ATTENTION : ces valeurs ne pilotent que l'affichage. Le cashback réellement
// crédité est calculé dans api/missions.js, qui lit la clé `cashback_rates` de
// `platform_settings` et écrase cette grille si elle est renseignée en base.
// Les deux doivent rester alignées — voir DOCUMENTATION.md §4.
describe("getCashbackTier", () => {
  it("0 mission → Standard", () => {
    expect(getCashbackTier(0).label).toBe("Standard");
  });
  it("5 missions → Silver", () => {
    expect(getCashbackTier(5).label).toBe("Silver");
  });
  it("10 missions → Platinum", () => {
    expect(getCashbackTier(10).label).toBe("Platinum");
  });
  it("20 missions → Platinum", () => {
    expect(getCashbackTier(20).label).toBe("Platinum");
  });

  // Bornes exactes : c'est là que se logent les erreurs de palier
  it("respecte les bornes de chaque palier", () => {
    expect(getCashbackTier(2).label).toBe("Standard");
    expect(getCashbackTier(3).label).toBe("Silver");
    expect(getCashbackTier(6).label).toBe("Gold");
    expect(getCashbackTier(9).label).toBe("Gold");
  });
});

describe("calcCashback", () => {
  it("Standard (0-2 missions) → 0,5 %", () => {
    expect(calcCashback(100, 0)).toBeCloseTo(0.5);
  });
  it("Silver (3-5 missions) → 0,75 %", () => {
    expect(calcCashback(100, 5)).toBeCloseTo(0.75);
  });
  it("Gold (6-9 missions) → 1 %", () => {
    expect(calcCashback(100, 6)).toBeCloseTo(1);
  });
  it("Platinum (10+ missions) → 1,5 %", () => {
    expect(calcCashback(100, 20)).toBeCloseTo(1.5);
  });
  it("cashback proportionnel au montant", () => {
    expect(calcCashback(200, 0)).toBeCloseTo(1);
    expect(calcCashback(500, 10)).toBeCloseTo(7.5);
  });
  it("un montant nul ne crédite rien", () => {
    expect(calcCashback(0, 20)).toBe(0);
  });
});

// ── Aller-retour de l'écran de réglages du backoffice ─────────────
// L'écran BO convertit le taux stocké (0,0075) en pourcentage affiché (0,75),
// puis reconvertit à l'enregistrement. Un arrondi à une seule décimale
// transformait silencieusement le palier silver en 0,8 % — et l'écrivait en base
// au premier « Sauvegarder ». Ces deux fonctions reproduisent exactement
// backoffice.jsx (lecture ligne ~1952, écriture ligne ~2146).
describe("réglages BO — conversion des taux de cashback", () => {
  const versAffichage    = (rate) => Math.round(rate * 10000) / 100;
  const versEnregistrement = (pct) => Number(pct) / 100;

  it("affiche chaque palier sans perte de précision", () => {
    expect(versAffichage(0.005)).toBe(0.5);
    expect(versAffichage(0.0075)).toBe(0.75);
    expect(versAffichage(0.01)).toBe(1);
    expect(versAffichage(0.015)).toBe(1.5);
  });

  it("un aller-retour ne modifie aucun taux de la grille", () => {
    for (const tier of CASHBACK_TIERS) {
      expect(versEnregistrement(versAffichage(tier.rate))).toBeCloseTo(tier.rate, 6);
    }
  });
});

// ── Calcul montant mission ────────────────────────────────────────
describe("Calcul montant total mission", () => {
  const calculMontant = (tarifHoraire, heures, nbJours = 1) =>
    tarifHoraire * heures * nbJours;

  it("mission simple 8h à 14€/h = 112€", () => {
    expect(calculMontant(14, 8)).toBe(112);
  });
  it("mission 3 jours × 8h × 12€ = 288€", () => {
    expect(calculMontant(12, 8, 3)).toBe(288);
  });
  it("mode urgence +2€/h", () => {
    const base = 14;
    const urgentSurcharge = 2;
    expect(calculMontant(base + urgentSurcharge, 4)).toBe(64);
  });
  it("le montant ne peut pas être négatif", () => {
    expect(calculMontant(0, 0)).toBeGreaterThanOrEqual(0);
  });
});
