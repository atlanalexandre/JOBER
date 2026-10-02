// Première connexion : une seule fenêtre à la fois (décision d'Alexandre du 02/10/2026).
//
// Un nouveau client voyait deux tutoriels empilés ; un nouveau prestataire, deux
// tutoriels et la demande de géolocalisation — avant même d'avoir une prestation.
// Constaté par la recette du 02/10/2026 (e2e/07 et e2e/18 bloqués derrière).
import { test, expect } from "@playwright/test";
import { prestataireOperationnel, client } from "./fabrique.js";
import { connexion } from "./parcours.js";

test.describe.configure({ timeout: 200_000 });

test("client : l'accueil seul, sans second tutoriel derrière", async ({ page }) => {
  const c = await client();
  await connexion(page, { espace: "client", email: c.email });
  await expect(page.getByText("Passer le tutoriel")).toBeVisible({ timeout: 30_000 });
  await page.getByText("Passer le tutoriel").click();
  // Le second tutoriel (« Bienvenue sur ALANE ! » / « Passer ») n'existe plus.
  await page.waitForTimeout(3_000);
  await expect(page.getByText("Bienvenue sur ALANE !")).toHaveCount(0);
  await expect(page.getByText("Passer le tutoriel")).toHaveCount(0);
});

test("prestataire : l'accueil, puis le guide des onglets — jamais ensemble, et pas de GPS sans prestation", async ({ page }) => {
  const p = await prestataireOperationnel();
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page.getByText("Passer le tutoriel")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(page.getByText("Passer le guide"), "le guide attend la fin de l'accueil").toHaveCount(0);
  await expect(page.getByText("Autoriser la géolocalisation", { exact: false }), "aucune prestation : pas de question").toHaveCount(0);

  await page.getByText("Passer le tutoriel").click();
  await expect(page.getByText("Passer le guide")).toBeVisible({ timeout: 15_000 });
  await page.getByText("Passer le guide").click();
  await page.waitForTimeout(3_000);
  await expect(page.getByText("Autoriser la géolocalisation", { exact: false })).toHaveCount(0);
});
