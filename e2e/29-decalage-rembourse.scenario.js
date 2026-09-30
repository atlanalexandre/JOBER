// Démarrage décalé : les heures non faites reviennent au client (audit du 30/09/2026).
//
// Mesuré sur la Preview avant correction : 110,98 € payés pour 8 h, décalage d'une
// heure refusé, 7 h facturées, prestataire payé 91 €, 0 € rendu au client — les 13 €
// de l'heure non faite restaient à ALANE, présentés comme des frais de service.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function prestationDemarreeEnRetard() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // Une heure de retard au démarrage, fin de prestation confirmée par le prestataire.
  await sql(`update missions set started_at = now(), arrival_delay_minutes = 60, delay_status = 'pending', validation_prestataire = true where id = '${m.id}'`);
  const [l] = await sql(`select montant_total, tarif_horaire, hours from missions where id = '${m.id}'`);
  return { p, c, m, prix: Number(l.montant_total), tarif: Number(l.tarif_horaire), heures: Number(l.hours) };
}

test("décalage refusé : l'heure non faite est remboursée, les frais restent ceux d'origine", async () => {
  const { c, m, prix, tarif, heures } = await prestationDemarreeEnRetard();
  const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  expect(d.json?.rembourse).toBe(tarif);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "une heure rendue à la carte").toBe(Math.round(tarif * 100));

  // Réponse en double : rien de plus.
  const d2 = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d2.statut).toBe(400);

  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select montant_total, payout_amount from missions where id = '${m.id}'`);
  expect(Number(l.payout_amount)).toBe(tarif * (heures - 1));
  const fraisOrigine = Math.round((prix - tarif * heures) * 100) / 100;
  expect(Math.round((Number(l.montant_total) - Number(l.payout_amount)) * 100) / 100, "frais de service inchangés").toBe(fraisOrigine);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "la validation ne rembourse pas une seconde fois").toBe(Math.round(tarif * 100));
});

test("décalage jamais arbitré : la clôture plafonne les heures ET rembourse le client", async () => {
  const { c, m, tarif, heures } = await prestationDemarreeEnRetard();
  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select payout_amount, actual_hours from missions where id = '${m.id}'`);
  expect(Number(l.payout_amount)).toBe(tarif * (heures - 1));
  expect(Number(l.actual_hours), "les heures facturées sont celles faites (la facture les lit)").toBe(heures - 1);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "une heure rendue à la carte").toBe(Math.round(tarif * 100));
});
