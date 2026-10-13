// Notifications : seuls les services des navigateurs, et un bouton de test
// (14/10/2026).
//
// Le 13/10/2026, un faux « téléphone » a pu être inscrit en recette : toute
// adresse en https était acceptée, et le serveur y envoyait ensuite chaque
// notification du compte. N'importe quel compte pouvait ainsi faire envoyer,
// par le serveur d'ALANE, des requêtes vers le site de son choix.
//
// Et personne ne pouvait savoir si son téléphone recevait : une notification
// qui n'arrive pas ne prévient de rien. Les Réglages ont désormais une ligne
// « Notification de test ».
//
// Aucun service de notification réel n'est joignable depuis l'environnement de
// recette : l'appareil est simulé, avec une adresse Google qui n'existe pas.
// Google répond donc par un refus — ce qui suffit à prouver que le serveur a
// signé, chiffré et envoyé, et que l'écran rend compte de la réponse.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, prestataireOperationnel, api } from "./fabrique.js";
import { connexion } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function clesAppareil() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
}
const appareilsDe = (id) => sql(`select endpoint from push_subscriptions where user_id = '${id}' order by created_at`);

test("seuls les services des navigateurs sont acceptés, et le test rend leur réponse", async () => {
  const c = await client();
  const cles = await clesAppareil();
  try {
    for (const endpoint of [
      `https://httpbin.org/status/410?recette=${c.id}`,
      `https://fcm.googleapis.com.exemple.fr/fcm/send/${c.id}`,
      `http://fcm.googleapis.com/fcm/send/${c.id}`,
    ]) {
      const r = await api("/api/missions", { action: "push_subscribe", subscription: { endpoint, keys: cles } }, c.jeton);
      expect(r.statut, `${endpoint} : ${r.texte.slice(0, 120)}`).toBe(400);
      expect(r.json?.error).toBe("Service de notification non reconnu");
    }
    expect(await appareilsDe(c.id)).toHaveLength(0);

    // Un appareil Google (qui n'existe pas), inscrit deux fois : une seule ligne.
    const google = `https://fcm.googleapis.com/fcm/send/recette-${crypto.randomUUID()}`;
    for (let i = 0; i < 2; i++) {
      const r = await api("/api/missions", { action: "push_subscribe", subscription: { endpoint: google, keys: cles } }, c.jeton);
      expect(r.statut, r.texte.slice(0, 200)).toBe(200);
    }
    expect(await appareilsDe(c.id)).toHaveLength(1);

    // Un abonnement inscrit AVANT la règle, vers un site quelconque : le
    // serveur ne doit plus jamais le contacter. Le site choisi répond 410, ce
    // qui ferait retirer la ligne s'il était contacté.
    const ancien = `https://httpbin.org/status/410?recette=${c.id}`;
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${c.id}', '${ancien}', '${cles.p256dh}', '${cles.auth}')`);

    const debut = Date.now();
    const t = await api("/api/missions", { action: "push_test" }, c.jeton);
    const duree = Date.now() - debut;
    expect(t.statut, t.texte.slice(0, 300)).toBe(200);
    console.log("[73] bilan :", JSON.stringify(t.json), `${duree} ms`);
    expect(duree, "le départ attend cinq secondes").toBeGreaterThanOrEqual(5000);
    expect(t.json.appareils).toBe(2);
    expect(t.json.echecs).toContainEqual({ service: "httpbin.org", raison: "service de notification non reconnu" });
    // L'appareil Google a bien été contacté : sa réponse figure au bilan.
    const google_ = (t.json.acceptes || 0) + (t.json.expires || 0) + t.json.echecs.filter(e => e.service === "fcm.googleapis.com").length;
    expect(google_, "réponse de Google au bilan").toBe(1);
    expect(JSON.stringify(t.json)).not.toContain("recette-");
    // L'ancien abonnement est toujours là : il n'a pas été contacté.
    expect((await appareilsDe(c.id)).map(a => a.endpoint)).toContain(ancien);

    // Sans compte, rien.
    const anonyme = await api("/api/missions", { action: "push_test" });
    expect(anonyme.statut).toBe(401);
  } finally {
    await sql(`delete from push_subscriptions where user_id = '${c.id}'`);
  }
});

test.describe("Réglages", () => {
  test.use({ permissions: ["notifications"] });

  test("la ligne « Notification de test » envoie et rend compte", async ({ page }) => {
    const p = await prestataireOperationnel();
    // L'appareil simulé : le navigateur de recette n'a pas de service de
    // notification. Ses clés sont de vraies clés, pour que le serveur puisse
    // chiffrer.
    const google = `https://fcm.googleapis.com/fcm/send/recette-${crypto.randomUUID()}`;
    await page.addInitScript(({ id, endpoint }) => {
      try { localStorage.setItem(`alane_onboarded_${id}`, "1"); localStorage.setItem(`alane_presta_tour_done_${id}`, "1"); }
      catch { /* stockage indisponible : les fenêtres d'accueil s'afficheront */ }
      const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      let abonnement = null;
      const creer = async () => {
        const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        const p256dh = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
        const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
        return { endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => { abonnement = null; return true; } };
      };
      if (window.PushManager) {
        PushManager.prototype.getSubscription = async () => abonnement;
        PushManager.prototype.subscribe = async () => (abonnement = await creer());
      }
    }, { id: p.id, endpoint: google });
    await page.addLocatorHandler(page.getByText("Autoriser la géolocalisation", { exact: false }), () => page.getByRole("button", { name: "Annuler", exact: true }).click());
    try {
      await connexion(page, { espace: "prestataire", email: p.email });
      await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
      const nav = page.locator('nav[aria-label="Navigation prestataire"]');
      await nav.getByText("Profil", { exact: true }).click();
      await page.getByRole("button", { name: /Réglages/ }).first().click();

      await expect(page.getByText("Activées", { exact: true })).toBeVisible({ timeout: 20_000 });
      const ligne = page.getByText("Notification de test", { exact: true });
      await expect(ligne).toBeVisible();
      const reponse = page.waitForResponse(r => r.url().includes("/api/missions") && (r.request().postData() || "").includes('"push_test"'), { timeout: 60_000 });
      await ligne.click();
      await expect(page.getByText(/Départ dans 5 secondes/).first()).toBeVisible();
      const bilan = await (await reponse).json();
      console.log("[73] bilan depuis l'écran :", JSON.stringify(bilan));
      // L'appareil de cet écran a été inscrit, puis contacté : sa réponse est au bilan.
      expect(bilan.appareils).toBe(1);
      expect((bilan.acceptes || 0) + (bilan.expires || 0) + bilan.echecs.length).toBe(1);
      expect(bilan.echecs.map(e => e.raison)).not.toContain("service de notification non reconnu");
      await expect(page.getByText(/Notification envoyée|L'envoi a échoué|enregistré/).first()).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: "e2e-resultats/captures/73-notification-test.png" });
    } finally {
      await sql(`delete from push_subscriptions where user_id = '${p.id}'`);
    }
  });
});
