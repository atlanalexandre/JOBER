// Réservation et paiement : le client réserve par l'écran, paie par carte de test.
import { test, expect, request } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, payerPrestation } from "./fabrique.js";
import { connexion, reserverJusquauPaiement, payerParCarte } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

async function derniereMission(clientId) {
  const [m] = await sql(`select id, status, prestataire_id, montant_total, tarif_horaire, hours,
      stripe_payment_intent, acceptance_deadline
    from missions where client_id = '${clientId}' order by created_at desc limit 1`);
  return m;
}

/** Le formulaire de carte vient de js.stripe.com : l'environnement de test peut le bloquer. */
async function formulaireStripeJoignable() {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const c = await request.newContext({ proxy });
  try { return (await c.get("https://js.stripe.com/v3/", { timeout: 10_000 })).ok(); }
  catch { return false; } // injoignable : c'est précisément ce qu'on mesure
  finally { await c.dispose(); }
}

test("réservation par l'écran, paiement par carte de test : la prestation est payée et proposée au prestataire", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);

  // La prestation existe dès l'écran de paiement, pas encore payée.
  const avant = await derniereMission(c.id);
  expect(avant, "la prestation est créée avant le paiement").toBeTruthy();
  expect(avant.stripe_payment_intent).toBeNull();
  expect(Number(avant.montant_total), "montant = récapitulatif affiché (8 h × 13 € + 6,98 € de frais)").toBeCloseTo(110.98, 2);

  const r = await payerPrestation({ jetonClient: c.jeton, missionId: avant.id, montant: Number(avant.montant_total), prestataireId: p.id });
  expect(r.etape, `paiement : ${JSON.stringify(r)}`).toBe("ok");

  const apres = await derniereMission(c.id);
  console.log("[06] prestation payée :", JSON.stringify(apres));
  expect(apres.stripe_payment_intent).toBe(r.paymentIntent);
  expect(apres.prestataire_id).toBe(p.id);
  expect(apres.status, "en attente de la réponse du prestataire").toBe("pending_acceptance");
});

test("le montant envoyé par le navigateur est ignoré : Stripe prélève le prix enregistré", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  const m = await derniereMission(c.id);
  // Le navigateur annonce 1 € : le serveur doit recalculer depuis la base.
  const r = await payerPrestation({ jetonClient: c.jeton, missionId: m.id, montant: 1, prestataireId: p.id });
  expect(r.centimesPreleves, `prélevé ${r.centimesPreleves} centimes pour une prestation à ${m.montant_total} €`)
    .toBe(Math.round(Number(m.montant_total) * 100));
});

test("une carte refusée : rien n'est affecté", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  const m = await derniereMission(c.id);
  const r = await payerPrestation({ jetonClient: c.jeton, missionId: m.id, montant: Number(m.montant_total), prestataireId: p.id, carte: "pm_card_chargeDeclined" });
  expect(r.etape).toBe("confirmation Stripe");
  const apres = await derniereMission(c.id);
  expect(apres.prestataire_id, "aucun prestataire affecté sans paiement").toBeNull();
});

test("le formulaire de carte, par l'écran", async ({ page }) => {
  test.skip(!(await formulaireStripeJoignable()),
    "js.stripe.com est bloqué par le filtre réseau de l'environnement de test : à autoriser pour jouer ce scénario");
  await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  await payerParCarte(page);
  await expect(page.getByText("Paiement sécurisé !")).toBeVisible({ timeout: 60_000 });
});
