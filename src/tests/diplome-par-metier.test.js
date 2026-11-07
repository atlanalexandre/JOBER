// Diplôme obligatoire ou non, dit au prestataire quand il choisit un métier —
// à l'inscription comme dans son profil (demande d'Alexandre du 04/11/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { qualificationRequise } from "../constants/data.js";

const lire = (f) => readFileSync(new URL(`./../components/${f}`, import.meta.url), "utf8");

describe("le diplôme exigé, au choix du métier", () => {
  it("l'inscription et le profil affichent le même encart", () => {
    expect(lire("auth.jsx")).toContain("<InfoQualificationMetier metier={newMetier.metier} />");
    expect(lire("presta-screens.jsx")).toContain("<InfoQualificationMetier metier={newMetier.metier} />");
  });
  it("la liste des métiers ajoutés à l'inscription porte la pastille", () => {
    expect(lire("auth.jsx")).toContain("<PastilleQualification metier={m.metier} />");
  });
  it("l'encart dit les deux réponses, et ne recopie pas la règle", () => {
    const encart = lire("qualification-metier.jsx");
    expect(encart).toContain("Aucun diplôme obligatoire pour ce métier");
    expect(encart).toContain("Diplôme ou titre obligatoire pour ce métier");
    expect(encart).toContain('import { qualificationRequise, noteMetier } from "../constants/data.js"');
  });
  it("la règle elle-même : réglementé pour l'agent de sécurité, libre pour l'agent de propreté", () => {
    expect(qualificationRequise("Agent de sécurité")).not.toBeNull();
    expect(qualificationRequise("Agent de propreté")).toBeNull();
  });
  it("un métier avec une note ne se dit pas « aucun texte n'impose » sans nuance (05/11/2026)", () => {
    const encart = lire("qualification-metier.jsx");
    expect(encart).toContain("Pas de diplôme obligatoire dans le cas général");
    expect(encart).toMatch(/n \? "✅ Pas de diplôme obligatoire dans le cas général" : "✅ Aucun diplôme obligatoire pour ce métier"/);
  });
  it("avec une note, le texte renvoie à la note sans redire « aucun texte n'impose » (07/11/2026)", () => {
    const encart = lire("qualification-metier.jsx");
    const avecNote = [...encart.matchAll(/\{?n\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\}?/g)].find(m => m[1].includes("atout"));
    expect(avecNote, "branche « avec note » introuvable").not.toBeNull();
    expect(avecNote[1]).toContain("lisez la note ci-dessous");
    expect(avecNote[1]).not.toMatch(/aucun texte/i);
  });
});
