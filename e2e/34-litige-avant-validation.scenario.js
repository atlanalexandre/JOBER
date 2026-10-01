// Litige ouvert avant la validation, tranché « verser au prestataire » (30/09/2026).
// Le montant et l'échéance du versement n'avaient jamais été fixés : le versement
// repartait sans eux, et le traitement des versements ne le reprenait jamais.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, bo, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("contestée avant validation, puis versée : montant et échéance fixés", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now() - interval '9 hours', validation_prestataire = true where id = '${m.id}'`);

  const d = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);

  const r = await bo("executer_decision", { mission_id: m.id, resolution: "verser_prestataire", cause: "justice", justification: "Recette — décision de test" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status, payout_status, payout_amount, payout_due_at from missions where id = '${m.id}'`);
  expect(l.status).toBe("completed");
  expect(l.payout_status).toBe("pending");
  expect(Number(l.payout_amount), "la part du prestataire : 8 h à 13 €").toBe(104);
  expect(l.payout_due_at, "une échéance, sans quoi le versement n'est jamais repris").not.toBeNull();
});

test("décalage d'une heure jamais arbitré, puis versée : 7 h payées, l'heure retirée rendue au client", async () => {
  // Relecture du 01/10/2026 : ce chemin payait les heures réduites sans rendre au
  // client la différence, qui restait chez ALANE.
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now() - interval '9 hours', validation_prestataire = true,
             delay_status = 'pending', arrival_delay_minutes = 60 where id = '${m.id}'`);

  const d = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const r = await bo("executer_decision", { mission_id: m.id, resolution: "verser_prestataire", cause: "justice", justification: "Recette — décision de test" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select payout_amount, actual_hours from missions where id = '${m.id}'`);
  expect(Number(l.payout_amount), "7 h faites à 13 €").toBe(91);
  expect(Number(l.actual_hours)).toBe(7);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "l'heure non faite, 13 €, est rendue au client").toBe(1300);
});
