// Pas de facture pour une prestation qui n'a pas eu lieu (relecture du 30/09/2026).
// Rien ne le vérifiait : une prestation annulée recevait un numéro de la séquence,
// définitif puisque la numérotation doit être continue.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("annulée : pas de facture ; réalisée : facture ; déjà numérotée : toujours consultable", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });

  await sql(`update missions set status = 'cancelled' where id = '${m.id}'`);
  const refus = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(refus.statut, refus.texte.slice(0, 200)).toBe(409);

  await sql(`update missions set status = 'completed' where id = '${m.id}'`);
  const ok = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  // Une facture émise ne disparaît pas : remboursée après coup, elle reste lisible.
  await sql(`update missions set status = 'closed', invoice_number = 'FAC-RECETTE-${Date.now()}' where id = '${m.id}'`);
  const encore = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(encore.statut).toBe(200);
});
