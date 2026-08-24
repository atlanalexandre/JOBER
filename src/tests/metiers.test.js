// Le catalogue des métiers.
//
// Ce qui est éprouvé ici n'est pas le contenu — les tarifs sont des décisions
// commerciales, pas des règles — mais la FORME : c'est elle qui casse en
// silence. Un métier ajouté sans tarif fait afficher « undefined € » ; un
// métier ajouté sans code ROME laisse un trou que personne ne verra jamais,
// puisque aucun écran ne l'affiche.
import { describe, it, expect } from "vitest";
import { METIERS_TARIFS, METIERS } from "../constants/data.js";

const TOUS = Object.entries(METIERS_TARIFS)
  .flatMap(([secteur, metiers]) => Object.entries(metiers).map(([nom, v]) => ({ secteur, nom, v })));

describe("le catalogue des métiers", () => {
  it("couvre les sept secteurs", () => {
    expect(Object.keys(METIERS_TARIFS).sort()).toEqual(
      ["commercial", "distribution", "divers", "hotellerie", "logistique", "proprete", "restauration"]
    );
  });

  it("donne à chaque métier une fourchette cohérente", () => {
    for (const { secteur, nom, v } of TOUS) {
      const ou = `${secteur} / ${nom}`;
      expect(typeof v.min, ou).toBe("number");
      expect(typeof v.max, ou).toBe("number");
      expect(typeof v.default, ou).toBe("number");
      expect(v.min, ou).toBeLessThanOrEqual(v.default);
      expect(v.default, ou).toBeLessThanOrEqual(v.max);
      // Aucun tarif ne peut être proposé sous le SMIC horaire brut.
      expect(v.min, ou).toBeGreaterThanOrEqual(11.5);
    }
  });

  it("rattache chaque métier à la nomenclature ROME, ou l'assume", () => {
    // `null` est autorisé — c'est un aveu d'ignorance assumé, préférable à un
    // code approximatif qui aurait l'air juste. Ce qui est interdit, c'est
    // d'OUBLIER le champ : un métier ajouté sans y penser passerait inaperçu,
    // puisque aucun écran n'affiche ce code.
    for (const { secteur, nom, v } of TOUS) {
      const ou = `${secteur} / ${nom}`;
      expect(v, ou).toHaveProperty("rome");
      if (v.rome !== null) {
        expect(v.rome, ou).toMatch(/^[A-N]\d{4}$/);
      }
    }
  });

  it("garde METIERS aligné sur METIERS_TARIFS", () => {
    // `METIERS` est dérivé, mais c'est lui que lisent les listes déroulantes :
    // une divergence donnerait un métier sélectionnable et sans tarif.
    for (const [secteur, metiers] of Object.entries(METIERS_TARIFS)) {
      expect(METIERS[secteur]).toEqual(Object.keys(metiers));
    }
  });

  it("n'a aucun doublon de nom à l'intérieur d'un secteur", () => {
    for (const [secteur, metiers] of Object.entries(METIERS_TARIFS)) {
      const noms = Object.keys(metiers);
      expect(new Set(noms).size, secteur).toBe(noms.length);
    }
  });
});
