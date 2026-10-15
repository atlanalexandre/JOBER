// Liste anti-recréation (décision D4 d'Alexandre, 14/10/2026).
//
// Un compte supprimé ou exclu laisse ses empreintes ; un nouveau compte qui en
// porte une n'a pas droit au quota gratuit. Deux trous éprouvés ici, sur la
// tâche des deux heures qui compare désormais tous les comptes :
//   - l'IBAN n'était comparé qu'à l'inscription et à la validation, AVANT que le
//     prestataire le saisisse : il ne reconnaissait personne ;
//   - le téléphone était haché tel que saisi : « +33 6… » et « 06… » donnaient
//     deux empreintes différentes.
// La remise à zéro du 1er du mois (qui écarte désormais ces comptes) et la
// résiliation à l'échéance sont éprouvées par `src/tests/api/liste-noire.test.js`.
//
// Seule compte une ligne inscrite AVANT la création du compte (relecture du
// 15/10/2026) : une ligne postérieure est celle de sa propre suppression, manquée.
// Les lignes du premier test sont donc datées de la veille, comme celles d'un compte
// réellement supprimé avant d'être recréé.
import { test, expect } from "@playwright/test";
import { sql, ibanTest } from "./outils.js";
import { prestataireOperationnel, tachePlanifiee } from "./fabrique.js";
import { hashPii } from "../api/_email.js";

test.describe.configure({ timeout: 240_000 });

test("IBAN saisi après l'inscription, téléphone écrit autrement : le compte recréé est reconnu", async () => {
  const parIban = await prestataireOperationnel();
  const parTel = await prestataireOperationnel();
  const iban = ibanTest();
  await sql(`update profiles set rib = '${iban}', trial_exhausted = false where id = '${parIban.id}'`);
  await sql(`update profiles set trial_exhausted = false where id = '${parTel.id}'`);
  const [{ tel }] = await sql(`select raw_user_meta_data->>'telephone' as tel from auth.users where id = '${parTel.id}'`);
  expect(tel, "téléphone de test au format 06…").toMatch(/^0\d{9}$/);

  // Deux comptes supprimés auparavant : l'un avec cet IBAN, l'autre avec ce
  // numéro écrit à l'international — l'empreinte d'avant, prise telle quelle.
  const inscrites = await sql(`insert into account_blacklist (iban_hash, telephone_hash, reason, created_at) values
    ('${hashPii(iban)}', null, 'Scénario 94 — IBAN', now() - interval '1 day'),
    (null, '${hashPii(`+33${tel.slice(1)}`)}', 'Scénario 94 — téléphone', now() - interval '1 day') returning id`);
  try {
    const t = await tachePlanifiee();
    expect(t.statut, t.texte.slice(0, 200)).toBe(200);
    const lignes = await sql(`select id, trial_exhausted from profiles where id in ('${parIban.id}', '${parTel.id}')`);
    const etat = Object.fromEntries(lignes.map(l => [l.id, l.trial_exhausted]));
    expect(etat[parIban.id], "reconnu par l'IBAN saisi après l'inscription").toBe(true);
    expect(etat[parTel.id], "reconnu par le téléphone écrit autrement").toBe(true);
  } finally {
    await sql(`delete from account_blacklist where id in (${inscrites.map(l => `'${l.id}'`).join(",")})`);
  }
});

test("suppression manquée : la ligne inscrite après la création du compte ne le prive pas du quota gratuit", async () => {
  // La suppression inscrit l'empreinte, puis peut échouer — « votre compte n'a pas été
  // supprimé » : le compte reste, et ne doit pas être traité en compte recréé.
  const p = await prestataireOperationnel();
  await sql(`update profiles set trial_exhausted = false where id = '${p.id}'`);
  const [{ email }] = await sql(`select email from auth.users where id = '${p.id}'`);
  const inscrites = await sql(`insert into account_blacklist (email_hash, reason) values
    ('${hashPii(email)}', 'Scénario 94 — suppression manquée') returning id`);
  try {
    const t = await tachePlanifiee();
    expect(t.statut, t.texte.slice(0, 200)).toBe(200);
    const [l] = await sql(`select trial_exhausted from profiles where id = '${p.id}'`);
    expect(l.trial_exhausted, "le compte resté ouvert garde son quota gratuit").toBe(false);
  } finally {
    await sql(`delete from account_blacklist where id in (${inscrites.map(l => `'${l.id}'`).join(",")})`);
  }
});
