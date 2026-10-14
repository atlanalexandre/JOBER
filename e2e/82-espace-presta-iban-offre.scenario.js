// Espace prestataire, sur petit iPhone (étude d'octobre 2026) :
//   - l'IBAN est enregistré (profiles.rib) : le bandeau « IBAN / RIB manquant » ne
//     s'affiche pas — il lisait user_metadata, où l'IBAN n'est plus rangé ;
//   - les 100 places de l'offre de lancement sont prises en recette (plus de mille
//     prestataires activés) : l'offre ne s'annonce nulle part.
import { test, expect } from "@playwright/test";
import { appelApi } from "./outils.js";
import { prestataireOperationnel } from "./fabrique.js";
import { connexion, fermerBandeauCookies } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 375, height: 667 } });

test("espace prestataire : IBAN reconnu, offre épuisée non annoncée", async ({ page }) => {
  const places = await appelApi("/api/prestataires?action=places");
  expect(places.statut).toBe(200);
  expect(places.json?.ouverte, "l'offre doit être close en recette pour ce scénario").toBe(false);

  const p = await prestataireOperationnel();
  await page.addInitScript((id) => {
    try { for (const k of ["alane_onboarded_", "alane_presta_tour_done_", "alane_gps_consent_"]) localStorage.setItem(k + id, "1"); }
    catch { /* stockage indisponible : le gestionnaire ci-dessous ferme le guide */ }
  }, p.id);
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
  await fermerBandeauCookies(page);

  await expect(page.getByText("Disponible maintenant")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000); // toutes les lectures de l'accueil ont répondu
  await expect(page.getByText(/8 prestations le mois de votre 1re prestation/)).toHaveCount(0);

  await page.getByText("Prestations", { exact: true }).last().click();
  await expect(page.getByText("En cours", { exact: true })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByText("IBAN / RIB manquant")).toHaveCount(0);

  await page.goto("/provider/subscription");
  await expect(page.getByText("Mon abonnement")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText("Offre de lancement exclusive")).toHaveCount(0);
});
