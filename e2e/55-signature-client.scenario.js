// La signature du contrat par le client est enregistrée (audit « sécurité », 01/10/2026).
//
// L'écran de réservation fait signer le contrat avant le paiement, mais la date restait
// dans le navigateur : `contrat_client_signe_at` n'était écrit par personne — 0 sur 884
// prestations payées en recette. Elle est posée par le serveur, au paiement.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("une réservation payée porte la date de signature du client, à l'heure du serveur", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const avant = Date.now();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const [l] = await sql(`select contrat_client_signe_at from missions where id = '${m.id}'`);
  expect(l.contrat_client_signe_at, "signature enregistrée").toBeTruthy();
  expect(new Date(l.contrat_client_signe_at).getTime()).toBeGreaterThanOrEqual(avant - 60_000);
});
