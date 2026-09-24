// Les tâches planifiées qui ne dépendent d'aucune action d'utilisateur.
//
//   · Le 1er du mois : remise à zéro des compteurs, abonnements expirés rétrogradés.
//   · Chaque matin  : l'attestation URSSAF, due 60 jours après l'immatriculation
//                     (à défaut de date connue, après l'inscription), et jamais
//                     moins de 15 jours après l'inscription.
//
// ⚠️ Ces tâches balayent TOUTE la base de recette : elles remettent aussi à zéro
// les compteurs des autres comptes d'essai. C'est sans conséquence en recette.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("changement de mois : les compteurs repartent de zéro", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set missions_completed_month = 3, trial_exhausted = true where id = '${p.id}'`);
  await sql(`update profiles set commandes_mois = 2 where id = '${c.id}'`);

  const t = await tachePlanifiee("/api/cron-reset-monthly");
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const [pp] = await sql(`select missions_completed_month, trial_exhausted from profiles where id = '${p.id}'`);
  const [cc] = await sql(`select commandes_mois from profiles where id = '${c.id}'`);
  expect(pp.missions_completed_month).toBe(0);
  expect(pp.trial_exhausted).toBe(false);
  expect(cc.commandes_mois).toBe(0);
});

test("changement de mois : un abonnement expiré repasse en gratuit, là où le quota est lu", async () => {
  const p = await prestataireOperationnel();
  // Abonnement Premium échu hier. `profiles.plan_abonnement` est la source que lit
  // le contrôle du quota (respond_mission) ; `user_metadata` n'en est qu'une copie.
  await sql(`update profiles set plan_abonnement = 'premium' where id = '${p.id}'`);
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data
      || jsonb_build_object('plan_abonnement', 'premium', 'subscription_end_date', (now() - interval '1 day')::text)
      where id = '${p.id}'`);

  const t = await tachePlanifiee("/api/cron-reset-monthly");
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const [etat] = await sql(`select p.plan_abonnement profil, u.raw_user_meta_data->>'plan_abonnement' jeton,
      u.raw_user_meta_data->>'subscription_end_date' fin
    from profiles p join auth.users u on u.id = p.id where p.id = '${p.id}'`);
  console.log("[11] abonnement expiré :", JSON.stringify(etat));
  expect(etat.jeton, "copie dans user_metadata").toBe("free");
  expect(etat.profil, "profiles.plan_abonnement — la valeur qui décide du quota").toBe("free");
});

/** Prestataire opérationnel SANS attestation URSSAF vérifiée, inscrit il y a `jours` jours. */
async function sansUrssaf(jours, siret = null) {
  const p = await prestataireOperationnel();
  await sql(`delete from documents where prestataire_id = '${p.id}' and type = 'urssaf'`);
  await sql(`update profiles set created_at = now() - interval '${jours} days', siret = ${siret ? `'${siret}'` : "null"} where id = '${p.id}'`);
  return p;
}
const acces = async (id) => (await sql(`select missions_enabled from profiles where id = '${id}'`))[0].missions_enabled;

test("URSSAF, date d'immatriculation inconnue : 60 jours depuis l'inscription", async () => {
  const dansLeDelai = await sansUrssaf(30);
  const horsDelai = await sansUrssaf(61);

  const t = await tachePlanifiee("/api/cron-reset-monthly?action=documents");
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  console.log("[11] URSSAF (date inconnue) :", t.texte.slice(0, 200));

  expect(await acces(dansLeDelai.id), "inscrit depuis 30 jours : encore dans le délai").toBe(true);
  expect(await acces(horsDelai.id), "inscrit depuis 61 jours sans attestation : accès fermé").toBe(false);
  const [n] = await sql(`select count(*)::int n from notifications where user_id = '${horsDelai.id}' and title = 'Accès aux prestations suspendu'`);
  expect(n.n, "le prestataire est prévenu").toBeGreaterThan(0);
});

test("URSSAF, entreprise immatriculée de longue date : 15 jours après l'inscription, pas 60", async () => {
  // SIRET public de La Poste, immatriculée en 1991 : l'attestation existe depuis
  // longtemps, les 60 jours d'attente du compte URSSAF ne la concernent pas.
  const SIRET = "35600000000048";
  const nouveau = await sansUrssaf(10, SIRET);
  const ancien = await sansUrssaf(16, SIRET);

  const t = await tachePlanifiee("/api/cron-reset-monthly?action=documents");
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  console.log("[11] URSSAF (immatriculation ancienne) :", t.texte.slice(0, 200));

  expect(await acces(nouveau.id), "inscrit depuis 10 jours : le délai minimal de 15 jours court").toBe(true);
  expect(await acces(ancien.id), "inscrit depuis 16 jours, immatriculé depuis 1991 : accès fermé").toBe(false);
});

test("URSSAF fournie et vérifiée : jamais de suspension", async () => {
  const p = await prestataireOperationnel();   // dossier complet, URSSAF vérifiée
  await sql(`update profiles set created_at = now() - interval '90 days' where id = '${p.id}'`);
  const t = await tachePlanifiee("/api/cron-reset-monthly?action=documents");
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  expect(await acces(p.id)).toBe(true);
});
