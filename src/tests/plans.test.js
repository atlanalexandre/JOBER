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
import { ABONNEMENTS_PRESTA, prixPlan, formatE, formatMontant, CASHBACK_TIERS, tauxCashback } from "../constants/plans.js";

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

  it("distingue un taux horaire d'un montant", () => {
    // Le simulateur de charges affichait « Prestation 4h — 39,00 €/h » : le
    // total de quatre heures présenté comme un tarif horaire. Et « 9,75 €/h/h »,
    // parce que `formatE` porte déjà le « /h » et qu'on le rajoutait.
    expect(formatE(9.75)).toBe("9,75 €/h");
    expect(formatMontant(39)).toBe("39,00 €");
    expect(formatMontant(312)).toBe("312,00 €");
    // Un montant ne porte JAMAIS de « /h ».
    expect(formatMontant(39)).not.toContain("/h");
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

describe("le taux de cashback affiché", () => {
  it("dit le taux réel, pas un arrondi à l'entier", () => {
    // Six écrans faisaient `(rate * 100).toFixed(0)` : trois paliers sur quatre
    // étaient annoncés faux, et toujours EN TROP. Un client qui lit « 1 % » et
    // touche 0,50 € pour 100 € dépensés a été trompé sur une promesse chiffrée.
    const par = Object.fromEntries(CASHBACK_TIERS.map(t => [t.id, tauxCashback(t)]));
    expect(par.standard).toBe("0,5 %");
    expect(par.silver).toBe("0,75 %");
    expect(par.gold).toBe("1 %");
    expect(par.platinum).toBe("1,5 %");
  });

  it("n'annonce jamais plus que ce qui sera versé", () => {
    // La borne qui compte : l'affiché ne doit pas dépasser le réel.
    for (const t of CASHBACK_TIERS) {
      const affiche = parseFloat(tauxCashback(t).replace(",", ".").replace(" %", ""));
      expect(affiche).toBeLessThanOrEqual(t.rate * 100 + 1e-9);
    }
  });

  it("les paliers montent avec le nombre de prestations", () => {
    const taux = CASHBACK_TIERS.map(t => t.rate);
    expect(taux).toEqual([...taux].sort((a, b) => a - b));
  });
});
