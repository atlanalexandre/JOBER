// Réessayer un paiement après avoir coché « mémoriser ma carte » (30/09/2026).
// La clé d'idempotence ne portait que le montant : la seconde tentative, aux
// paramètres différents, était refusée par Stripe jusqu'au lendemain.
import { test, expect } from "@playwright/test";
import { client, prestataireOperationnel, creerPrestationBrute, api } from "./fabrique.js";
test.describe.configure({ timeout: 180_000 });
test("paiement préparé, puis repréparé avec « mémoriser ma carte » : accepté", async () => {
  await prestataireOperationnel();
  const c = await client();
  const id = crypto.randomUUID();
  await creerPrestationBrute(c, { id });
  const a = await api("/api/stripe-intent", { mission_id: id }, c.jeton);
  expect(a.statut, a.texte.slice(0, 200)).toBe(200);
  const b = await api("/api/stripe-intent", { mission_id: id, memoriser: true }, c.jeton);
  expect(b.statut, b.texte.slice(0, 200)).toBe(200);
  // Double clic : le même paiement, pas un second.
  const b2 = await api("/api/stripe-intent", { mission_id: id, memoriser: true }, c.jeton);
  expect(b2.json?.intentId).toBe(b.json?.intentId);
});
