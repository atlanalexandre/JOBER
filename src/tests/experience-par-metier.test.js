import { describe, it, expect } from "vitest";
import { niveauGlobal, experienceGlobale, NIVEAUX } from "../constants/data.js";

// L'inscription demandait « votre niveau général » et « vos années
// d'expérience » une seule fois pour tout le compte, alors qu'un prestataire
// déclare plusieurs métiers. Huit ans en propreté et six mois en rayon devaient
// tenir dans un seul chiffre : forcément faux pour l'un des deux, et c'est sur
// ce chiffre que le client choisit.
const CAS_REEL = [
  { metier: "Agent de propreté",  niveau: "Expert",   experienceAns: 8 },
  { metier: "Employé de rayon",   niveau: "Débutant", experienceAns: 0 },
];

describe("niveau et expérience dérivés des métiers", () => {
  it("retient le niveau le plus élevé", () => {
    expect(niveauGlobal(CAS_REEL)).toBe("Expert");
    expect(niveauGlobal([{ niveau: "Débutant" }, { niveau: "Confirmé" }])).toBe("Confirmé");
    expect(niveauGlobal([{ niveau: "Débutant" }])).toBe("Débutant");
  });

  it("retient la plus longue expérience", () => {
    expect(experienceGlobale(CAS_REEL)).toBe(8);
    expect(experienceGlobale([{ experienceAns: 2 }, { experienceAns: 11 }])).toBe(11);
  });

  // « Moins d'un an » se déclare avec la valeur 0 : elle ne doit pas être
  // confondue avec une absence de réponse.
  it("traite zéro année comme une réponse, pas comme un vide", () => {
    expect(experienceGlobale([{ experienceAns: 0 }])).toBe(0);
    expect(experienceGlobale([{ experienceAns: 0 }, { experienceAns: 3 }])).toBe(3);
  });

  it("ne se casse pas sur une liste absente ou incohérente", () => {
    for (const v of [null, undefined, [], "métiers", 42]) {
      expect(NIVEAUX).toContain(niveauGlobal(v));
      expect(experienceGlobale(v)).toBe(0);
    }
    expect(experienceGlobale([{}, { experienceAns: "quatre" }])).toBe(0);
    expect(niveauGlobal([{ niveau: "Champion" }])).toBe("Débutant");
  });

  // Une valeur dérivée ne peut pas contredire le détail dont elle est tirée :
  // c'est tout l'intérêt de ne plus la saisir séparément.
  it("ne dépasse jamais ce qui a été déclaré", () => {
    const declarees = CAS_REEL.map(m => m.experienceAns);
    expect(declarees).toContain(experienceGlobale(CAS_REEL));
    expect(CAS_REEL.map(m => m.niveau)).toContain(niveauGlobal(CAS_REEL));
  });
});
