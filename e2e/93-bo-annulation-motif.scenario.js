// Back-office : annuler une prestation payée avec un motif (décision D6
// d'Alexandre, 14/10/2026). Le motif saisi REMPLAÇAIT le message envoyé au
// client, qui perdait l'annonce de son remboursement ; il s'y ajoute désormais.
// Les confirmations de l'écran sont éprouvées par
// `src/tests/backoffice-confirmations.test.js`.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, bo, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("annulation avec motif : le client lit son remboursement ET le motif", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });

  const r = await bo("cancel_mission", { mission_id: m.id, refund: true, reason: "Scénario 93" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [n] = await sql(`select body from notifications where user_id = '${c.id}' and title = 'Prestation annulée' order by created_at desc limit 1`);
  expect(n?.body, "le remboursement est annoncé").toMatch(/intégralement remboursé, sous 5 à 10 jours ouvrés/);
  expect(n?.body, "le motif est ajouté").toMatch(/Motif : Scénario 93$/);
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse, "le client est bien remboursé").toBe(s.preleve);
});
