// Prolongation d'une prestation : quel paiement la règle (audit des prestations, 01/10/2026).
//
// `confirmer_heures_supp` ne contrôlait que la prestation désignée par le paiement.
// Le paiement de la RÉSERVATION — même prestation, montant bien supérieur — réglait
// donc n'importe quelle prolongation : des heures ajoutées, payées au prestataire,
// sans que le client ait rien versé de plus.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("le paiement de la réservation ne règle pas une prolongation", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // Le prestataire a accepté 2 h supplémentaires : la prolongation attend son paiement.
  await sql(`update missions set extra_hours_requested = 2, extra_hours_tarif = 13, extra_hours_status = 'accepte_presta' where id = '${m.id}'`);

  const r = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: m.paymentIntent }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(400);
  const [l] = await sql(`select hours, extra_hours_status from missions where id = '${m.id}'`);
  expect(Number(l.hours), "aucune heure ajoutée").toBe(4);
  expect(l.extra_hours_status).toBe("accepte_presta");
});
