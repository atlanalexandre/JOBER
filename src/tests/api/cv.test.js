import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { manquesCv, cvRempli, metiersSansExperience, nettoyerCv, CV_LIMITES } from "../../../api/_cv.js";

// CV obligatoire, et confronté aux métiers déclarés (décision d'Alexandre, 29/09/2026).

const CV = {
  titre: "Livreur — événementiel", accroche: "Trois ans de livraison de plateaux repas et cocktails.",
  experiences: [{ poste: "Livreur", entreprise: "Traiteur Dupont", periode: "2022 – 2025", desc: "Livraison et mise en place" }],
  formations: [],
};

describe("manquesCv()", () => {
  it("un CV vide ou absent n'est pas rempli", () => {
    expect(cvRempli(null)).toBe(false);
    expect(cvRempli({})).toBe(false);
    expect(manquesCv({})).toHaveLength(3);
  });

  it("exige un titre, une accroche et une expérience OU une formation", () => {
    expect(manquesCv(CV)).toEqual([]);
    expect(manquesCv({ ...CV, titre: "  " })).toEqual(["un titre professionnel"]);
    expect(manquesCv({ ...CV, accroche: "Motivé" })).toEqual(["une accroche de quelques mots"]);
    // Un débutant : pas d'expérience, une formation — c'est un CV.
    expect(manquesCv({ ...CV, experiences: [], formations: [{ diplome: "CAP Cuisine" }] })).toEqual([]);
    expect(manquesCv({ ...CV, experiences: [{ poste: "", entreprise: "", desc: "" }] })).toEqual(["au moins une expérience ou une formation"]);
  });
});

describe("metiersSansExperience()", () => {
  it("rapproche le poste du libellé du métier, variantes comprises", () => {
    expect(metiersSansExperience(CV, [{ metier: "Coursier / Livreur" }, { metier: "Chauffeur livreur" }])).toEqual([]);
    const livraison = { ...CV, experiences: [{ poste: "Coursier", desc: "livraisons à vélo" }] };
    expect(metiersSansExperience(livraison, ["Coursier / Livreur"])).toEqual([]);
    expect(metiersSansExperience({ experiences: [{ poste: "Serveuse" }] }, ["Serveur(se)"])).toEqual([]);
    expect(metiersSansExperience({ experiences: [{ poste: "Femme de chambre" }] }, ["Femme/Valet de chambre"])).toEqual([]);
  });

  it("signale le métier sans aucune expérience correspondante", () => {
    expect(metiersSansExperience(CV, ["Coursier / Livreur", "Agent de sécurité"])).toEqual(["Agent de sécurité"]);
    expect(metiersSansExperience({ experiences: [] }, ["Cariste"])).toEqual(["Cariste"]);
  });

  it("ne crie pas sur un mot générique : « agent » ne prouve rien", () => {
    // « Agent immobilier » ne vaut pas expérience d'agent de sécurité.
    expect(metiersSansExperience({ experiences: [{ poste: "Agent immobilier" }] }, ["Agent de sécurité"])).toEqual(["Agent de sécurité"]);
  });
});

describe("nettoyerCv()", () => {
  it("borne les longueurs et retire les lignes vides", () => {
    const c = nettoyerCv({ titre: "x".repeat(500), experiences: [{ poste: "" }, { poste: "Livreur" }], formations: "pas une liste" });
    expect(c.titre).toHaveLength(CV_LIMITES.titre);
    expect(c.experiences).toEqual([{ poste: "Livreur", entreprise: "", periode: "", desc: "" }]);
    expect(c.formations).toEqual([]);
  });

  it("un CV au maximum tient sous la limite de la base", () => {
    const long = (n) => "é".repeat(n);
    const max = nettoyerCv({
      titre: long(999), accroche: long(9999), permis: long(999),
      experiences: Array(20).fill({ poste: long(999), entreprise: long(999), periode: long(999), desc: long(9999) }),
      formations: Array(20).fill({ diplome: long(999), etablissement: long(999), annee: long(99) }),
    });
    expect(Buffer.byteLength(JSON.stringify(max))).toBeLessThanOrEqual(12000);
  });
});

describe("le CV ne vit plus dans le jeton", () => {
  it("l'écran de profil l'écrit dans profiles et le retire de user_metadata", () => {
    const src = readFileSync(new URL("../../components/presta-screens.jsx", import.meta.url), "utf8");
    expect(src).toContain(".update({ cv: nettoyerCv(meta?.cv) })");
    expect(src).toMatch(/cv: null,\n\s+};/);
  });

  it("l'ouverture de l'accès aux prestations l'exige", () => {
    const src = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(src).toContain("const manques = manquesCv(p0.cv || uqData.user_metadata?.cv);");
  });
});
