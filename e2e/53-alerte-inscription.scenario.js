// Alerte « nouvelle inscription » envoyée à la direction (audit « sécurité », 01/10/2026).
//
// Le nom, l'adresse et le rôle venaient de la requête, et rien n'empêchait de
// recommencer : n'importe quel compte pouvait inonder la direction d'alertes au
// contenu de son choix. Désormais : identité lue en base, une alerte par compte.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, api } from "./fabrique.js";

test.describe.configure({ timeout: 120_000 });

test("un compte déjà signalé ne déclenche plus d'alerte, quoi que dise la requête", async () => {
  const c = await client();
  // Le service d'e-mail de la recette refuse l'envoi : l'alerte déjà partie est posée à la main.
  await sql(`update profiles set alerte_inscription_at = now() where id = '${c.id}'`);
  const faux = { action: "notify_signup", prenom: "Faux", nom: "Nom", email: "victime@exemple.fr", role: "prestataire" };
  const r = await api("/api/support", faux, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json?.deja, "rien n'est renvoyé à la direction").toBe(true);
});
