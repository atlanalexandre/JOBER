// CV obligatoire, et confronté aux métiers déclarés (décision d'Alexandre, 29/09/2026).
//
// Le CV était facultatif, et il vivait dans le jeton de connexion. Ce qui est
// éprouvé ici : l'accès aux prestations n'ouvre pas sans CV complet ; un CV sans
// expérience dans le métier ouvre, mais le back-office est averti ; le client lit
// le CV depuis `profiles`, plus depuis le jeton.
//
// Prérequis : migration 2026-09-29_cv_hors_du_jeton.sql.
import { test, expect } from "@playwright/test";
import { sql, appelApi } from "./outils.js";
import { prestataireOperationnel, bo, CV_RECETTE } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function fiche(id) {
  const r = await bo("list");
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  return r.json.find(x => x.id === id);
}

test("sans CV, l'accès aux prestations n'ouvre pas — et dit pourquoi", async () => {
  const p = await prestataireOperationnel({ cv: null });
  expect(p.ouverture.statut).toBe(409);
  expect(p.ouverture.json.error).toMatch(/CV du prestataire est incomplet/);
  const [l] = await sql(`select missions_enabled from profiles where id = '${p.id}'`);
  expect(l.missions_enabled).not.toBe(true);
  expect((await fiche(p.id)).cv_manques.length).toBeGreaterThan(0);
});

test("CV complet mais sans expérience du métier : ouvert, et le back-office est averti", async () => {
  const cv = { ...CV_RECETTE, titre: "Débutante motivée", experiences: [{ poste: "Caissière", entreprise: "Supérette", periode: "2024", desc: "" }] };
  const p = await prestataireOperationnel({ cv });
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 200)).toBe(200);
  const f = await fiche(p.id);
  expect(f.cv_manques).toEqual([]);
  expect(f.metiers_sans_experience).toEqual(["Femme/Valet de chambre"]);
});

test("CV avec l'expérience du métier : aucun avertissement, et le catalogue le montre", async () => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 200)).toBe(200);
  expect((await fiche(p.id)).metiers_sans_experience).toEqual([]);
  const r = await appelApi(`/api/prestataires?frais=${Date.now()}`);
  const d = r.json;
  const moi = (d.prestataires || []).find(x => x.id === p.id);
  expect(moi?.cv?.titre, "le CV vient de profiles.cv").toBe(CV_RECETTE.titre);
});
