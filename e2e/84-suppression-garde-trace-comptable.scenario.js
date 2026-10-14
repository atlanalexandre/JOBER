// Un compte supprimé ne fait plus disparaître ses pièces comptables (étude du
// 13/10/2026, migration 2026-10-14_conserver_creances_et_rechargements_apres_suppression).
//
// `creances_prestataires` et `wallet_topups` étaient en ON DELETE CASCADE sur le
// compte : la suppression effaçait les sommes dues (même réglées) et le registre
// des rechargements. La ligne reste désormais, sans lien vers le compte.
//
// Prérequis : la migration ci-dessus, passée sur la recette.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("suppression du compte : la créance réglée et le rechargement restent", async () => {
  const p = await prestataireOperationnel();
  const pi = `pi_recette_84_${p.id.slice(0, 8)}`;
  await sql(`insert into creances_prestataires (prestataire_id, montant_initial, montant_restant, motif, statut)
             values ('${p.id}', 30, 0, 'Scénario 84', 'eteinte')`);
  await sql(`insert into wallet_topups (stripe_payment_intent, user_id, amount) values ('${pi}', '${p.id}', 20)`);

  const r = await api("/api/support", { action: "delete_account" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [compte] = await sql(`select count(*)::int n from auth.users where id = '${p.id}'`);
  expect(compte.n, "le compte est bien supprimé").toBe(0);
  const creances = await sql(`select prestataire_id, montant_initial from creances_prestataires where motif = 'Scénario 84' and created_at > now() - interval '10 minutes'`);
  expect(creances.length, "la créance réglée reste, pièce comptable").toBeGreaterThan(0);
  expect(creances.every(c => c.prestataire_id === null), "sans lien vers le compte supprimé").toBe(true);
  const [recharge] = await sql(`select user_id, amount from wallet_topups where stripe_payment_intent = '${pi}'`);
  expect(recharge, "le rechargement reste au registre").toBeTruthy();
  expect(recharge.user_id).toBeNull();
});
