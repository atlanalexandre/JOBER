// Métier réglementé ajouté APRÈS l'activation (décision d'Alexandre, 29/09/2026).
//
// Le titre n'était exigé qu'à l'ouverture de l'accès : un prestataire activé pouvait
// ajouter « Agent de sécurité » et être proposé sans carte CNAPS. Désormais le compte
// reste ouvert pour ses autres métiers, et celui-là ne s'ouvre qu'une fois son titre
// vérifié. Au passage : le navigateur ne peut plus écrire dans `documents` — un
// prestataire y créait une pièce déjà « vérifiée ».
//
// Prérequis : migration 2026-09-29_titres_couverts_par_justificatif.sql.
import { test, expect, request } from "@playwright/test";
import { sql, appelApi, RECETTE_REF } from "./outils.js";
import { prestataireOperationnel, client, api, bo, anon } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const SECURITE = "Agent de sécurité";

async function ajouterMetier(p, metier, secteur) {
  await sql(`update auth.users set raw_user_meta_data = jsonb_set(raw_user_meta_data, '{metiers_list}',
    coalesce(raw_user_meta_data->'metiers_list', '[]'::jsonb) || '[{"sector":"${secteur}","metier":"${metier}","niveau":"Confirmé","experienceAns":2,"tarifNet":13,"certifs":""}]'::jsonb)
    where id = '${p.id}'`);
}

async function demandeOuverte(c, metier, secteur) {
  const id = crypto.randomUUID();
  const date = new Date(Date.now() + 5 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  await sql(`insert into missions (id, client_id, sector, metier, date, hours, heure_debut, tarif_horaire, ville, adresse, description, status)
    values ('${id}', '${c.id}', '${secteur}', '${metier}', '${date}', 4, '09:00', 15, 'Paris', '10 rue de Rivoli', 'Recette — métier réglementé', 'open')`);
  return id;
}

test("métier réglementé ajouté : fermé sans titre, ses autres métiers restent ouverts, ouvert une fois vérifié", async () => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 200)).toBe(200);
  const c = await client();
  await ajouterMetier(p, SECURITE, "divers");

  const securite = await demandeOuverte(c, SECURITE, "divers");
  const chambre = await demandeOuverte(c, "Femme/Valet de chambre", "hotellerie");

  // Sans titre : la demande n'est pas montrée, la candidature est refusée…
  const liste = await api("/api/missions", { action: "list_open" }, p.jeton);
  const ids = (liste.json?.demandes || []).map(d => d.id);
  expect(ids).not.toContain(securite);
  expect(ids, "ses autres métiers restent ouverts").toContain(chambre);
  const refus = await api("/api/missions", { action: "candidater", mission_id: securite }, p.jeton);
  expect(refus.statut).toBe(403);
  expect(refus.json?.error).toMatch(/métier réglementé/);

  // … le catalogue ne le propose pas pour ce métier, mais le garde pour les autres.
  const cat = await appelApi("/api/prestataires");
  const fiche = (cat.json?.prestataires || []).find(x => x.id === p.id);
  expect(fiche, "toujours au catalogue").toBeTruthy();
  expect(fiche.metiers_list.map(m => m.metier)).not.toContain(SECURITE);

  // Le back-office voit le titre à vérifier sur le justificatif.
  await sql(`insert into documents (prestataire_id, type, storage_path, verified) values ('${p.id}', 'diplomes', '${p.id}/diplomes', false)
    on conflict (prestataire_id, type) do update set verified = false`);
  const [doc] = await sql(`select id from documents where prestataire_id = '${p.id}' and type = 'diplomes'`);
  const docs = await bo("list_docs", { profileId: p.id });
  const diplome = (docs.json || []).find(d => d.type === "diplomes");
  expect(diplome.titres_a_verifier.map(t => t.titre)).toContain("Carte professionnelle CNAPS");

  // Vérifié : le titre est constaté, le métier s'ouvre.
  const ok = await bo("verify_doc", { profileId: p.id, docId: doc.id });
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [apres] = await sql(`select titres_couverts from documents where id = '${doc.id}'`);
  expect(apres.titres_couverts).toContain("Carte professionnelle CNAPS");
  const ouverte = await api("/api/missions", { action: "list_open" }, p.jeton);
  expect((ouverte.json?.demandes || []).map(d => d.id)).toContain(securite);
});

test("le navigateur ne peut plus créer ni modifier un document — ni se certifier lui-même", async () => {
  const p = await prestataireOperationnel();
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const ctx = await request.newContext({ proxy });
  const base = `https://${RECETTE_REF}.supabase.co/rest/v1/documents`;
  const h = { apikey: await anon(), Authorization: `Bearer ${p.jeton}`, Prefer: "return=minimal" };
  const cree = await ctx.post(base, { headers: h, data: { prestataire_id: p.id, type: "tva", verified: true, storage_path: `${p.id}/tva`, titres_couverts: ["Carte professionnelle CNAPS"] } });
  expect(cree.status(), "création refusée").toBeGreaterThanOrEqual(400);
  await ctx.patch(`${base}?prestataire_id=eq.${p.id}&type=eq.photo`, { headers: h, data: { type: "diplomes" } });
  await ctx.dispose();
  const lignes = await sql(`select type, verified from documents where prestataire_id = '${p.id}' and type in ('tva', 'diplomes')`);
  expect(lignes, "aucune pièce créée ni retypée").toEqual([]);
});
