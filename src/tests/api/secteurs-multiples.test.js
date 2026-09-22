// Un secteur fermé ne doit fermer que celui-là.
//
// `user_metadata.secteur` ne porte que le PREMIER métier déclaré. Tant que le
// catalogue et le comptage s'en contentaient, deux choses arrivaient en
// silence :
//
//   • fermer la propreté faisait disparaître du catalogue ENTIER un
//     prestataire inscrit en propreté puis en logistique — logistique ouverte
//     comprise ;
//   • un prestataire polyvalent ne comptait que pour un seul secteur, ce qui
//     retardait l'ouverture automatique des autres.
import { describe, it, expect } from "vitest";
import { secteursDuProfil, etatDesSecteurs } from "../../../api/_secteurs.js";

describe("les secteurs lus sur un profil", () => {
  it("rend tous les secteurs de metiers_list, sans doublon", () => {
    const meta = { secteur: "proprete", metiers_list: [
      { sector: "proprete",   metier: "Agent de propreté" },
      { sector: "logistique", metier: "Cariste" },
      { sector: "logistique", metier: "Préparateur de commandes" },
    ]};
    expect(secteursDuProfil(meta).sort()).toEqual(["logistique", "proprete"]);
  });

  it("accepte `secteur` comme `sector` dans les entrées", () => {
    expect(secteursDuProfil({ metiers_list: [{ secteur: "hotellerie", metier: "Gouvernant(e) d'étage" }] }))
      .toEqual(["hotellerie"]);
  });

  it("retombe sur le champ unique pour un profil sans metiers_list", () => {
    expect(secteursDuProfil({ secteur: "restauration" })).toEqual(["restauration"]);
    expect(secteursDuProfil({ sector: "commercial" })).toEqual(["commercial"]);
  });

  it("rend une liste vide plutôt que des entrées vides", () => {
    expect(secteursDuProfil({})).toEqual([]);
    expect(secteursDuProfil(null)).toEqual([]);
    expect(secteursDuProfil({ metiers_list: ["Cariste"] })).toEqual([]);
  });
});

describe("le comptage des effectifs par secteur", () => {
  // Reproduit le comptage de `etatSecteursAvecCache` sur trois profils.
  const compter = (metas) => {
    const counts = {};
    for (const m of metas) for (const s of secteursDuProfil(m)) counts[s] = (counts[s] || 0) + 1;
    return counts;
  };

  it("compte un prestataire dans chacun de ses secteurs", () => {
    expect(compter([
      { metiers_list: [{ sector: "proprete" }, { sector: "logistique" }] },
      { metiers_list: [{ sector: "logistique" }] },
      { secteur: "proprete" },
    ])).toEqual({ proprete: 2, logistique: 2 });
  });

  it("ne le compte qu'une fois par secteur, même avec deux métiers dedans", () => {
    expect(compter([
      { metiers_list: [{ sector: "logistique", metier: "Cariste" }, { sector: "logistique", metier: "Manutentionnaire" }] },
    ])).toEqual({ logistique: 1 });
  });
});

describe("la visibilité au catalogue quand un secteur est fermé", () => {
  const reglages = { seuil: 1, fermes: ["proprete"], forces: [], lu: true };
  const etats = etatDesSecteurs({ proprete: 10, logistique: 10 }, reglages);
  const ouvert = (s) => !s || etats[s]?.open !== false;

  it("ferme bien le secteur désigné", () => {
    expect(etats.proprete.open).toBe(false);
    expect(etats.logistique.open).toBe(true);
  });

  it("garde un prestataire dont UN secteur reste ouvert", () => {
    const secteurs = secteursDuProfil({ secteur: "proprete", metiers_list: [
      { sector: "proprete", metier: "Agent de propreté" },
      { sector: "logistique", metier: "Cariste" },
    ]});
    expect(secteurs.filter(ouvert)).toEqual(["logistique"]);
  });

  it("écarte celui dont tous les secteurs sont fermés", () => {
    const secteurs = secteursDuProfil({ metiers_list: [{ sector: "proprete", metier: "Agent de propreté" }] });
    expect(secteurs.filter(ouvert)).toEqual([]);
  });

  it("coupe de sa liste les métiers du secteur fermé", () => {
    const liste = [
      { sector: "proprete",   metier: "Agent de propreté" },
      { sector: "logistique", metier: "Cariste" },
    ];
    const coupee = liste.filter(m => ouvert(m.sector || m.secteur));
    // Sans cette coupe, le catalogue l'afficherait dans la propreté fermée,
    // puisqu'il range les prestataires d'après `metiers_list`.
    expect(coupee).toEqual([{ sector: "logistique", metier: "Cariste" }]);
  });
});
