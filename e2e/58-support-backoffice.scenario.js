// Onglet Support du back-office (audit des écrans, 01/10/2026).
//
// 1. « Supprimer » effaçait un ticket — et le message du client — en un geste, sans
//    confirmation, juste à côté de « Marquer résolu ».
// 2. Les boutons « Répondre » restaient grisés sans dire pourquoi : on croyait à une panne.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { connexionBO } from "./parcours.js";

test.describe.configure({ timeout: 120_000 });

test("supprimer un ticket demande confirmation ; « Répondre » dit comment s'activer", async ({ page }) => {
  const sujet = `Recette 58 — ${Date.now()}`;
  const [t] = await sql(`insert into support_tickets (subject, message, status, user_email, user_name)
     values ('${sujet}', 'Message de recette', 'open', 'recette58@recette.alane.test', 'Recette 58') returning id`);
  await connexionBO(page);
  await page.getByRole("button", { name: /Support/ }).first().click();
  const carte = page.locator("div").filter({ hasText: sujet }).filter({ has: page.getByRole("button", { name: /Supprimer/ }) }).last();
  await expect(carte).toBeVisible({ timeout: 30_000 });

  await expect(carte.getByText("Écrivez votre réponse dans la case pour activer l'envoi.")).toBeVisible();
  await carte.locator("textarea").fill("Bonjour");
  await expect(carte.getByText("Écrivez votre réponse dans la case pour activer l'envoi.")).toHaveCount(0);

  await carte.getByRole("button", { name: /Supprimer/ }).click();
  await expect(page.getByText(/Supprimer ce ticket définitivement/)).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  const [encore] = await sql(`select count(*)::int n from support_tickets where id = '${t.id}'`);
  expect(encore.n, "le ticket n'est pas supprimé sans confirmation").toBe(1);
  await sql(`delete from support_tickets where id = '${t.id}'`);
});
