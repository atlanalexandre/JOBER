// L'accueil s'affiche, sans erreur, et sans jamais appeler la production.
import { test, expect } from "@playwright/test";
import { PROD_REF } from "./outils.js";

test("l'accueil se charge sur la recette, sans erreur ni appel à la production", async ({ page }) => {
  const erreurs = [];
  const appelsProd = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  page.on("request", (r) => { if (r.url().includes(PROD_REF)) appelsProd.push(r.url()); });

  await page.goto("/");
  await expect(page.locator("body")).toContainText(/ALANE/i);
  await page.screenshot({ path: "e2e-resultats/captures/01-accueil.png", fullPage: true });

  expect(appelsProd, "aucune requête ne doit partir vers la base de production").toEqual([]);
  expect(erreurs, "aucune erreur JavaScript").toEqual([]);
});
