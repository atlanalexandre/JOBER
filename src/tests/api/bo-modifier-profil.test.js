// « Modifier profil » au back-office : chaque champ s'enregistre là où
// l'application le lit (20/10/2026). L'IBAN, l'adresse, le code postal, la
// société, le Kbis, la présentation et les besoins d'un client étaient
// envoyés, puis ignorés sans un mot.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { champsModifierProfil, validateIban } from "../../../api/bo-action.js";

describe("validateIban", () => {
  it("accepte un IBAN à la clé juste, espaces et minuscules compris", () => {
    expect(validateIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(validateIban("fr7630006000011234567890189")).toBe(true);
  });
  it("refuse une clé fausse ou un format impossible", () => {
    expect(validateIban("FR7630006000011234567890188")).toBe(false);
    expect(validateIban("1234")).toBe(false);
    expect(validateIban("")).toBe(false);
  });
});

describe("champsModifierProfil — chaque champ à sa place", () => {
  it("l'IBAN va dans profiles seul, nettoyé, et sort du jeton", () => {
    const r = champsModifierProfil({ rib: "fr76 3000 6000 0112 3456 7890 189" });
    expect(r.profil.rib).toBe("FR7630006000011234567890189");
    expect(r.meta.rib).toBe(null);
  });
  it("un IBAN faux est refusé, rien n'est écrit", () => {
    expect(champsModifierProfil({ rib: "FR7630006000011234567890188" }).erreur).toMatch(/IBAN invalide/);
  });
  it("adresse, code postal, ville, société et téléphone : colonne de profiles ET métadonnées", () => {
    const r = champsModifierProfil({ rue: "1 rue de la Paix", cp: "75002", ville: "Paris", societe_nom: "Exemple SAS", telephone: "0612345678" });
    expect(r.profil).toEqual({ adresse: "1 rue de la Paix", code_postal: "75002", ville: "Paris", societe_nom: "Exemple SAS", tel: "0612345678" });
    expect(r.meta).toEqual({ adresse: "1 rue de la Paix", code_postal: "75002", ville: "Paris", societe_nom: "Exemple SAS", telephone: "0612345678" });
  });
  it("Kbis et SIRET auto-entrepreneur : contrôlés", () => {
    expect(champsModifierProfil({ kbis: "12345678900011" }).erreur).toMatch(/SIRET de la société invalide/);
    expect(champsModifierProfil({ ae_siret: "73282932000074" }).meta.ae_siret).toBe("73282932000074");
  });
  it("présentation, type de compte, besoins d'un client : métadonnées", () => {
    const r = champsModifierProfil({ bio: " Bonjour ", type_compte: "professionnel", frequence_besoins: "hebdo", volume_horaire: "12" });
    expect(r.meta).toEqual({ bio: "Bonjour", type_compte: "professionnel", frequence_besoins: "hebdo", volume_horaire: 12 });
    expect(champsModifierProfil({ volume_horaire: "1,5" }).meta.volume_horaire, "virgule décimale").toBe(1.5);
    expect(champsModifierProfil({ type_compte: "autre" }).erreur).toMatch(/Type de compte/);
  });
  it("rend les clés traitées, alias compris, et laisse les autres au serveur", () => {
    const r = champsModifierProfil({ rue: "x", cp: "75001", secteur: "proprete" });
    expect([...r.consommes].sort()).toEqual(["cp", "rue"]);
  });
  it("un champ vidé est effacé (null), pas laissé tel quel", () => {
    expect(champsModifierProfil({ societe_nom: "" }).profil.societe_nom).toBe(null);
  });
});

describe("l'écran", () => {
  const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
  it("n'envoie que les champs modifiés, et un IBAN laissé vide ne l'efface pas", () => {
    expect(ecran).toMatch(/v !== editInitial\[k\] && !\(k === "rib" && !String\(v\)\.trim\(\)\)/);
  });
  it("ne propose plus de secteur « BTP », qui n'existe pas sur la plateforme", () => {
    expect(ecran).not.toMatch(/\["btp","BTP"\]/);
  });
});
