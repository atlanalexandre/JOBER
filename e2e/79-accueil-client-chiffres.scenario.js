// Accueil client, sur un petit iPhone (375 × 667) : les trois chiffres du bandeau et la
// rubrique « Dispo maintenant » (étude du 13/10/2026).
//
// « pros dispo maintenant » valait toujours 0 et la rubrique ne s'affichait jamais : elles
// lisaient `dispo_immediat`, que la fiche du catalogue ne reprenait pas. « prestations
// réalisées » comptait les prestations DU client (la base ne lui montre que les siennes) :
// 0 pour tout nouveau client, présenté comme un chiffre de la plateforme.
import { test, expect } from "@playwright/test";
import { appelApi, sql } from "./outils.js";
import { client } from "./fabrique.js";
import { connexion, fermerBandeauCookies } from "./parcours.js";

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 375, height: 667 } });

test("accueil client : prestataires disponibles et prestations réalisées de la plateforme", async ({ page }) => {
  // Le serveur compte les prestations réalisées de toute la plateforme.
  const r = await appelApi("/api/prestataires?action=demandes_ouvertes");
  expect(r.statut, "comptage de l'accueil").toBe(200);
  const compte = r.json;
  const [{ n }] = await sql("select count(*)::int as n from missions where status in ('completed','closed')");
  expect(n, "la recette doit avoir des prestations réalisées").toBeGreaterThan(0);
  // Une prestation peut se terminer entre les deux lectures : on tolère un petit écart.
  expect(Math.abs(compte.realisees - n), `réalisées : ${compte.realisees} rendues, ${n} en base`).toBeLessThanOrEqual(3);

  const c = await client();
  await page.addInitScript((id) => {
    try {
      localStorage.setItem(`alane_onboarded_${id}`, "1");
      localStorage.setItem(`alane_tour_done_${id}`, "1");
    } catch { /* stockage indisponible : le gestionnaire ci-dessous ferme les fenêtres */ }
  }, c.id);
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await fermerBandeauCookies(page);

  // Le catalogue (1 300 prestataires en recette) arrive en quelques secondes.
  const tuile = (libelle) => page.getByText(libelle, { exact: true }).locator("xpath=..");
  await expect(page.getByText("Dispo maintenant", { exact: true })).toBeVisible({ timeout: 45_000 });
  const dispo = Number(await tuile("pros dispo maintenant").locator("div").nth(1).innerText());
  expect(dispo, "pros dispo maintenant").toBeGreaterThan(0);

  const realisees = Number(await tuile("prestations réalisées").locator("div").nth(1).innerText());
  expect(Math.abs(realisees - n), `réalisées affichées : ${realisees}, en base : ${n}`).toBeLessThanOrEqual(3);

  // La rubrique est bornée : douze cartes au plus, le badge donne le total.
  await expect(page.getByText(new RegExp(`^${dispo} pros?$`))).toBeVisible();

  // Rien ne déborde en largeur sur un petit écran.
  const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(largeur, "défilement horizontal de la page").toBeLessThanOrEqual(375);
});
