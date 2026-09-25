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
export async function ouvrir(page, chemin, repere = "Tarif transparent · Prix affiché = Prix réel") {
  const appli = page.getByText(repere).first();
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

/** Inscription prestataire complète (7 étapes), par l'écran. S'arrête avant « Créer mon compte ». */
export async function remplirInscriptionPrestataire(page, { email, motDePasse = MOT_DE_PASSE, prenom = "Sam" } = {}) {
  await ouvrir(page, "/auth/signin/provider");
  await fermerBandeauCookies(page);
  await page.getByText("Inscription", { exact: true }).first().click();

  // 1 — identité
  await page.getByPlaceholder("Jean").fill(prenom);
  await page.getByPlaceholder("Dupont").fill("Recette");
  await page.getByPlaceholder("06 12 34 56 78").fill("0698765432");
  await page.locator('input[type="date"]').fill("1990-05-15");
  await page.getByPlaceholder("12 rue de la Paix").fill("5 rue de Lyon");
  await page.getByPlaceholder("75001").fill("75012");
  await page.getByPlaceholder("Paris").fill("Paris");
  await continuer(page);

  // 2 — métier
  await expect(page.getByText("ÉTAPE 2/7", { exact: false })).toBeVisible();
  await page.locator("select").nth(0).selectOption({ label: "Propreté" });
  await page.locator("select").nth(1).selectOption({ label: "Agent de propreté" });
  await page.getByRole("button", { name: /Ajouter ce métier/ }).click();
  await expect(page.getByText("Vos métiers (1)")).toBeVisible();
  await continuer(page);

  // 3 — expérience (rien d'obligatoire)
  await expect(page.getByText("ÉTAPE 3/7", { exact: false })).toBeVisible();
  await continuer(page);

  // 4 — disponibilités : matin et après-midi, tous les jours
  await expect(page.getByText("ÉTAPE 4/7", { exact: false })).toBeVisible();
  for (let i = 0; i < 7; i++) {
    await page.getByRole("button", { name: "Matin", exact: true }).nth(i).click();
    await page.getByRole("button", { name: "Après-midi", exact: true }).nth(i).click();
  }
  await continuer(page);

  // 5 — statut (l'IBAN ne se saisit plus ici : espace prestataire, après activation)
  await expect(page.getByText("ÉTAPE 5/7", { exact: false })).toBeVisible();
  await page.getByText("Je m'engage à disposer d'une assurance RC", { exact: false }).click();
  await continuer(page);

  // 6 — abonnement : Gratuit, présélectionné
  await expect(page.getByText("ÉTAPE 6/7", { exact: false })).toBeVisible();
  await continuer(page);

  // 7 — récapitulatif et compte
  await expect(page.getByText("ÉTAPE 7/7", { exact: false })).toBeVisible();
  await page.locator('input[type="email"]').fill(email);
  await page.getByPlaceholder(/min\. 8 caractères/).fill(motDePasse);
  await cocherCgps(page);
}

/** Connexion au backoffice de la recette. Le mot de passe vient de RECETTE_BO_PASSWORD. */
export async function connexionBO(page, motDePasse = process.env.RECETTE_BO_PASSWORD) {
  if (!motDePasse) throw new Error("RECETTE_BO_PASSWORD absent : impossible d'ouvrir le backoffice de recette.");
  await ouvrir(page, "/admin", "Backoffice ALANE");
  await fermerBandeauCookies(page);
  await page.locator('input[type="password"]').fill(motDePasse);
  await page.getByRole("button", { name: /Accéder au backoffice/ }).click();
}

/** Onglet Comptes du backoffice, filtré sur une adresse e-mail. */
export async function ficheBO(page, email, filtre = "Tous") {
  await page.getByRole("button", { name: /✅ Comptes/ }).first().click();
  await page.getByRole("button", { name: filtre, exact: true }).first().click();
  await page.getByPlaceholder(/Rechercher par email/).fill(email);
  await expect(page.getByText(email)).toBeVisible();
}

/** Répond « Confirmer » à la fenêtre de confirmation du backoffice. */
export const confirmer = (page) => page.getByRole("button", { name: "Confirmer", exact: true }).click();

/**
 * Réservation d'un prestataire d'hôtellerie par un client connecté, jusqu'à l'écran
 * de paiement. Renvoie la date réservée (AAAA-MM-JJ).
 */
export async function reserverJusquauPaiement(page, { dansJours = 5, heure = "09:00", description = "Scénario de recette", chaqueSemaine = false } = {}) {
  await page.goto("/providers");
  await page.getByText("Passer le tutoriel").click({ timeout: 3_000 }).catch(() => { /* tutoriel déjà passé */ });
  await page.getByText("Voir tous les prestataires").first().click();
  await page.getByText(/Voir \d+ →/).first().click();
  await page.getByRole("button", { name: "📅 Réserver" }).first().click();
  const date = new Date(Date.now() + dansJours * 864e5).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(date);
  await page.locator('input[type="time"]').fill(heure);
  await page.locator("textarea").fill(description);
  if (chaqueSemaine) await page.getByText("Répéter chaque semaine").click();
  await page.getByRole("button", { name: /Continuer/ }).click();
  // Contrat : seule la petite case est cliquable, pas la phrase (défaut d'accessibilité relevé).
  await page.getByText("J'ai lu et j'accepte les termes de ce contrat").locator("xpath=preceding-sibling::div[1]").click();
  await page.getByRole("button", { name: /Signer électroniquement/ }).click();
  await page.getByRole("button", { name: /Même adresse qu'à l'inscription/ }).click();
  await page.getByRole("button", { name: /Confirmer l'adresse/ }).click();
  await page.getByRole("button", { name: /Confirmer & payer/ }).click();
  await expect(page).toHaveURL(/\/booking\/payment/);
  return date;
}

/** Saisit une carte de test Stripe dans le Payment Element, renonce à la rétractation, paie. */
export async function payerParCarte(page, { numero = "4242424242424242", titulaire = "Camille Recette" } = {}) {
  await page.getByPlaceholder("Jean Dupont").fill(titulaire);
  // Plusieurs cadres Stripe sur la page (Google Pay, Link, carte) : on prend celui qui
  // contient le champ du numéro.
  let cadre = null;
  for (let essai = 0; essai < 30 && !cadre; essai++) {
    for (const f of page.frames()) {
      if (await f.locator('input[name="number"]').count().catch(() => 0)) { cadre = f; break; }
    }
    if (!cadre) await page.waitForTimeout(1000);
  }
  if (!cadre) throw new Error("formulaire de carte Stripe introuvable");
  await cadre.locator('input[name="number"]').fill(numero);
  await cadre.locator('input[name="expiry"]').fill("12 / 34");
  await cadre.locator('input[name="cvc"]').fill("123");
  // Selon le pays, Stripe demande aussi un code postal.
  if (await cadre.locator('input[name="postalCode"]').count()) await cadre.locator('input[name="postalCode"]').fill("75004");
  // Case de renonciation au droit de rétractation (obligatoire pour payer).
  await page.getByText("Vous disposez d'un droit de rétractation", { exact: false }).locator("xpath=ancestor::label[1]").locator('input[type="checkbox"]').check()
    .catch(async () => { await page.locator('input[type="checkbox"]').last().check(); });
  await page.getByRole("button", { name: /Payer .* en sécurité/ }).click();
}
