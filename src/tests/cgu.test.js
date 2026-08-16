// Les CGU ont vécu en deux exemplaires divergents — un dans `LegalScreen`, un
// écrit en dur dans la fenêtre d'acceptation d'`App.jsx` — et les deux
// annonçaient au client des règles d'argent qui n'étaient plus celles du code :
// des fonds « libérés après validation mutuelle » alors que le virement part
// automatiquement après 48 h, et des frais de service « fixes » alors qu'ils
// comportent une part de 2 %.
//
// Ces tests ne vérifient pas une mise en page : ils vérifient que le document
// que l'utilisateur accepte dit la même chose que ce que le serveur fait.

import { describe, it, expect } from "vitest";
import { CGU } from "../constants/cgu.js";
import { CGPS } from "../constants/cgps.js";
import { calculerFrais, FRAIS_PAR_DEFAUT } from "../../api/_montant.js";
import { DELAI_CONTESTATION_MS } from "../../api/_temps.js";

const texte = CGU.sections.map(s => `${s.title}\n${s.text}`).join("\n\n");

describe("CGU — source unique", () => {
  it("porte un titre, une date de version et des sections non vides", () => {
    expect(CGU.title).toBeTruthy();
    expect(CGU.maj).toBeTruthy();
    expect(CGU.sections.length).toBeGreaterThan(0);
    for (const s of CGU.sections) {
      expect(s.title).toBeTruthy();
      expect(s.text.length).toBeGreaterThan(80);
    }
  });

  it("se déclare subordonnées aux CGPS (hiérarchie de l'article 1.1)", () => {
    expect(texte).toMatch(/CGPS prévalent/);
  });
});

describe("CGU — cohérence avec le code", () => {
  it("ne promet plus de versement « après validation mutuelle »", () => {
    // Le versement est déclenché par l'expiration du délai, pas par un accord.
    expect(texte).not.toMatch(/validation mutuelle/);
  });

  it("annonce le même délai de réclamation que `api/_temps.js`", () => {
    const heures = DELAI_CONTESTATION_MS / 3600000;
    expect(texte).toContain(`${heures} heures`);
  });

  it("annonce les mêmes frais que `calculerFrais`", () => {
    // Part fixe : les trois montants de la grille doivent figurer au texte.
    for (const cle of ["single", "range", "urgent"]) {
      const montant = FRAIS_PAR_DEFAUT[cle].toFixed(2).replace(".", ",");
      expect(texte).toContain(`${montant} €`);
    }
    // Part proportionnelle : le pourcentage annoncé est celui appliqué.
    expect(texte).toContain(`${FRAIS_PAR_DEFAUT.pourcentage} %`);
    // Et il est bien appliqué : 100 € de prestation ponctuelle → 4,90 + 2,00.
    expect(calculerFrais("single", 100)).toBeCloseTo(
      FRAIS_PAR_DEFAUT.single + 100 * FRAIS_PAR_DEFAUT.pourcentage / 100, 2
    );
  });

  it("ne présente pas les frais comme fixes", () => {
    expect(texte).not.toMatch(/frais de service fixes/i);
  });

  it("rappelle qu'ALANE ne prélève aucune commission sur le tarif", () => {
    expect(texte).toMatch(/aucune commission/);
  });
});

describe("CGU et CGPS parlent des mêmes frais", () => {
  const cgps = CGPS.sections.map(s => s.text).join("\n");

  it("la grille des frais est identique dans les deux documents", () => {
    for (const cle of ["single", "range", "urgent"]) {
      const montant = FRAIS_PAR_DEFAUT[cle].toFixed(2).replace(".", ",");
      expect(cgps).toContain(`${montant} €`);
      expect(texte).toContain(`${montant} €`);
    }
  });

  it("le délai de réclamation est identique dans les deux documents", () => {
    const heures = DELAI_CONTESTATION_MS / 3600000;
    expect(cgps).toContain(`${heures} heures`);
    expect(texte).toContain(`${heures} heures`);
  });
});
