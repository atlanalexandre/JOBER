// Prestataire : un échec du chargement de ses prestations se voit (audit des écrans, 01/10/2026).
//
// L'erreur était avalée et la liste vide disait « Aucune prestation en cours » : le
// prestataire manquait des demandes sans le savoir.
import { test, expect } from "@playwright/test";
import { prestataireOperationnel } from "./fabrique.js";
import { connexion } from "./parcours.js";

test.describe.configure({ timeout: 200_000 });

test("panne du chargement : un message et « Réessayer », pas « Aucune prestation »", async ({ page }) => {
  const p = await prestataireOperationnel();
  await page.route("**/api/missions", async (route) => {
    const corps = route.request().postData() || "";
    if (corps.includes('"my_missions"')) return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"panne simulée"}' });
    return route.continue();
  });
  // Au premier passage : demande de géolocalisation, guide des onglets, tutoriel (comme e2e/18).
  const fenetreGeo = page.getByText("Autoriser la géolocalisation", { exact: false });
  await page.addLocatorHandler(fenetreGeo, () => page.getByRole("button", { name: "Annuler", exact: true }).click());
  await page.addLocatorHandler(page.getByText("Passer le guide"), (l) => l.click());
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
  await expect(page.getByText("Vos prestations n'ont pas pu être chargées")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Aucune prestation en cours")).toHaveCount(0);

  // Le service revient : « Réessayer » recharge, et le message disparaît.
  await page.unroute("**/api/missions");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("Vos prestations n'ont pas pu être chargées")).toHaveCount(0, { timeout: 30_000 });
});
