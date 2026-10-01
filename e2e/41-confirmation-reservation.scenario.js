// Courriel de confirmation de réservation (audit du domaine « comptes », 01/10/2026).
//
// Le destinataire et tout le contenu venaient de la requête : n'importe quel compte
// connecté pouvait faire envoyer, sous la marque ALANE, un courriel au texte de son
// choix à l'adresse de son choix. Le serveur ne lit plus que l'identifiant de la
// prestation, qui doit appartenir à l'appelant, et écrit à l'adresse de son compte.
import { test, expect } from "@playwright/test";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("le contenu et le destinataire ne se choisissent plus depuis le navigateur", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const intrus = await client();
  const m = await reservationPayee({ prestataire: p, client: c });

  const forge = await api("/api/support", { action: "booking_confirm", clientEmail: "victime@exemple.fr",
    clientName: "Victime", prestaName: "Texte libre", total: 1 }, intrus.jeton);
  expect(forge.statut, "sans prestation désignée, rien ne part").toBe(400);

  const autrui = await api("/api/support", { action: "booking_confirm", mission_id: m.id }, intrus.jeton);
  expect(autrui.statut, "la prestation d'un autre client").toBe(403);

  const sienne = await api("/api/support", { action: "booking_confirm", mission_id: m.id }, c.jeton);
  expect(sienne.statut, sienne.texte.slice(0, 200)).toBe(200);
});
