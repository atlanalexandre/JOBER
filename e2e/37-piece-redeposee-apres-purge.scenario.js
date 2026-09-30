// Une pièce d'identité purgée (CGPS 14.4), puis redéposée : la nouvelle pièce doit
// à son tour être purgée.
//
// L'enregistrement remettait la ligne à « non vérifiée » mais gardait `purged_at`.
// Or la purge ne regarde que les lignes où `purged_at` est vide : la nouvelle pièce
// d'identité serait restée dans le stockage indéfiniment.
import { test, expect, request } from "@playwright/test";
import { sql, RECETTE_REF } from "./outils.js";
import { prestataireOperationnel, api, anon } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const SUPABASE = `https://${RECETTE_REF}.supabase.co`;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

test("une pièce d'identité redéposée après une purge redevient purgeable", async () => {
  const p = await prestataireOperationnel();
  await sql(`update documents set purged_at = now() - interval '5 days', storage_path = null
             where prestataire_id = '${p.id}' and type = 'cni'`);

  const c = await request.newContext({ proxy });
  const up = await c.post(`${SUPABASE}/storage/v1/object/Documents/${p.id}/cni`, {
    headers: { Authorization: `Bearer ${p.jeton}`, apikey: await anon(), "x-upsert": "true", "Content-Type": "application/pdf" },
    data: Buffer.from(`%PDF-1.4\n% piece de recette ${Date.now()}\n`),
  });
  expect(up.ok(), `dépôt : ${up.status()}`).toBeTruthy();
  await c.dispose();
  const r = await api("/api/notify-doc", { docType: "cni", isRenewal: true }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [d] = await sql(`select verified, purged_at, storage_path from documents where prestataire_id = '${p.id}' and type = 'cni'`);
  expect(d.verified, "une pièce neuve est à revérifier").toBe(false);
  expect(d.storage_path).toBe(`${p.id}/cni`);
  expect(d.purged_at, "la nouvelle pièce n'est pas « déjà purgée »").toBeNull();
});
