// Back-office : valider d'un coup le PROFIL de tous les prestataires en attente
// (demande d'Alexandre, 29/09/2026). Ils entrent dans leur espace pour déposer leurs
// documents ; l'accès aux prestations, lui, reste fermé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { inscrire } from "./fabrique.js";
import { connexionBO, confirmer } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

test("un clic valide tous les profils prestataires en attente, sans ouvrir les prestations", async ({ page }) => {
  const a = await inscrire({ role: "prestataire", prenom: "Enattente", metadonnees: { telephone: "0698765432", metier: "Femme/Valet de chambre", secteur: "hotellerie" } });
  const b = await inscrire({ role: "prestataire", prenom: "Enattente", metadonnees: { telephone: "0698765433", metier: "Serveur(se)", secteur: "hotellerie" } });
  for (const p of [a, b]) {
    const [l] = await sql(`select status from profiles where id = '${p.id}'`);
    expect(l.status, "inscrit en attente").toBe("pending");
  }

  await connexionBO(page);
  await page.getByRole("button", { name: /✅ Comptes/ }).first().click();
  const bouton = page.getByRole("button", { name: /Valider le profil des \d+ prestataire\(s\) en attente/ });
  await expect(bouton).toBeVisible({ timeout: 30_000 });
  await bouton.click();
  await confirmer(page);
  await expect(page.getByText(/profil\(s\) prestataire validé\(s\)/)).toBeVisible({ timeout: 180_000 });

  for (const p of [a, b]) {
    const [l] = await sql(`select status, missions_enabled from profiles where id = '${p.id}'`);
    expect(l.status, "profil validé").toBe("approved");
    expect(l.missions_enabled, "accès aux prestations toujours fermé").not.toBe(true);
  }
});
