// Mot de passe oublié : une demande au plus toutes les dix minutes (audit « sécurité », 01/10/2026).
//
// N'importe qui pouvait faire envoyer des e-mails en rafale à une adresse, depuis le
// domaine d'ALANE. Vérifie aussi, sur le vrai Supabase, que noter l'heure de la demande
// dans `app_metadata` ne détruit rien d'autre (le fournisseur de connexion, le rôle).
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, api } from "./fabrique.js";

test.describe.configure({ timeout: 120_000 });

test("deux demandes rapprochées : la seconde n'écrit et n'envoie rien", async () => {
  const c = await client();
  const [avant] = await sql(`select raw_app_meta_data m from auth.users where id = '${c.id}'`);
  const r1 = await api("/api/forgot-password", { email: c.email }, null);
  expect(r1.statut, r1.texte.slice(0, 200)).toBe(200);
  const [apres1] = await sql(`select raw_app_meta_data m, updated_at from auth.users where id = '${c.id}'`);
  expect(apres1.m.reinit_demandee_at, "demande notée").toBeTruthy();
  for (const [k, v] of Object.entries(avant.m || {})) expect(apres1.m[k], `app_metadata.${k} conservé`).toEqual(v);

  const r2 = await api("/api/forgot-password", { email: c.email }, null);
  expect(r2.statut, r2.texte.slice(0, 200)).toBe(200);
  const [apres2] = await sql(`select raw_app_meta_data m, updated_at from auth.users where id = '${c.id}'`);
  expect(apres2.m.reinit_demandee_at, "pas de seconde demande").toBe(apres1.m.reinit_demandee_at);
  expect(String(apres2.updated_at)).toBe(String(apres1.updated_at));
});

test("une adresse inconnue reçoit la même réponse", async () => {
  const r = await api("/api/forgot-password", { email: `inconnu.${Date.now()}@recette.alane.test` }, null);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
});
