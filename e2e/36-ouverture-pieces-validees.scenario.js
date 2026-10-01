// Ouvrir l'accès aux prestations suppose les pièces obligatoires VALIDÉES
// (décision d'Alexandre du 30/09/2026).
//
// Le bouton du back-office vérifiait les mandats, le CV, le titre de séjour et la
// carte professionnelle — pas la pièce d'identité, l'assurance, le RIB, le KBIS, le
// justificatif de domicile ni la photo. Un clic trop rapide ouvrait l'accès à
// quelqu'un sans identité vérifiée ni assurance.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("sans pièce d'identité ni assurance validée, l'accès ne s'ouvre pas — et le back-office le dit avant le clic", async () => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, "dossier complet : ouverture acceptée").toBe(200);

  expect((await bo("disable_missions", { profileId: p.id })).statut).toBe(200);
  await sql(`delete from documents where prestataire_id = '${p.id}' and type = 'cni'`);
  await sql(`update documents set verified = false where prestataire_id = '${p.id}' and type = 'rc_pro'`);

  const refus = await bo("enable_missions", { profileId: p.id });
  expect(refus.statut, refus.texte.slice(0, 300)).toBe(409);
  expect(refus.json.error).toContain("Pièce d'identité (absente)");
  expect(refus.json.error).toContain("Attestation RC Pro (non vérifiée)");
  const [prof] = await sql(`select missions_enabled from profiles where id = '${p.id}'`);
  expect(prof.missions_enabled).toBe(false);

  const liste = await bo("list");
  const fiche = (liste.json?.profiles || liste.json?.users || liste.json || []).find?.(u => u.id === p.id);
  expect(fiche?.pieces_a_valider, "la fiche annonce les pièces avant le clic").toEqual(
    expect.arrayContaining(["Pièce d'identité (absente)", "Attestation RC Pro (non vérifiée)"]));

  // Dossier régularisé (pièce d'identité validée PUIS purgée, comme le prévoient
  // les CGPS 14.4) : l'accès s'ouvre.
  await sql(`insert into documents (prestataire_id, type, storage_path, verified, verified_at, purged_at)
             values ('${p.id}', 'cni', null, true, now() - interval '40 days', now() - interval '10 days')`);
  await sql(`update documents set verified = true where prestataire_id = '${p.id}' and type = 'rc_pro'`);
  const ouverture = await bo("enable_missions", { profileId: p.id });
  expect(ouverture.statut, ouverture.texte.slice(0, 300)).toBe(200);
});

test("métier principal réglementé absent de la liste des métiers : la carte professionnelle est exigée", async () => {
  // L'ouverture de l'accès ne lisait que `metiers_list` : un agent de sécurité dont
  // c'était le métier PRINCIPAL, non repris dans la liste, passait sans carte CNAPS
  // (relecture du 01/10/2026).
  const p = await prestataireOperationnel();
  expect((await bo("disable_missions", { profileId: p.id })).statut).toBe(200);
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"metier":"Agent de sécurité","secteur":"securite"}'::jsonb where id = '${p.id}'`);

  const refus = await bo("enable_missions", { profileId: p.id });
  expect(refus.statut, refus.texte.slice(0, 300)).toBe(409);
  expect(refus.json.error).toContain("CNAPS");
  const [prof] = await sql(`select missions_enabled from profiles where id = '${p.id}'`);
  expect(prof.missions_enabled).toBe(false);
});
