// Backoffice : validation d'un prestataire, suspension, réactivation, rattrapage des clients.
//
// Ces tests jouent le backoffice par l'écran ET contrôlent la base : un bouton qui
// affiche « suspendu » sans que la base l'ait enregistré, c'est exactement le défaut
// que ce fichier a trouvé (corrigé le 23/09/2026).
import { test, expect } from "@playwright/test";
import { sql, emailTest, MOT_DE_PASSE } from "./outils.js";
import { remplirInscriptionPrestataire, remplirInscriptionClient, connexion, connexionBO, ficheBO, confirmer } from "./parcours.js";

const statutDe = async (email) =>
  (await sql(`select p.status from profiles p join auth.users u on u.id = p.id where u.email = '${email}'`))[0]?.status;

test("un mauvais mot de passe n'ouvre pas le backoffice", async ({ page }) => {
  await connexionBO(page, "mauvais-mot-de-passe");
  await expect(page.getByText("Mot de passe incorrect")).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/admin\/dashboard/);
});

test.describe.serial("cycle de vie d'un compte prestataire", () => {
  const email = emailTest("presta-bo");

  test("inscription", async ({ page }) => {
    await remplirInscriptionPrestataire(page, { email });
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
    expect(await statutDe(email)).toBe("pending");
  });

  test("l'administration approuve le compte", async ({ page }) => {
    await connexionBO(page);
    await ficheBO(page, email, "⏳ En attente");
    await page.getByRole("button", { name: "✅ Approuver" }).first().click();
    await expect.poll(() => statutDe(email), { timeout: 20_000 }).toBe("approved");
  });

  test("le prestataire approuvé entre dans son espace", async ({ page }) => {
    await connexion(page, { espace: "prestataire", email, motDePasse: MOT_DE_PASSE });
    await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
    await page.screenshot({ path: "e2e-resultats/captures/04-presta-espace.png", fullPage: true });
  });

  test("l'administration suspend le compte : la base l'enregistre", async ({ page }) => {
    await connexionBO(page);
    await ficheBO(page, email, "✅ Approuvés");
    await page.getByRole("button", { name: "🔒 Suspendre" }).first().click();
    await page.locator("input").last().fill("Scénario de recette : vérification de la suspension");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await expect.poll(() => statutDe(email), { timeout: 20_000 }).toBe("suspended");
  });

  test("un compte suspendu ne peut plus se connecter", async ({ page }) => {
    await connexion(page, { espace: "prestataire", email, motDePasse: MOT_DE_PASSE });
    await expect(page).not.toHaveURL(/\/provider\/(dashboard|missions|account)/, { timeout: 15_000 });
    await page.screenshot({ path: "e2e-resultats/captures/04-presta-suspendu.png", fullPage: true });
  });

  test("l'administration réactive le compte", async ({ page }) => {
    await connexionBO(page);
    await ficheBO(page, email, "Tous");
    await page.getByRole("button", { name: "🔓 Réactiver" }).first().click();
    await confirmer(page);
    await expect.poll(() => statutDe(email), { timeout: 20_000 }).toBe("approved");
  });
});

test("rattrapage : les clients restés « en attente » sont validés d'un clic", async ({ page }) => {
  // Un client bloqué comme ceux inscrits entre le 30/07 et le 23/09/2026.
  const email = emailTest("client-bloque");
  await remplirInscriptionClient(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
  await sql(`update profiles set status = 'pending' where id = (select id from auth.users where email = '${email}')`);

  const bo = await page.context().browser().newPage();
  await connexionBO(bo);
  await bo.getByRole("button", { name: /✅ Comptes/ }).first().click();
  await bo.getByRole("button", { name: /Valider les \d+ client\(s\) en attente/ }).click();
  await expect(bo.getByText("La plateforme ouvre ses portes très bientôt", { exact: false })).toBeVisible();
  await confirmer(bo);
  await expect.poll(() => statutDe(email), { timeout: 30_000 }).toBe("approved");
  const [{ n }] = await sql("select count(*)::int n from profiles where role = 'client' and status = 'pending'");
  expect(n, "plus aucun client en attente").toBe(0);
  const [{ traces }] = await sql(`select count(*)::int traces from bo_logs where action = 'valider_client_en_attente'
    and target_id = (select id from auth.users where email = '${email}')`);
  expect(traces, "l'action est journalisée").toBe(1);
});
