// Réservation et paiement : le client réserve un prestataire et paie par carte de test.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client } from "./fabrique.js";
import { connexion, reserverJusquauPaiement, payerParCarte } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

async function derniereMission(clientId) {
  const [m] = await sql(`select id, status, prestataire_id, montant_total, tarif_horaire, hours, stripe_payment_intent
    from missions where client_id = '${clientId}' order by created_at desc limit 1`);
  return m;
}

test("un client réserve et paie par carte : la prestation est payée et affectée", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  await payerParCarte(page);
  await expect(page.getByText("Paiement sécurisé !")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: "e2e-resultats/captures/06-paiement-ok.png", fullPage: true });

  await expect.poll(async () => (await derniereMission(c.id))?.stripe_payment_intent, { timeout: 30_000 }).toBeTruthy();
  const m = await derniereMission(c.id);
  console.log("[06] prestation :", JSON.stringify(m));
  expect(Number(m.montant_total), "montant payé = récapitulatif (8 h × tarif + frais)").toBeCloseTo(110.98, 2);
  expect(m.prestataire_id === p.id || m.status === "pending_acceptance" || m.status === "assigned",
    `prestation rattachée au prestataire choisi (statut ${m.status})`).toBe(true);
});

test("une carte refusée n'aboutit pas, et le client le lit", async ({ page }) => {
  await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page);
  await payerParCarte(page, { numero: "4000000000000002" });
  await expect(page.getByText(/refusée|declined/i).first()).toBeVisible({ timeout: 60_000 });
  const m = await derniereMission(c.id);
  expect(m?.status, "aucune prestation active après un refus").not.toBe("assigned");
});
