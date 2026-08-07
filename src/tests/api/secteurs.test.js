import { describe, it, expect } from "vitest";
import { etatSecteur, etatDesSecteurs, SECTEURS_CONNUS, SEUIL_PAR_DEFAUT } from "../../../api/_secteurs.js";

// ═══════════════════════════════════════════════════════════════════════════
// Ouverture et fermeture des secteurs
// ═══════════════════════════════════════════════════════════════════════════
//
// Un seuil identique existait, à 30, et n'a jamais fonctionné : l'action qui
// comptait les prestataires répondait 401. Le jour où ce défaut a été corrigé,
// appliquer le seuil aurait fermé TOUS les secteurs d'un coup.
//
// C'est exactement ce que ces tests vérifient : que la règle fait ce qu'on
// croit, y compris dans le cas qui a fait retirer la précédente.

const R = (seuil = 20, fermes = [], forces = []) => ({ seuil, fermes, forces });

describe("seuil d'ouverture automatique", () => {
  it("ferme un secteur sous le seuil", () => {
    const e = etatSecteur("proprete", 3, R(20));
    expect(e.open).toBe(false);
    expect(e.sous_seuil).toBe(true);
  });

  it("ouvre un secteur qui atteint exactement le seuil", () => {
    expect(etatSecteur("proprete", 20, R(20)).open).toBe(true);
  });

  it("ouvre un secteur au-dessus du seuil", () => {
    expect(etatSecteur("proprete", 47, R(20)).open).toBe(true);
  });

  it("un seuil à zéro ouvre tout — c'est la sortie de secours", () => {
    const e = etatSecteur("proprete", 0, R(0));
    expect(e.open).toBe(true);
    expect(e.sous_seuil).toBe(false);
  });
});

describe("fermeture d'autorité", () => {
  it("ferme un secteur même largement au-dessus du seuil", () => {
    const e = etatSecteur("proprete", 500, R(20, ["proprete"]));
    expect(e.open).toBe(false);
    expect(e.disabled).toBe(true);
  });

  it("l'emporte sur l'ouverture forcée — entre deux réglages contradictoires, le plus prudent", () => {
    const e = etatSecteur("proprete", 0, R(20, ["proprete"], ["proprete"]));
    expect(e.open).toBe(false);
    expect(e.disabled).toBe(true);
    expect(e.force_ouvert).toBe(false);
  });
});

describe("ouverture forcée", () => {
  // Sans elle, aucune plateforme ne démarre : il faudrait vingt prestataires
  // pour accepter la première commande, et une première commande pour attirer
  // des prestataires.
  it("ouvre un secteur à zéro prestataire", () => {
    const e = etatSecteur("hotellerie", 0, R(20, [], ["hotellerie"]));
    expect(e.open).toBe(true);
    expect(e.force_ouvert).toBe(true);
  });

  it("ne déborde pas sur les autres secteurs", () => {
    const etats = etatDesSecteurs({ hotellerie: 1 }, R(20, [], ["hotellerie"]));
    expect(etats.hotellerie.open).toBe(true);
    expect(etats.proprete.open).toBe(false);
    expect(etats.logistique.open).toBe(false);
  });

  it("signale quand même que le secteur est sous le seuil", () => {
    const e = etatSecteur("hotellerie", 1, R(20, [], ["hotellerie"]));
    expect(e.open).toBe(true);
    expect(e.sous_seuil).toBe(true); // le backoffice doit pouvoir l'afficher
  });
});

describe("état de l'ensemble des secteurs", () => {
  it("couvre tous les secteurs connus, même absents du décompte", () => {
    const etats = etatDesSecteurs({}, R(20));
    expect(Object.keys(etats).sort()).toEqual([...SECTEURS_CONNUS].sort());
    expect(Object.values(etats).every(e => e.count === 0 && !e.open)).toBe(true);
  });

  it("reproduit la situation qui a fait retirer l'ancien seuil", () => {
    // 1 prestataire en hôtellerie, 0 ailleurs, seuil à 20 : tout ferme.
    const etats = etatDesSecteurs({ hotellerie: 1 }, R(20));
    expect(Object.values(etats).some(e => e.open)).toBe(false);
  });
});

describe("valeur par défaut", () => {
  it("le seuil par défaut est explicite", () => {
    expect(SEUIL_PAR_DEFAUT).toBe(20);
  });
});
