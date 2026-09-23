// Inscription d'un client : le parcours complet, puis les refus attendus.
//
// Chaque test crée son propre compte : un test qui échoue n'en entraîne pas d'autres.
import { test, expect } from "@playwright/test";
import { sql, emailTest, MOT_DE_PASSE } from "./outils.js";
import { remplirInscriptionClient, continuer, connexion, cocherCgps, ouvrir, fermerBandeauCookies } from "./parcours.js";

async function inscrire(page, email) {
  await remplirInscriptionClient(page, { email });
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
}

async function profilDe(email) {
  const [p] = await sql(`select p.role, p.status, p.prenom, p.ville, p.code_postal, length(u.raw_user_meta_data::text) meta
    from auth.users u left join profiles p on p.id = u.id where u.email = '${email}'`);
  return p;
}

test.describe("inscription client", () => {
  test("le compte et le profil sont créés, avec des métadonnées légères", async ({ page }) => {
    const email = emailTest("client");
    await inscrire(page, email);
    const p = await profilDe(email);
    expect(p, "le compte doit exister dans la base de recette").toBeTruthy();
    expect(p.role).toBe("client");
    expect(p.prenom).toBe("Camille");
    // Perdus du 30/07 au 23/09/2026 : l'écriture du profil était refusée en bloc.
    expect(p.ville, "la ville du formulaire est enregistrée").toBe("Paris");
    expect(p.code_postal).toBe("75004");
    expect(p.meta, "user_metadata voyage dans chaque jeton : viser moins de 2 Ko (CLAUDE.md §1.1)").toBeLessThan(2048);
  });

  // DOCUMENTATION.md §6 : « un client créé à l'instant peut réserver immédiatement ».
  // Ce test a trouvé que c'était faux du 30/07 au 23/09/2026 (migration
  // `inscription_client_validee_d_office`).
  test("un client nouvellement inscrit accède directement à son accueil", async ({ page }) => {
    const email = emailTest("client-acces");
    await inscrire(page, email);
    await page.screenshot({ path: "e2e-resultats/captures/02-client-apres-inscription.png", fullPage: true });
    expect((await profilDe(email)).status, "statut du client en base").toBe("approved");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("le même e-mail ne peut pas servir deux fois", async ({ page, browser }) => {
    const email = emailTest("doublon");
    await inscrire(page, email);
    const autre = await browser.newPage();
    await remplirInscriptionClient(autre, { email });
    await autre.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(autre.getByText(/existe déjà|already/i)).toBeVisible();
    const [{ n }] = await sql(`select count(*)::int n from auth.users where email = '${email}'`);
    expect(n).toBe(1);
  });

  test("mauvais mot de passe refusé, bon mot de passe accepté", async ({ page, browser }) => {
    const email = emailTest("connexion");
    await inscrire(page, email);
    // Isole la connexion du défaut de statut (test précédent) : on valide le compte
    // comme le ferait l'administration.
    await sql(`update profiles set status = 'approved' where id = (select id from auth.users where email = '${email}')`);
    const autre = await browser.newPage();
    await connexion(autre, { email, motDePasse: "mauvais-mot-de-passe" });
    await expect(autre.getByText(/incorrect|invalide|invalid/i).first()).toBeVisible();
    await expect(autre).toHaveURL(/\/auth\/signin/);
    await connexion(autre, { email, motDePasse: MOT_DE_PASSE });
    await expect(autre).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await autre.screenshot({ path: "e2e-resultats/captures/02-client-accueil.png", fullPage: true });
  });
});

test.describe("inscription client — refus attendus", () => {
  test("étape 1 vide : le formulaire le dit", async ({ page }) => {
    await ouvrir(page, "/auth/signin/client");
    await fermerBandeauCookies(page);
    await page.getByText("Inscription", { exact: true }).first().click();
    await continuer(page);
    await expect(page.getByText("Prénom et nom obligatoires")).toBeVisible();
  });

  test("mot de passe trop court", async ({ page }) => {
    await remplirInscriptionClient(page, { email: emailTest("court"), motDePasse: "abc" });
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page.getByText("Mot de passe minimum 8 caractères")).toBeVisible();
  });

  test("CGPS non acceptées", async ({ page }) => {
    await remplirInscriptionClient(page, { email: emailTest("cgps") });
    await cocherCgps(page); // décoche
    await page.getByRole("button", { name: /Créer mon compte/ }).click();
    await expect(page.getByText(/accepter les CGPS/)).toBeVisible();
  });
});
