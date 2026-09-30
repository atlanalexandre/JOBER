// Accusé de réception de l'inscription d'un prestataire (29/09/2026).
//
// Alexandre l'envoyait à la main : celui de l'écran d'inscription ne partait presque
// jamais (aucune session tant que l'adresse n'est pas confirmée). Le serveur l'envoie
// désormais, une seule fois, au passage du traitement automatique.
//
// Aucun e-mail ne part de la recette (RESEND_API_KEY absente, comme pour e2e/15) : le
// succès de l'envoi est éprouvé par src/tests/api/accuse-inscription.test.js. Ce qui
// l'est ici, en vrai, c'est la moitié qui protège contre l'oubli : un envoi qui échoue
// ne marque RIEN, et le passage suivant réessaiera — le passage tourne, sans erreur,
// et ne touche pas à un compte déjà validé.
//
// Prérequis : migration 2026-09-29_accuse_reception_inscription.sql.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { inscrire, tachePlanifiee, bo } from "./fabrique.js";
import { connexionBO, ficheBO } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

test("envoi impossible (recette) : rien n'est marqué, l'accusé reste à envoyer ; un compte validé n'est pas concerné", async () => {
  const p = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765432", metier: "Femme/Valet de chambre", secteur: "hotellerie" } });
  const deja = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765433", metier: "Serveur(se)", secteur: "hotellerie" } });
  expect((await bo("approve", { profileId: deja.id })).statut).toBe(200);

  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status, accuse_inscription_at from profiles where id = '${p.id}'`);
  expect(l.status).toBe("pending");
  expect(l.accuse_inscription_at, "envoi échoué : prise rendue, pas marqué « envoyé »").toBeNull();
  const [d] = await sql(`select accuse_inscription_at from profiles where id = '${deja.id}'`);
  expect(d.accuse_inscription_at, "déjà validé : jamais pris").toBeNull();

  // Les inscrits d'avant la migration restent marqués : ils ne recevront rien.
  // Sur la date de création du COMPTE : e2e/11 antidate `profiles.created_at` de
  // comptes créés le jour même pour simuler une échéance — ils ne sont pas
  // « d'avant le 29/09 » (faux rouge du 30/09/2026).
  const [{ n }] = await sql(`select count(*)::int as n from profiles p join auth.users u on u.id = p.id
    where p.role = 'prestataire' and p.accuse_inscription_at is null and u.created_at < '2026-09-29'`);
  expect(n, "aucun inscrit d'avant le 29/09 à prévenir").toBe(0);
});

// Le back-office le dit, sans ouvrir la base (30/09/2026).
test("la fiche du back-office dit si l'accusé est parti", async ({ page }) => {
  const attente = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765434", metier: "Serveur(se)", secteur: "hotellerie" } });
  const parti = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765435", metier: "Serveur(se)", secteur: "hotellerie" } });
  await sql(`update profiles set accuse_inscription_at = '2026-09-30T08:15:00Z' where id = '${parti.id}'`);

  await connexionBO(page);
  await ficheBO(page, attente.email, "⏳ En attente");
  await expect(page.getByText(/Accusé d'inscription pas encore envoyé — nouvel essai automatique/)).toBeVisible();
  await page.getByPlaceholder(/Rechercher par email/).fill(parti.email);
  await expect(page.getByText(parti.email)).toBeVisible();
  await expect(page.getByText("📧 Accusé d'inscription envoyé le 30/09 10:15")).toBeVisible();
});
