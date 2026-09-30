import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { docsRequisPour, photoCompleteLeDossier } from "../../../api/_documents.js";

// 30/09/2026 : une photo enregistrée depuis « Modifier mon profil » va dans
// `profiles.avatar_url` sans passer par le dépôt de pièces. Si c'était la
// dernière pièce manquante, l'alerte « dossier complet » ne partait pas.

const REQUIS = docsRequisPour("France", ["Femme/Valet de chambre"]).filter(d => d.required);
const AUTRES = REQUIS.map(d => d.id).filter(id => id !== "photo");
const PROFIL = { role: "prestataire", status: "approved", missions_enabled: false, avatar_url: "data:image/jpeg;base64,xx" };

describe("photo de profil, dernière pièce du dossier", () => {
  it("toutes les autres pièces déposées : le dossier est complet", () => {
    expect(photoCompleteLeDossier(PROFIL, REQUIS, AUTRES)).toBe(true);
  });
  it("une autre pièce manque encore : non", () => {
    expect(photoCompleteLeDossier(PROFIL, REQUIS, AUTRES.slice(1))).toBe(false);
  });
  it("photo déjà déposée comme pièce : le dossier était déjà complet, pas de nouvelle alerte", () => {
    expect(photoCompleteLeDossier(PROFIL, REQUIS, [...AUTRES, "photo"])).toBe(false);
  });
  it("pas de photo en base : l'écran ne suffit pas", () => {
    expect(photoCompleteLeDossier({ ...PROFIL, avatar_url: null }, REQUIS, AUTRES)).toBe(false);
  });
  it("compte déjà activé, pas encore validé, ou client : non", () => {
    expect(photoCompleteLeDossier({ ...PROFIL, missions_enabled: true }, REQUIS, AUTRES)).toBe(false);
    expect(photoCompleteLeDossier({ ...PROFIL, status: "pending" }, REQUIS, AUTRES)).toBe(false);
    expect(photoCompleteLeDossier({ ...PROFIL, role: "client" }, REQUIS, AUTRES)).toBe(false);
  });
  it("la route s'en sert, et envoie le même courriel que le dépôt d'une pièce", () => {
    const src = readFileSync(new URL("../../../api/notify-doc.js", import.meta.url), "utf8");
    expect(src).toContain("if (!photoCompleteLeDossier(profil, requis, dl.map(l => l.type))) {");
    expect(src.match(/await alerterDossierComplet\(/g)).toHaveLength(2);
  });
});
