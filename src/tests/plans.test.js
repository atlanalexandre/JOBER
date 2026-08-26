// Les prix des abonnements prestataire.
//
// Quatre écrans les écrivaient en dur : « Premium 29€ » alors qu'il est à
// 29,99, et « Elite 59€ » alors qu'il est à 79,99. Annoncer moins cher que ce
// qui sera prélevé est une pratique commerciale trompeuse — et personne ne s'en
// aperçoit tant qu'un abonné ne compare pas son relevé bancaire à l'écran.
//
// Ce test ne juge pas les tarifs : ce sont des décisions commerciales. Il
// vérifie qu'ils ne bougent pas SANS QU'ON LE VEUILLE, et qu'un seul endroit
// les porte.
import { describe, it, expect } from "vitest";
import { ABONNEMENTS_PRESTA, prixPlan } from "../constants/plans.js";

describe("les formules d'abonnement", () => {
  it("porte les trois formules, dans l'ordre croissant", () => {
    expect(ABONNEMENTS_PRESTA.map(p => p.id)).toEqual(["free", "premium", "elite"]);
    const prix = ABONNEMENTS_PRESTA.map(p => p.price);
    expect(prix).toEqual([...prix].sort((a, b) => a - b));
  });

  it("garde les tarifs décidés — les changer suppose de changer ce test", () => {
    const par = Object.fromEntries(ABONNEMENTS_PRESTA.map(p => [p.id, p.price]));
    expect(par.free).toBe(0);
    expect(par.premium).toBe(29.99);
    expect(par.elite).toBe(79.99);
  });

  it("formate un prix comme il s'affiche", () => {
    expect(prixPlan("premium")).toBe("29,99 €");
    expect(prixPlan("elite")).toBe("79,99 €");
    expect(prixPlan("free")).toBe("Gratuit");
  });

  it("rend une chaîne vide sur une formule inconnue, pas « undefined € »", () => {
    expect(prixPlan("platine")).toBe("");
  });

  it("donne à chaque formule de quoi s'afficher", () => {
    for (const p of ABONNEMENTS_PRESTA) {
      expect(typeof p.label, p.id).toBe("string");
      expect(Array.isArray(p.features), p.id).toBe(true);
      expect(p.features.length, p.id).toBeGreaterThan(0);
      expect(typeof p.missions, p.id).toBe("number");
    }
  });
});
