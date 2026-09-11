import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { QUALIFICATIONS_OBLIGATOIRES, qualificationRequise, qualificationsPour } from "../../../api/_qualifications.js";
import { METIERS, docsRequisPour } from "../../constants/data.js";

// Le document « Diplômes & certifications » était facultatif pour TOUT LE
// MONDE. Un agent de sécurité pouvait donc être mis en relation avec un client
// sans avoir jamais produit sa carte professionnelle — alors qu'exercer sans
// carte est puni de trois ans d'emprisonnement et 45 000 € d'amende.

const TOUS_LES_METIERS = Object.values(METIERS).flat();

describe("la table des qualifications", () => {
  // Une entrée qui ne correspond à aucun métier du catalogue n'exige rien de
  // personne : elle donne l'illusion d'une règle appliquée.
  it("ne vise que des métiers qui existent", () => {
    const inconnus = Object.keys(QUALIFICATIONS_OBLIGATOIRES).filter(m => !TOUS_LES_METIERS.includes(m));
    expect(inconnus, `libellés sans métier correspondant : ${inconnus.join(", ")}`).toEqual([]);
  });

  // « Fournissez un diplôme » fait envoyer n'importe quoi ; « fournissez votre
  // carte professionnelle CNAPS » fait envoyer la carte.
  it("nomme le titre attendu et le texte qui l'impose", () => {
    for (const [metier, q] of Object.entries(QUALIFICATIONS_OBLIGATOIRES)) {
      expect(q.titre, metier).toBeTruthy();
      expect(q.texte, metier).toBeTruthy();
    }
  });

  it("couvre la sécurité privée, où l'exercice sans carte est un délit", () => {
    for (const m of ["Agent de sécurité", "Agent de sûreté", "Agent cynophile de sécurité",
                     "Agent de sécurité incendie SSIAP 1", "Agent de sécurité incendie SSIAP 2",
                     "Agent de prévention des pertes (magasin)"]) {
      expect(qualificationRequise(m), m).toBeTruthy();
      expect(qualificationRequise(m).titre, m).toMatch(/CNAPS|SSIAP/);
    }
  });

  // Servir, vendre ou réchauffer n'est pas préparer : le décret vise la
  // PRÉPARATION de produits frais. Étendre l'exigence aux vendeurs écarterait
  // des prestataires sans fondement — et une exigence sans fondement finit par
  // être contournée, ce qui décrédibilise les autres.
  it("ne vise pas ceux qui vendent sans préparer", () => {
    for (const m of ["Vendeur en boulangerie-pâtisserie", "Employé de rayon", "Employé libre-service",
                     "Fromager en GMS", "Serveur(se)", "Plongeur", "Runner", "Commis de cuisine"]) {
      expect(qualificationRequise(m), m).toBeNull();
    }
  });

  // Le CACES est une recommandation de la CNAM, pas une obligation légale :
  // c'est l'autorisation de conduite de l'employeur qui est obligatoire, et un
  // indépendant n'en a pas.
  it("n'invente pas d'obligation pour les caristes", () => {
    for (const m of TOUS_LES_METIERS.filter(x => x.startsWith("Cariste"))) {
      expect(qualificationRequise(m), m).toBeNull();
    }
  });
});

describe("qualificationsPour()", () => {
  it("dédoublonne par titre", () => {
    const q = qualificationsPour(["Pâtissier", "Chef pâtissier", "Commis pâtissier"]);
    expect(q).toHaveLength(1);
    expect(q[0].metiers).toHaveLength(3);
  });

  it("accepte aussi bien des libellés que des entrées de metiers_list", () => {
    expect(qualificationsPour([{ metier: "Chauffeur VTC" }])).toHaveLength(1);
    expect(qualificationsPour(["Chauffeur VTC"])).toHaveLength(1);
  });

  it("ne s'effondre pas sur une entrée vide ou absente", () => {
    for (const v of [undefined, null, [], [null], [{}], "pas un tableau"]) {
      expect(qualificationsPour(v)).toEqual([]);
    }
  });
});

describe("les documents réclamés au prestataire", () => {
  it("laissent le justificatif facultatif pour un métier non réglementé", () => {
    const d = docsRequisPour("Française", ["Agent de propreté"]).find(x => x.id === "diplomes");
    expect(d.required).toBe(false);
  });

  it("le rendent obligatoire dès qu'un métier réglementé est déclaré", () => {
    const d = docsRequisPour("Française", ["Agent de propreté", "Agent de sécurité"]).find(x => x.id === "diplomes");
    expect(d.required).toBe(true);
    expect(d.label).toBe("Carte professionnelle CNAPS");
    expect(d.info).toMatch(/L612-20/);
  });

  it("nomment tous les titres quand il y en a plusieurs", () => {
    const d = docsRequisPour("Française", ["Coiffeur(se) à domicile", "Chauffeur VTC"]).find(x => x.id === "diplomes");
    expect(d.label).toBe("Titres professionnels");
    expect(d.info).toMatch(/CAP coiffure/);
    expect(d.info).toMatch(/Carte professionnelle VTC/);
  });

  // La règle ajoutée ne doit pas déranger celle qui existait.
  it("n'abîment pas la règle du titre de séjour", () => {
    const horsUE = docsRequisPour("Hors UE", ["Agent de sécurité"]);
    expect(horsUE.find(d => d.id === "titre_sejour")?.required).toBe(true);
    expect(docsRequisPour("Française", ["Agent de sécurité"]).find(d => d.id === "titre_sejour")).toBeUndefined();
  });
});

// La règle ne vaut que si elle est appliquée LÀ OÙ ELLE ENGAGE : à l'ouverture
// de l'accès aux prestations. Un contrôle qui ne vit que dans le navigateur ne
// protège personne.
describe("l'application côté serveur", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");

  it("refuse d'ouvrir l'accès sans justificatif vérifié", () => {
    expect(bo).toContain("qualificationsPour");
    expect(bo).toContain("type=eq.diplomes");
    expect(bo).toContain("justificatif.verified !== true");
  });

  it("n'ouvre pas l'accès au bénéfice du doute si la vérification échoue", () => {
    const bloc = bo.slice(bo.indexOf("qualificationsPour(uqData"));
    expect(bloc.slice(0, bloc.indexOf("majProfil"))).toContain("503");
  });
});
