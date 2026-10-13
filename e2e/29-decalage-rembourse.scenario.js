// Démarrage décalé : les heures non faites reviennent au client (audit du 30/09/2026).
//
// Mesuré sur la Preview avant correction : 110,98 € payés pour 8 h, décalage d'une
// heure refusé, 7 h facturées, prestataire payé 91 €, 0 € rendu au client — les 13 €
// de l'heure non faite restaient à ALANE, présentés comme des frais de service.
import { test, expect } from "@playwright/test";
import { sql, appelApi } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function prestationDemarreeEnRetard(retardMinutes = 60) {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // Une heure de retard au démarrage, fin de prestation confirmée par le prestataire.
  await sql(`update missions set started_at = now(), arrival_delay_minutes = ${retardMinutes}, delay_status = 'pending', validation_prestataire = true where id = '${m.id}'`);
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

// Étude du 13/10/2026 : `hours` est une colonne ENTIÈRE. Un retard qui n'est pas un
// nombre rond d'heures (20 min → 7,67 h) y faisait écrire une valeur que la base
// refuse : la réponse du client échouait toujours (« n'a pas pu être enregistrée »),
// et le seul cas éprouvé jusqu'ici était un retard d'une heure pile.
test("décalage de 20 minutes refusé : la réponse est enregistrée, 20 minutes rendues", async () => {
  const { c, m, tarif, heures } = await prestationDemarreeEnRetard(20);
  const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const rendu = Math.round(tarif * 20 / 60 * 100) / 100;
  expect(d.json?.rembourse).toBe(rendu);
  expect((await paiementStripe(m.paymentIntent)).rembourse).toBe(Math.round(rendu * 100));
  const [l] = await sql(`select hours, actual_hours, delay_status from missions where id = '${m.id}'`);
  expect(l.delay_status).toBe("rejected");
  expect(Number(l.hours), "la durée réservée ne change pas").toBe(heures);
  expect(Number(l.actual_hours)).toBeCloseTo(heures - 20 / 60, 2);

  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const [f] = await sql(`select payout_amount from missions where id = '${m.id}'`);
  expect(Number(f.payout_amount)).toBeCloseTo(tarif * (heures - 20 / 60), 1);

  // La facture du prestataire porte ce qui lui est versé.
  const t = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  const facture = await appelApi(`/api/invoice?mission_id=${m.id}&token=${encodeURIComponent(t.json.token)}`);
  expect(facture.statut).toBe(200);
  expect(facture.texte).toContain(`${Number(f.payout_amount).toFixed(2).replace(".", ",")}\u00a0€`);
});
