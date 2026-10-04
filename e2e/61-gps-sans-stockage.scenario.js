// Suivi GPS du prestataire quand le navigateur refuse d'enregistrer l'accord
// (navigation privée) — relecture du 03/10/2026.
//
// Et la question elle-même s'affichait par-dessus le guide des onglets quand le
// prestataire avait déjà une prestation acceptée à sa première connexion.
//
// Depuis que la question n'est posée qu'avec une prestation acceptée (#973), le
// suivi ne démarrait qu'après relecture du stockage local : là où l'écriture est
// refusée, le « oui » restait sans effet et le client ne voyait jamais
// l'arrivée du prestataire.
import { test, expect } from "@playwright/test";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";
import { connexion } from "./parcours.js";

test.describe.configure({ timeout: 200_000 });

test("après « Confirmer », la position part même si le stockage refuse l'accord", async ({ browser }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  const contexte = await browser.newContext({ geolocation: { latitude: 48.8566, longitude: 2.3522 }, permissions: ["geolocation"] });
  // Navigation privée simulée : l'accord GPS ne peut pas être enregistré.
  await contexte.addInitScript(() => {
    const ecrire = Storage.prototype.setItem;
    Storage.prototype.setItem = function (cle, valeur) {
      if (String(cle).startsWith("alane_gps_consent")) throw new Error("QuotaExceededError (navigation privée simulée)");
      return ecrire.call(this, cle, valeur);
    };
  });
  const page = await contexte.newPage();
  const position = page.waitForRequest(
    (r) => r.url().includes("/api/missions") && (r.postData() || "").includes('"update_position"'),
    { timeout: 120_000 });
  await connexion(page, { espace: "prestataire", email: p.email });
  const question = page.getByText("Autoriser la géolocalisation", { exact: false });
  // Une fenêtre à la fois : l'accueil, puis le guide, puis seulement la question.
  await page.getByText("Passer le tutoriel").click({ timeout: 60_000 });
  await expect(page.getByText("Passer le guide")).toBeVisible({ timeout: 15_000 });
  await expect(question, "pas par-dessus le guide").toHaveCount(0);
  await page.getByText("Passer le guide").click();
  await expect(question).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await position;
  await contexte.close();
});
