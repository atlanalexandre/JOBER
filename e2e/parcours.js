// Parcours réutilisés par plusieurs scénarios : ils jouent l'application comme un
// utilisateur, par l'écran, et ne touchent la base que pour CONTRÔLER.
import { expect } from "@playwright/test";
import { MOT_DE_PASSE } from "./outils.js";

export async function fermerBandeauCookies(page) {
  const bouton = page.getByText("J'ai compris");
  if (await bouton.isVisible().catch(() => false)) await bouton.click();
}

/**
 * La case des CGPS est un <div> cliquable, pas une vraie case à cocher : on vise le
 * carré, à gauche. Cliquer le texte ouvrirait la fenêtre des CGPS (lien intégré).
 */
export async function cocherCgps(page) {
  await page.getByText("J'ai lu et j'accepte les", { exact: false }).locator("xpath=..").click({ position: { x: 12, y: 14 } });
}

/**
 * Ouvre une page et attend que l'application React ait remplacé la page statique de
 * référencement. Si un fichier JavaScript n'arrive pas (502 ponctuel du proxy de
 * l'environnement cloud, constaté le 23/09/2026), on recharge UNE fois, en le disant :
 * un second échec est un vrai problème et fait échouer le scénario.
 */
export async function ouvrir(page, chemin) {
  const appli = page.getByText("Tarif transparent · Prix affiché = Prix réel").first();
  await page.goto(chemin);
  try {
    await expect(appli).toBeVisible({ timeout: 20_000 });
  } catch {
    console.warn(`[e2e] l'application ne s'est pas chargée sur ${chemin} : second essai`);
    await page.reload();
    await expect(appli).toBeVisible({ timeout: 30_000 });
  }
}

export const continuer = (page) => page.getByRole("button", { name: /Continuer/ }).click();

/** Inscription client complète, par l'écran. S'arrête juste avant « Créer mon compte ». */
export async function remplirInscriptionClient(page, { email, motDePasse = MOT_DE_PASSE, prenom = "Camille" } = {}) {
  await ouvrir(page, "/auth/signin/client");
  await fermerBandeauCookies(page);
  await page.getByText("Inscription", { exact: true }).first().click();

  // Étape 1 — identité
  await page.getByPlaceholder("Jean").fill(prenom);
  await page.getByPlaceholder("Dupont").fill("Recette");
  await page.getByPlaceholder("06 12 34 56 78").fill("0612345678");
  await continuer(page);

  // Étape 2 — besoins
  await expect(page.getByText("ÉTAPE 2/3", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Propreté/ }).click();
  await page.getByRole("button", { name: /^⏱ Ponctuel/ }).click();
  await page.getByPlaceholder("12 rue de la Paix").first().fill("10 rue de Rivoli");
  await page.getByPlaceholder("75001").first().fill("75004");
  await page.getByPlaceholder("Paris").first().fill("Paris");
  await page.getByRole("button", { name: /Moins de 8h/ }).click();
  await page.getByPlaceholder("12 rue de la Paix").nth(1).fill("10 rue de Rivoli");
  await page.getByPlaceholder("75001").nth(1).fill("75004");
  await page.getByPlaceholder("Paris").nth(1).fill("Paris");
  await continuer(page);

  // Étape 3 — compte
  await expect(page.getByText("ÉTAPE 3/3", { exact: false })).toBeVisible();
  await cocherCgps(page);
  await page.locator('input[type="email"]').fill(email);
  await page.getByPlaceholder(/min\. 8 caractères/).fill(motDePasse);
}

export async function connexion(page, { espace = "client", email, motDePasse = MOT_DE_PASSE }) {
  await ouvrir(page, espace === "client" ? "/auth/signin/client" : "/auth/signin/provider");
  await fermerBandeauCookies(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(motDePasse);
  await page.getByRole("button", { name: /Se connecter/ }).click();
}
