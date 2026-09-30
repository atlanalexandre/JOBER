// Seule la photo validée par ALANE est montrée aux clients (décision d'Alexandre,
// 30/09/2026).
//
// Deux photos coexistaient : la photo de profil (`profiles.avatar_url`), changée à
// volonté et vérifiée par personne — c'était celle du catalogue —, et la pièce
// « photo », comparée à l'identité par le back-office. Le catalogue sert désormais
// la seconde seule, par URL signée ; l'écran de profil la dépose comme pièce, et une
// nouvelle photo repasse en vérification.
import { test, expect, request } from "@playwright/test";
import { deflateSync, crc32 } from "node:zlib";
import { randomBytes } from "node:crypto";
import { sql, RECETTE_REF, RECETTE_URL, BYPASS } from "./outils.js";
import { prestataireOperationnel, api, bo, anon } from "./fabrique.js";
import { connexion } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const SUPABASE = `https://${RECETTE_REF}.supabase.co`;

/** Un PNG de `cote` pixels, fabriqué ici : pas de fichier binaire dans le dépôt. */
function png(cote) {
  const bloc = (type, donnees) => {
    const t = Buffer.from(type, "ascii");
    const lg = Buffer.alloc(4); lg.writeUInt32BE(donnees.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, donnees])));
    return Buffer.concat([lg, t, donnees, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cote, 0); ihdr.writeUInt32BE(cote, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RVB
  // Du bruit, comme une vraie photo : une image unie se comprime sous 1 Ko, et
  // l'écran la refuse alors comme « fichier trop petit ».
  const brut = Buffer.concat(Array.from({ length: cote }, () =>
    Buffer.concat([Buffer.from([0]), randomBytes(cote * 3)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0)),
  ]);
}

async function photoAuCatalogue(id) {
  const c = await request.newContext({ proxy });
  const r = await c.get(`${RECETTE_URL}/api/prestataires`, { headers: { "x-vercel-protection-bypass": BYPASS } });
  expect(r.ok(), `catalogue : ${r.status()}`).toBeTruthy();
  const fiche = ((await r.json()).prestataires || []).find(p => p.id === id);
  await c.dispose();
  expect(fiche, "le prestataire est au catalogue").toBeTruthy();
  return fiche.photo_url;
}

test("catalogue : la photo validée, jamais la photo de profil ; une nouvelle photo repasse en vérification", async ({ page }) => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 200)).toBe(200);

  // Accord d'affichage donné, comme depuis « Modifier mon profil ».
  const c = await request.newContext({ proxy });
  const accord = await c.put(`${SUPABASE}/auth/v1/user`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${p.jeton}` },
    data: { data: { photo_public_auth: true } },
  });
  expect(accord.ok(), `accord d'affichage : ${accord.status()}`).toBeTruthy();

  // Une ancienne photo de profil, que personne n'a vérifiée : elle ne doit plus sortir.
  await sql(`update profiles set avatar_url = 'data:image/jpeg;base64,QUxBTkU=' where id = '${p.id}'`);
  expect(await photoAuCatalogue(p.id), "photo de profil non vérifiée : jamais montrée").toBeNull();

  // Une vraie photo, déposée comme pièce : en attente, elle n'est pas montrée non plus.
  const up = await c.post(`${SUPABASE}/storage/v1/object/Documents/${p.id}/photo`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${p.jeton}`, "x-upsert": "true", "Content-Type": "image/png" },
    data: png(500),
  });
  expect(up.ok(), `dépôt de la photo : ${up.status()} ${(await up.text()).slice(0, 200)}`).toBeTruthy();
  const enr = await api("/api/notify-doc", { docType: "photo", isRenewal: true }, p.jeton);
  expect(enr.statut, enr.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`select id, verified, storage_path from documents where prestataire_id = '${p.id}' and type = 'photo'`);
  expect(d.verified).toBe(false);
  expect(d.storage_path).toBe(`${p.id}/photo`);
  expect(await photoAuCatalogue(p.id), "photo en attente : pas encore montrée").toBeNull();

  // Validée par le back-office : c'est elle, et elle s'ouvre.
  const v = await bo("verify_doc", { profileId: p.id, docId: d.id });
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const url = await photoAuCatalogue(p.id);
  expect(url, "photo validée : montrée").toContain(`/storage/v1/object/sign/Documents/${p.id}/photo`);
  const img = await c.get(url);
  expect(img.status(), "l'URL signée s'ouvre").toBe(200);
  expect(img.headers()["content-type"]).toContain("image/");
  await c.dispose();

  // Nouvelle photo depuis « Modifier mon profil » : envoyée tout de suite, en JPEG,
  // et de nouveau en attente — le client ne voit plus rien tant qu'ALANE n'a pas revu.
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page.getByText(/Mon espace|Tableau de bord|Prestations/).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/provider/profile");
  await expect(page.getByText("✓ Photo vérifiée par ALANE")).toBeVisible({ timeout: 30_000 });
  // La demande de géolocalisation s'ouvre par-dessus l'écran : on la referme.
  const annuler = page.getByRole("button", { name: "Annuler" });
  if (await annuler.isVisible().catch(() => false)) await annuler.click();
  const champ = page.locator('input[type="file"][accept="image/*"]').first();
  // Trop petite : refusée. Ce contrôle ne s'exécutait jamais en production — la
  // politique de sécurité bloquait l'image `blob:` qu'il essayait de lire.
  await champ.setInputFiles({ name: "vignette.png", mimeType: "image/png", buffer: png(300) });
  await expect(page.getByText(/Photo trop petite \(300×300 px\)/)).toBeVisible({ timeout: 15_000 });
  await champ.setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png(600) });
  await expect(page.getByText(/Photo envoyée — visible des clients après vérification/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/En attente de vérification/)).toBeVisible();

  const [d2] = await sql(`select verified from documents where prestataire_id = '${p.id}' and type = 'photo'`);
  expect(d2.verified, "une nouvelle photo repasse en vérification").toBe(false);
  const [o] = await sql(`select metadata->>'mimetype' as type from storage.objects where bucket_id = 'Documents' and name = '${p.id}/photo'`);
  expect(o.type, "convertie en JPEG par l'écran").toBe("image/jpeg");
  expect(await photoAuCatalogue(p.id), "remplacée, pas encore revue : plus montrée").toBeNull();
  const [a] = await sql(`select avatar_url from profiles where id = '${p.id}'`);
  expect(a.avatar_url, "l'écran n'écrit plus la photo de profil").toBe("data:image/jpeg;base64,QUxBTkU=");
});
