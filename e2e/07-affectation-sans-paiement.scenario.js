// Une prestation ne doit être proposée à un prestataire qu'une fois PAYÉE.
//
// /api/missions « assign_after_payment » reçoit du navigateur l'identifiant du
// paiement et le délai de réponse du prestataire. Ces scénarios jouent le rôle d'un
// client qui appelle cette fonction directement, sans passer par le paiement.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, payerPrestation } from "./fabrique.js";
import { connexion, reserverJusquauPaiement } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

async function missionImpayee(page) {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  const [m] = await sql(`select id from missions where client_id = '${c.id}' order by created_at desc limit 1`);
  return { p, c, missionId: m.id };
}

const etat = async (id) => (await sql(`select status, prestataire_id, stripe_payment_intent, acceptance_deadline from missions where id = '${id}'`))[0];

test("sans aucun paiement, la prestation n'est pas proposée au prestataire", async ({ page }) => {
  const { p, c, missionId } = await missionImpayee(page);
  const r = await api("/api/missions", { action: "assign_after_payment", mission_id: missionId, prestataire_id: p.id }, c.jeton);
  const m = await etat(missionId);
  console.log("[07] sans paiement :", r.statut, r.texte.slice(0, 150), JSON.stringify(m));
  expect(m.prestataire_id, "prestataire affecté sans paiement").toBeNull();
});

test("avec un identifiant de paiement inventé, la prestation n'est pas proposée", async ({ page }) => {
  const { p, c, missionId } = await missionImpayee(page);
  const r = await api("/api/missions", { action: "assign_after_payment", mission_id: missionId, prestataire_id: p.id, stripe_payment_intent: "pi_invente_000000000000" }, c.jeton);
  const m = await etat(missionId);
  console.log("[07] paiement inventé :", r.statut, r.texte.slice(0, 150), JSON.stringify(m));
  expect(m.prestataire_id, "prestataire affecté avec un paiement inventé").toBeNull();
});

test("le délai de réponse du prestataire n'est pas fixé par le navigateur", async ({ page }) => {
  const { p, c, missionId } = await missionImpayee(page);
  const dansUnAn = new Date(Date.now() + 365 * 864e5).toISOString();
  await api("/api/missions", { action: "assign_after_payment", mission_id: missionId, prestataire_id: p.id, acceptance_deadline: dansUnAn, stripe_payment_intent: "pi_invente_000000000001" }, c.jeton);
  const m = await etat(missionId);
  console.log("[07] délai :", JSON.stringify(m));
  if (m.acceptance_deadline) {
    const heures = (new Date(m.acceptance_deadline) - Date.now()) / 36e5;
    expect(heures, "délai de réponse raisonnable (≤ 48 h)").toBeLessThanOrEqual(48);
  }
});

test("un identifiant de portefeuille n'est plus accepté", async ({ page }) => {
  const { p, c, missionId } = await missionImpayee(page);
  const r = await api("/api/missions", { action: "assign_after_payment", mission_id: missionId, prestataire_id: p.id, stripe_payment_intent: "wallet_" + missionId }, c.jeton);
  const m = await etat(missionId);
  console.log("[07] wallet :", r.statut, r.texte.slice(0, 150), JSON.stringify(m));
  expect(m.prestataire_id, "prestataire affecté sur un identifiant wallet_").toBeNull();
  expect(m.stripe_payment_intent).toBeNull();
});

test("payée pour de vrai, le délai de réponse reste celui du serveur, même si le navigateur annonce un an", async ({ page }) => {
  const { p, c, missionId } = await missionImpayee(page);
  const [{ montant_total }] = await sql(`select montant_total from missions where id = '${missionId}'`);
  const r = await payerPrestation({ jetonClient: c.jeton, missionId, montant: Number(montant_total), prestataireId: p.id, delaiMinutes: 365 * 24 * 60 });
  expect(r.etape, `paiement : ${JSON.stringify(r)}`).toBe("ok");
  const m = await etat(missionId);
  console.log("[07] délai après vrai paiement :", JSON.stringify(m));
  expect(m.prestataire_id).toBe(p.id);
  const heures = (new Date(m.acceptance_deadline) - Date.now()) / 36e5;
  // Prestation dans cinq jours, ni urgente ni du jour : quatre heures.
  expect(heures).toBeGreaterThan(3.5);
  expect(heures, "délai de réponse raisonnable (≤ 48 h)").toBeLessThanOrEqual(4);
});

test("le paiement d'une autre prestation ne vaut pas pour celle-ci, et n'est pas remboursé", async ({ page, context }) => {
  const { p, c, missionId: payee } = await missionImpayee(page);
  const [{ montant_total }] = await sql(`select montant_total from missions where id = '${payee}'`);
  const r = await payerPrestation({ jetonClient: c.jeton, missionId: payee, montant: Number(montant_total), prestataireId: p.id });
  expect(r.etape, `paiement : ${JSON.stringify(r)}`).toBe("ok");

  // Seconde réservation du même client, jamais payée : il présente le paiement de la première.
  // Nouvel onglet (même session) : l'onglet du premier paiement garde l'écran du secteur.
  const onglet = await context.newPage();
  await onglet.goto("/dashboard");
  await reserverJusquauPaiement(onglet);
  const [autre] = await sql(`select id from missions where client_id = '${c.id}' and id <> '${payee}' order by created_at desc limit 1`);
  const r2 = await api("/api/missions", { action: "assign_after_payment", mission_id: autre.id, prestataire_id: p.id, stripe_payment_intent: r.paymentIntent }, c.jeton);
  const m = await etat(autre.id);
  console.log("[07] paiement d'une autre prestation :", r2.statut, r2.texte.slice(0, 150), JSON.stringify(m));
  expect(m.prestataire_id, "prestataire affecté avec le paiement d'une autre prestation").toBeNull();
  const premiere = await etat(payee);
  expect(premiere.status, "la prestation réellement payée n'est pas annulée").toBe("pending_acceptance");
});
