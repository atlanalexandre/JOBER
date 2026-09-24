// Inscription quand l'adresse e-mail doit être confirmée, et saisie de l'IBAN.
//
// Avec la confirmation active, `signUp` crée le compte sans rendre de session :
// le navigateur ne peut plus rien écrire. C'est donc la base qui enregistre les
// renseignements du formulaire à la création du compte (handle_new_user), et
// l'IBAN se saisit ensuite, depuis l'espace de l'utilisateur.
//
// La recette garde la confirmation DÉSACTIVÉE (ses comptes d'essai n'ont pas de
// boîte mail). Le cas « sans session » est donc reproduit en retirant la session
// de la réponse d'inscription, exactement comme Supabase le fait quand la
// confirmation est active : l'écran et la base se comportent alors comme en vrai.
import { test, expect } from "@playwright/test";
import { sql, emailTest } from "./outils.js";
import { client, prestataireOperationnel } from "./fabrique.js";
import { remplirInscriptionPrestataire, remplirInscriptionClient, connexion } from "./parcours.js";

test.describe.configure({ timeout: 180_000 });

/** Réponse d'inscription telle que Supabase la rend quand la confirmation est exigée : l'utilisateur, sans session. */
async function sansSession(page) {
  await page.route("**/auth/v1/signup**", async (route) => {
    const res = await route.fetch();
    const corps = await res.json();
    await route.fulfill({ response: res, json: corps.user || corps });
  });
}

const profil = async (email) => (await sql(`select p.role, p.status, p.adresse, p.ville, p.code_postal, p.rib,
    p.referred_by, u.raw_user_meta_data ? 'rib' rib_dans_jeton
  from auth.users u join profiles p on p.id = u.id where u.email = '${email}'`))[0];

test("prestataire, confirmation exigée : écran « vérifiez votre boîte mail », profil complet en base", async ({ page }) => {
  await sansSession(page);
  const email = emailTest("presta-confirm");
  await remplirInscriptionPrestataire(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/renseignez votre\s+IBAN/)).toBeVisible();

  const p = await profil(email);
  console.log("[13] prestataire sans session :", JSON.stringify(p));
  expect(p.role).toBe("prestataire");
  expect(p.status).toBe("pending");
  expect(p.adresse, "adresse enregistrée par la base, sans session").toBe("5 rue de Lyon");
  expect(p.ville).toBe("Paris");
  expect(p.code_postal).toBe("75012");
  expect(p.rib).toBeNull();
  expect(p.rib_dans_jeton).toBe(false);
});

test("client, confirmation exigée : écran de confirmation, profil complet en base", async ({ page }) => {
  await sansSession(page);
  const email = emailTest("client-confirm");
  await remplirInscriptionClient(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible({ timeout: 30_000 });
  const p = await profil(email);
  expect(p.role).toBe("client");
  expect(p.status).toBe("approved");
  expect(p.ville).toBe("Paris");
  expect(p.code_postal).toBe("75004");
});

test("le parrainage est rattaché par la base, même sans session", async ({ page }) => {
  const parrain = await client();
  await page.addInitScript((id) => { try { sessionStorage.setItem("alane_referrer", id); } catch { /* sans stockage, pas de parrain */ } }, parrain.id);
  await sansSession(page);
  const email = emailTest("filleul");
  await remplirInscriptionClient(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible({ timeout: 30_000 });
  const p = await profil(email);
  expect(p.referred_by, "filleul rattaché à son parrain").toBe(parrain.id);
  const [pp] = await sql(`select referral_count from profiles where id = '${parrain.id}'`);
  expect(pp.referral_count).toBe(1);
});

test("un parrain inexistant est ignoré, l'inscription aboutit", async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("alane_referrer", "00000000-0000-4000-8000-000000000000"); } catch { /* idem */ } });
  const email = emailTest("filleul-orphelin");
  await remplirInscriptionClient(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
  expect((await profil(email)).referred_by).toBeNull();
});

test("l'IBAN saisi dans les Paramètres va dans le profil, jamais dans le jeton", async ({ page }) => {
  const p = await prestataireOperationnel();
  await sql(`update profiles set rib = null where id = '${p.id}'`);
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
  await page.goto("/provider/profile");

  const champ = page.getByPlaceholder("FR76 3000 6000 0112 3456 7890 189");
  // Clé de contrôle fausse : refusé, rien n'est écrit.
  await champ.fill("FR7630006000011234567890188");
  await page.getByRole("button", { name: /Enregistrer les modifications/ }).click();
  await expect(page.getByText(/IBAN incorrect/)).toBeVisible({ timeout: 15_000 });
  expect((await sql(`select rib from profiles where id = '${p.id}'`))[0].rib).toBeNull();

  // Nouvelle visite de l'écran pour la saisie valide.
  await page.reload();
  await champ.fill("FR7630006000011234567890189");
  await page.getByRole("button", { name: /Enregistrer les modifications/ }).click();
  await expect(page.getByText(/Sauvegardé/)).toBeVisible({ timeout: 15_000 });
  const [e] = await sql(`select p.rib, u.raw_user_meta_data->>'rib' jeton from profiles p join auth.users u on u.id = p.id where p.id = '${p.id}'`);
  console.log("[13] IBAN après Paramètres :", JSON.stringify(e));
  expect(e.rib).toBe("FR7630006000011234567890189");
  expect(e.jeton, "aucun IBAN dans le jeton").toBeNull();
});
