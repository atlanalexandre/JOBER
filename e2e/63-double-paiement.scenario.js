// Une réservation déjà payée n'accepte pas un second paiement (relecture du 04/10/2026).
//
// En revenant sur l'écran de paiement, le client pouvait payer une seconde fois :
// le webhook du second paiement écrasait la trace du premier — qui n'était plus
// jamais remboursé — et passait la prestation « acceptée » sans réponse du
// prestataire.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("payée : une nouvelle demande de paiement est refusée", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const [avant] = await sql(`select status, stripe_payment_intent from missions where id = '${m.id}'`);
  expect(avant.status).toBe("pending_acceptance");

  const r = await api("/api/stripe-intent", { amount: m.montant, currency: "eur", mission_id: m.id, metadata: { prestataire: p.id } }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  expect(r.json?.code).toBe("deja_payee");
  expect(r.json?.clientSecret, "aucun second paiement créé").toBeFalsy();
  const [apres] = await sql(`select stripe_payment_intent from missions where id = '${m.id}'`);
  expect(apres.stripe_payment_intent, "le paiement d'origine reste rattaché").toBe(avant.stripe_payment_intent);
});
