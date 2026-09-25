// Back-office : l'examen des documents d'un prestataire, par l'écran.
//
// Le prestataire dépose ses pièces exactement comme son espace le fait (fichier dans
// le bucket `Documents`, ligne dans `documents`, avec SON jeton). L'administration les
// ouvre, en valide, en refuse : on contrôle en base ce que chaque bouton a vraiment
// enregistré, et chez le prestataire ce qu'il en apprend.
import { test, expect, request } from "@playwright/test";
import { sql, RECETTE_REF } from "./outils.js";
import { inscrire, anon, bo, api } from "./fabrique.js";
import { connexionBO, ficheBO } from "./parcours.js";

test.describe.configure({ timeout: 180_000 });

const SUPABASE = `https://${RECETTE_REF}.supabase.co`;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

/**
 * Dépôt d'une pièce, par les deux mêmes appels que l'espace prestataire : le fichier
 * dans le bucket `Documents` (jeton du prestataire), puis son enregistrement par le
 * serveur (`enregistrerDocument()` de src/lib/documents.js).
 */
async function deposer(p, type) {
  const c = await request.newContext({ proxy });
  const chemin = `${p.id}/${type}`;
  const up = await c.post(`${SUPABASE}/storage/v1/object/Documents/${chemin}`, {
    headers: { Authorization: `Bearer ${p.jeton}`, apikey: await anon(), "x-upsert": "true", "Content-Type": "application/pdf" },
    data: Buffer.from(`%PDF-1.4\n% piece de recette ${Date.now()}\n`),
  });
  expect(up.ok(), `dépôt du fichier ${type} : ${up.status()} ${(await up.text()).slice(0, 200)}`).toBeTruthy();
  await c.dispose();
  const r = await api("/api/notify-doc", { docType: type, isRenewal: false }, p.jeton);
  expect(r.statut, `enregistrement du document ${type} : ${r.texte.slice(0, 200)}`).toBe(200);
  expect(r.json?.enregistre).toBe(true);
}

const doc = async (id, type) =>
  (await sql(`select verified, verified_at is not null valide_le, expires_at::text from documents where prestataire_id = '${id}' and type = '${type}'`))[0];

/** Ligne d'un document dans la fiche du back-office. */
const ligneDoc = (page, libelle) =>
  page.locator("div").filter({ has: page.getByText(libelle, { exact: true }) })
    .filter({ has: page.getByTitle("Refuser ce document") }).last();

async function prestataireAvecPieces(types) {
  const p = await inscrire({ role: "prestataire", prenom: "Dora", metadonnees: { telephone: "0698765432", metier: "Femme/Valet de chambre", secteur: "hotellerie" } });
  const a = await bo("approve", { profileId: p.id });
  expect(a.statut, a.texte.slice(0, 200)).toBe(200);
  for (const t of types) await deposer(p, t);
  return p;
}

async function ouvrirFiche(page, p) {
  await connexionBO(page);
  await ficheBO(page, p.email, "✅ Approuvés");
  await page.getByRole("button", { name: "▼ Détails" }).first().click();
  await expect(page.getByText(/📂 Documents \(0\/\d+ validés\)/)).toBeVisible({ timeout: 20_000 });
}

test("le prestataire ne peut pas valider lui-même ses propres pièces", async () => {
  const p = await prestataireAvecPieces(["cni"]);
  const c = await request.newContext({ proxy });
  const r = await c.patch(`${SUPABASE}/rest/v1/documents?prestataire_id=eq.${p.id}&type=eq.cni`, {
    headers: { Authorization: `Bearer ${p.jeton}`, apikey: await anon(), Prefer: "return=minimal" },
    data: { verified: true },
  });
  await c.dispose();
  console.log("[14] auto-validation :", r.status());
  expect((await doc(p.id, "cni")).verified, "la base refuse qu'un prestataire certifie sa propre pièce").toBe(false);
});

test("valider une pièce : la base l'enregistre, avec sa date de validité quand elle en a une", async ({ page }) => {
  const p = await prestataireAvecPieces(["cni", "urssaf"]);
  await ouvrirFiche(page, p);

  // Pièce d'identité : pas de date de validité demandée.
  await ligneDoc(page, "Pièce d'identité").getByRole("button", { name: "✓", exact: true }).click();
  await expect.poll(async () => (await doc(p.id, "cni")).verified, { timeout: 20_000 }).toBe(true);
  expect((await doc(p.id, "cni")).valide_le, "verified_at date la vérification (CGPS art. 14.4)").toBe(true);

  // Attestation URSSAF : la date de fin de validité est demandée, et enregistrée.
  await ligneDoc(page, "Attestation URSSAF").getByRole("button", { name: "✓", exact: true }).click();
  await expect(page.getByText("Date de fin de validité de ce document", { exact: false })).toBeVisible();
  await page.locator('input[type="text"]').last().fill("2027-03-31");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect.poll(async () => (await doc(p.id, "urssaf")).verified, { timeout: 20_000 }).toBe(true);
  expect((await doc(p.id, "urssaf")).expires_at).toBe("2027-03-31");
  await expect(page.getByText(/📂 Documents \(2\/2 validés\)/)).toBeVisible();

  const [{ n }] = await sql(`select count(*)::int n from bo_logs where action = 'verify_doc' and target_id = '${p.id}'`);
  expect(n, "chaque validation est journalisée").toBe(2);
});

