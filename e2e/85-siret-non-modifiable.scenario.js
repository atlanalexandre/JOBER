// Le SIRET ne se réécrit pas depuis le navigateur (étude d'octobre 2026, domaine
// « sécurité »).
//
// Le droit de modifier `profiles.siret` était resté ouvert aux comptes connectés. Or ce
// numéro décide de l'échéance de l'attestation URSSAF (`etatRegularisation()` : date
// d'immatriculation lue dans SIRENE + 60 jours) et figure sur les factures émises au nom
// du prestataire. En le remplaçant par celui d'une entreprise créée la veille, un
// prestataire repoussait indéfiniment l'attestation exigée par l'obligation de vigilance.
// Personne ne l'écrit depuis l'application : la base le pose à l'inscription
// (`handle_new_user`), le navigateur ne le renvoyait que par redondance.
import { test, expect, request } from "@playwright/test";
import { RECETTE_REF, sql } from "./outils.js";
import { prestataireOperationnel, client, anon } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function patchProfil(jeton, id, corps) {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const c = await request.newContext({ proxy });
  const cle = await anon();
  const r = await c.patch(`https://${RECETTE_REF}.supabase.co/rest/v1/profiles?id=eq.${id}`, {
    headers: { apikey: cle, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    data: corps,
  });
  return r.status();
}

test("le prestataire ne peut pas changer son SIRET ; la ville reste modifiable", async () => {
  const p = await prestataireOperationnel();
  await sql(`update profiles set siret = '12345678900010' where id = '${p.id}'`);

  expect(await patchProfil(p.jeton, p.id, { siret: "98765432100019" }), "SIRET réécrit depuis le navigateur").toBe(403);
  const [l] = await sql(`select siret from profiles where id = '${p.id}'`);
  expect(l.siret).toBe("12345678900010");

  expect(await patchProfil(p.jeton, p.id, { ville: "Lyon" }), "la ville reste modifiable").toBe(204);
});

test("le client ne peut pas non plus changer le sien", async () => {
  const c = await client();
  expect(await patchProfil(c.jeton, c.id, { siret: "98765432100019" })).toBe(403);
});
