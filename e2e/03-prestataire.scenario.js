// Inscription d'un prestataire : ce qu'il obtient, et surtout ce qu'il n'obtient pas.
import { test, expect } from "@playwright/test";
import { sql, emailTest, MOT_DE_PASSE } from "./outils.js";
import { remplirInscriptionPrestataire, connexion, continuer, ouvrir, fermerBandeauCookies } from "./parcours.js";

async function compte(email) {
  const [c] = await sql(`select p.role, p.status, p.missions_enabled, p.plan_abonnement, p.rib is not null rib_en_base,
      u.raw_user_meta_data ? 'rib' rib_dans_jeton, length(u.raw_user_meta_data::text) meta
    from auth.users u join profiles p on p.id = u.id where u.email = '${email}'`);
  return c;
}

test.describe("inscription prestataire", () => {
  test("le prestataire naît en attente, sans accès, sur l'offre gratuite", async ({ page }) => {
    const email = emailTest("presta");
    await remplirInscriptionPrestataire(page, { email });
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
    await page.screenshot({ path: "e2e-resultats/captures/03-presta-apres-inscription.png", fullPage: true });

    const c = await compte(email);
    expect(c.role).toBe("prestataire");
    expect(c.status, "validation manuelle obligatoire").toBe("pending");
    expect(c.missions_enabled, "aucun accès aux prestations sans dossier").toBe(false);
    expect(c.plan_abonnement).toBe("free");
    expect(c.meta, "user_metadata < 2 Ko (CLAUDE.md §1.1)").toBeLessThan(2048);
  });

  // L'IBAN ne se saisit plus à l'inscription (24/09/2026) : il n'est ni dans le
  // jeton, ni dans le profil, et se renseigne ensuite — voir e2e/13.
  test("l'inscription ne dépose aucun IBAN, et surtout pas dans le jeton", async ({ page }) => {
    const email = emailTest("presta-iban");
    await remplirInscriptionPrestataire(page, { email });
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
    const c = await compte(email);
    expect(c.rib_dans_jeton, "IBAN dans user_metadata = dans chaque jeton (RGPD)").toBe(false);
  });

  test("un prestataire en attente est refusé à la connexion avec un message clair", async ({ page, browser }) => {
    const email = emailTest("presta-attente");
    await remplirInscriptionPrestataire(page, { email });
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
    const autre = await browser.newPage();
    await connexion(autre, { espace: "prestataire", email, motDePasse: MOT_DE_PASSE });
    await expect(autre.getByText(/attente/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(autre).not.toHaveURL(/\/provider\/dashboard/);
  });
});

test.describe("inscription prestataire — refus attendus", () => {
  test("moins de 16 ans", async ({ page }) => {
    await ouvrir(page, "/auth/signin/provider");
    await fermerBandeauCookies(page);
    await page.getByText("Inscription", { exact: true }).first().click();
    await page.getByPlaceholder("Jean").fill("Léo");
    await page.getByPlaceholder("Dupont").fill("Recette");
    await page.getByPlaceholder("06 12 34 56 78").fill("0698765432");
    const il_y_a_15_ans = new Date(Date.now() - 15 * 365.25 * 864e5).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').fill(il_y_a_15_ans);
    await page.getByPlaceholder("12 rue de la Paix").fill("5 rue de Lyon");
    await page.getByPlaceholder("75001").fill("75012");
    await page.getByPlaceholder("Paris").fill("Paris");
    await continuer(page);
    await expect(page.getByText("au moins 16 ans")).toBeVisible();
  });

  // Un IBAN au bon format mais à la clé fausse (dernier chiffre modifié) : le
  // virement au prestataire échouerait. Jusqu'au 23/09/2026, seul le format était contrôlé.
  test("un IBAN à la clé de contrôle fausse est refusé", async ({ page }) => {
    // Le parcours s'arrête à l'étape 5 : l'attente de l'étape 6 échoue, c'est voulu.
    await remplirInscriptionPrestataire(page, { email: emailTest("iban-faux"), iban: "FR7630006000011234567890188" })
      .catch(() => { /* bloqué à l'étape 5, vérifié ci-dessous */ });
    await expect(page.getByText(/IBAN incorrect/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("ÉTAPE 5/7", { exact: false })).toBeVisible();
  });
});
