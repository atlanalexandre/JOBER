// La validation automatique ne clôture pas une prestation sans paiement
// (relecture du 04/10/2026).
//
// Elle programmait le virement au prestataire et créditait le cashback du client
// sur une prestation qu'aucun client n'avait réglée. `complete` et le back-office
// refusaient déjà ce cas ; la tâche planifiée, non.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("terminée depuis deux jours, sans paiement : ni validée ni versée", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const avantHier = new Date(Date.now() - 2 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  // Une prestation attribuée sans paiement (affectation manuelle d'une demande non payée).
  await sql(`update missions set stripe_payment_intent = null, date = '${avantHier}', date_debut = '${avantHier}',
             date_fin = '${avantHier}', heure_debut = '09:00' where id = '${m.id}'`);

  const r = await tachePlanifiee();
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status, payout_status, cashback_credited from missions where id = '${m.id}'`);
  expect(l.status, "pas clôturée").toBe("assigned");
  expect(l.payout_status, "aucun versement programmé").toBeNull();
});