test("valider une attestation qui ne porte pas de date : « laissez vide » doit valider", async ({ page }) => {
  // La fenêtre dit « Laissez vide si le document n'en porte pas ».
  const p = await prestataireAvecPieces(["urssaf"]);
  await ouvrirFiche(page, p);
  await ligneDoc(page, "Attestation URSSAF").getByRole("button", { name: "✓", exact: true }).click();
  await expect(page.getByText("Laissez vide si le document n'en porte pas", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect.poll(async () => (await doc(p.id, "urssaf")).verified, { timeout: 15_000 }).toBe(true);
  expect((await doc(p.id, "urssaf")).expires_at, "aucune date inventée").toBeNull();
});

test("refuser une pièce : elle est retirée (ligne et fichier) et le prestataire sait pourquoi", async ({ page }) => {
  const p = await prestataireAvecPieces(["kbis"]);
  await ouvrirFiche(page, p);
  await ligneDoc(page, "KBIS / SIRET").getByTitle("Refuser ce document").click();
  await expect(page.getByText("Motif du refus pour « KBIS / SIRET »", { exact: false })).toBeVisible();
  await page.locator('input[type="text"]').last().fill("Extrait illisible, merci d'envoyer un Kbis de moins de 3 mois");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();

  await expect.poll(async () => (await doc(p.id, "kbis")) ?? null, { timeout: 20_000 }).toBeNull();
  const [{ fichiers }] = await sql(`select count(*)::int fichiers from storage.objects where bucket_id = 'Documents' and name = '${p.id}/kbis'`);
  expect(fichiers, "le fichier est supprimé du bucket Documents").toBe(0);
  const [notif] = await sql(`select title, body from notifications where user_id = '${p.id}' and title like 'Document à renvoyer%' order by created_at desc limit 1`);
  expect(notif?.title).toBe("Document à renvoyer : KBIS / SIRET");
  expect(notif?.body).toContain("Extrait illisible");
});

test("un document remplacé repasse en attente : il n'hérite ni de la validation ni de la date de l'ancien", async () => {
  const p = await prestataireAvecPieces(["urssaf"]);
  const [{ id }] = await sql(`select id from documents where prestataire_id = '${p.id}' and type = 'urssaf'`);
  const v = await bo("verify_doc", { profileId: p.id, docId: id, expiresAt: "2027-03-31" });
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  expect((await doc(p.id, "urssaf")).verified).toBe(true);

  await deposer(p, "urssaf");
  const apres = await doc(p.id, "urssaf");
  expect(apres.verified, "la nouvelle pièce n'a été vue par personne").toBe(false);
  expect(apres.valide_le).toBe(false);
  expect(apres.expires_at).toBeNull();
});

test("un enregistrement sans fichier déposé est refusé", async () => {
  const p = await prestataireAvecPieces([]);
  const r = await api("/api/notify-doc", { docType: "kbis" }, p.jeton);
  expect(r.statut).toBe(404);
  expect(await doc(p.id, "kbis")).toBeUndefined();
});

test("un refus sans motif n'est pas envoyé", async ({ page }) => {
  const p = await prestataireAvecPieces(["kbis"]);
  await ouvrirFiche(page, p);
  await ligneDoc(page, "KBIS / SIRET").getByTitle("Refuser ce document").click();
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await page.waitForTimeout(2_000);
  expect((await doc(p.id, "kbis"))?.verified, "la pièce est toujours là, en attente").toBe(false);
});

test("un fichier validé, écrasé directement dans le bucket, repasse en attente", async () => {
  // Sans passer par l'application : le stockage seul, avec le jeton du prestataire.
  const p = await prestataireAvecPieces(["rc_pro"]);
  const [{ id }] = await sql(`select id from documents where prestataire_id = '${p.id}' and type = 'rc_pro'`);
  const v = await bo("verify_doc", { profileId: p.id, docId: id, expiresAt: "2027-06-30" });
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  expect((await doc(p.id, "rc_pro")).verified).toBe(true);

  const c = await request.newContext({ proxy });
  const r = await c.post(`${SUPABASE}/storage/v1/object/Documents/${p.id}/rc_pro`, {
    headers: { Authorization: `Bearer ${p.jeton}`, apikey: await anon(), "x-upsert": "true", "Content-Type": "application/pdf" },
    data: Buffer.from("%PDF-1.4\n% autre fichier\n"),
  });
  await c.dispose();
  expect(r.ok(), `remplacement du fichier : ${r.status()}`).toBeTruthy();
  const apres = await doc(p.id, "rc_pro");
  expect(apres.verified, "un fichier que personne n'a vu n'est pas vérifié").toBe(false);
  expect(apres.expires_at).toBeNull();
});
