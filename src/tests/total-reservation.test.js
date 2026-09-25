import { describe, it, expect } from "vitest";
import { formatMontant, calcCashback } from "../constants/plans.js";

// Le total de la réservation était calculé, puis immédiatement transformé en
// texte français, puis relu comme un nombre. JavaScript ne lit pas la virgule
// décimale : le client était débité de 66,00 € là où l'écran annonçait 66,10 €,
// et le cashback s'affichait « +NaN € ».
describe("un montant français relu comme un nombre", () => {
  const texte = (v) => formatMontant(v).replace(" €", "");

  it("Number() sur un montant formaté ne donne PAS un nombre", () => {
    expect(Number(texte(66.10))).toBeNaN();
  });

  it("parseFloat() tronque tout ce qui suit la virgule", () => {
    expect(parseFloat(texte(66.10))).toBe(66);
    expect(parseFloat(texte(66.90))).toBe(66);   // 90 centimes perdus
    expect(parseFloat(texte(19.99))).toBe(19);
  });

  it("le nombre gardé en nombre traverse le formatage sans perte", () => {
    for (const v of [66.10, 66.90, 19.99, 1234.50, 4.90]) {
      const arrondi = Math.round(v * 100) / 100;
      expect(arrondi).toBe(v);
      expect(formatMontant(arrondi)).toBe(`${v.toFixed(2).replace(".", ",")} €`);
      expect(calcCashback(arrondi, 1)).not.toBeNaN();
    }
  });
});

// « 20.2 € » s'affichait partout où un montant lu de la base (colonne numeric,
// donc parfois un texte) était écrit tel quel. Tout montant affiché passe par
// formatMontant, qui doit donc accepter ce que la base renvoie.
describe("formatMontant écrit un montant à la française", () => {
  it("deux décimales et la virgule", () => {
    expect(formatMontant(20.2)).toBe("20,20 €");
    expect(formatMontant(11.5)).toBe("11,50 €");
    expect(formatMontant(29.99)).toBe("29,99 €");
  });
  it("accepte un montant lu en texte depuis la base", () => {
    expect(formatMontant("20.2")).toBe("20,20 €");
    expect(formatMontant(0)).toBe("0,00 €");
  });
  it("ce qui n'est pas un montant ne s'affiche pas « NaN € »", () => {
    expect(formatMontant(null)).toBe("—");
    expect(formatMontant(undefined)).toBe("—");
    expect(formatMontant("abc")).toBe("—");
  });
});
