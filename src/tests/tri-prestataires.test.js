// Le tri des prestataires par métier, secteur et localisation, dans le
// back-office.
//
// Deux pièges motivent ces tests :
//
//   1. `profiles.secteur` et `profiles.metier` ne sont que la PREMIÈRE entrée
//      de `metiers_list`. Filtrer dessus fait disparaître un prestataire dont
//      le métier cherché est le deuxième — et un prestataire en déclare
//      couramment plusieurs.
//   2. La recherche libre sur un libellé métier doit passer par
//      `correspondRecherche()` (CLAUDE.md §4) : vingt métiers portent une
//      terminaison entre parenthèses, et « femme de ménage » ne se trouve par
//      aucun `includes`.
import { describe, it, expect } from "vitest";
import { metiersDuProfil, correspondRecherche, cleVille } from "../constants/data.js";

const presta = (extra) => ({ role: "prestataire", ...extra });

describe("les métiers lus sur un profil", () => {
  it("rend toutes les entrées de metiers_list, pas seulement la première", () => {
    const p = presta({
      secteur: "proprete", metier: "Agent de propreté",
      metiers_list: [
        { sector: "proprete",   metier: "Agent de propreté" },
        { sector: "logistique", metier: "Cariste" },
      ],
    });
    expect(metiersDuProfil(p)).toEqual([
      { secteur: "proprete",   metier: "Agent de propreté" },
      { secteur: "logistique", metier: "Cariste" },
    ]);
  });

  it("accepte `sector` comme `secteur` : les deux orthographes coexistent en base", () => {
    expect(metiersDuProfil(presta({ metiers_list: [{ secteur: "hotellerie", metier: "Gouvernant(e) d'étage" }] })))
      .toEqual([{ secteur: "hotellerie", metier: "Gouvernant(e) d'étage" }]);
  });

  it("retombe sur secteur/metier pour un profil antérieur à metiers_list", () => {
    expect(metiersDuProfil(presta({ secteur: "restauration", metier: "Serveur(se)" })))
      .toEqual([{ secteur: "restauration", metier: "Serveur(se)" }]);
  });

  it("ne rend rien plutôt que des entrées vides", () => {
    expect(metiersDuProfil(presta({}))).toEqual([]);
    expect(metiersDuProfil(presta({ metiers_list: [] }))).toEqual([]);
    expect(metiersDuProfil(null)).toEqual([]);
  });

  it("tolère une liste de chaînes, forme héritée", () => {
    expect(metiersDuProfil(presta({ metiers_list: ["Cariste"] })))
      .toEqual([{ secteur: null, metier: "Cariste" }]);
  });
});

describe("le filtre par métier porte sur TOUS les métiers déclarés", () => {
  const parcours = [
    presta({ metiers_list: [{ sector: "proprete", metier: "Agent de propreté" }, { sector: "logistique", metier: "Cariste" }] }),
    presta({ metiers_list: [{ sector: "logistique", metier: "Préparateur de commandes" }] }),
  ];
  const parMetier = (m) => parcours.filter(p => metiersDuProfil(p).some(e => e.metier === m));
  const parSecteur = (s) => parcours.filter(p => metiersDuProfil(p).some(e => e.secteur === s));

  it("trouve un prestataire sur son second métier", () => {
    expect(parMetier("Cariste")).toHaveLength(1);
  });

  it("trouve les deux prestataires du secteur logistique", () => {
    expect(parSecteur("logistique")).toHaveLength(2);
  });

  it("ne trouve personne sur un métier que nul n'exerce", () => {
    expect(parMetier("Plombier")).toHaveLength(0);
  });
});

// Côté client, le catalogue range les prestataires par secteur. Les prédicats
// de `client-screens.jsx` reposent sur la même lecture : on les rejoue ici sur
// `metiersDuProfil`, sans importer l'écran entier.
describe("la visibilité d'un prestataire dans le catalogue client", () => {
  const polyvalent = {
    sector: "proprete", jobTitle: "Agent de propreté",
    metiers_list: [
      { sector: "proprete",   metier: "Agent de propreté" },
      { sector: "logistique", metier: "Cariste" },
    ],
  };
  const metiers = metiersDuProfil(polyvalent);
  const exerceSecteur = (id) => metiers.some(e => e.secteur === id);
  const metierDansSecteur = (id) => metiers.find(e => e.secteur === id)?.metier || null;

  it("le montre dans son premier secteur", () => {
    expect(exerceSecteur("proprete")).toBe(true);
  });

  it("le montre AUSSI dans son second secteur — c'est la réservation perdue", () => {
    expect(exerceSecteur("logistique")).toBe(true);
  });

  it("ne le montre pas dans un secteur où il ne s'est pas déclaré", () => {
    expect(exerceSecteur("restauration")).toBe(false);
  });

  it("affiche le métier du secteur consulté, pas le premier déclaré", () => {
    expect(metierDansSecteur("logistique")).toBe("Cariste");
    expect(metierDansSecteur("proprete")).toBe("Agent de propreté");
  });
});

describe("le regroupement des villes", () => {
  it("réunit les graphies d'une même ville", () => {
    expect(cleVille("Paris")).toBe(cleVille("PARIS"));
    expect(cleVille("Saint-Étienne")).toBe(cleVille("saint etienne"));
  });

  it("distingue deux villes différentes", () => {
    expect(cleVille("Lyon")).not.toBe(cleVille("Lille"));
  });

  it("rend une clé vide quand la ville manque", () => {
    expect(cleVille(null)).toBe("");
    expect(cleVille("")).toBe("");
  });
});

describe("la recherche libre sur un libellé métier", () => {
  // Ces cas sont précisément ceux qu'un `toLowerCase().includes()` rate.
  it("trouve « Gouvernant(e) d'étage » en cherchant « gouvernante »", () => {
    expect(correspondRecherche("Gouvernant(e) d'étage", "gouvernante")).toBe(true);
  });

  it("le trouve aussi au masculin", () => {
    expect(correspondRecherche("Gouvernant(e) d'étage", "gouvernant")).toBe(true);
  });

  it("trouve l'agent de propreté par l'appellation courante", () => {
    expect(correspondRecherche("Agent de propreté", "femme de ménage")).toBe(true);
  });

  it("ne rapproche pas un métier qui n'existe pas au catalogue", () => {
    expect(correspondRecherche("Agent de propreté", "plombier")).toBe(false);
  });
});
