// Prolongation : refus tardif et prestation close (audit des prestations, 01/10/2026).
//
// 1. Le prestataire pouvait « refuser » une prolongation qu'il avait déjà chiffrée,
//    pendant que le client la réglait : le paiement, arrivé juste après, ne
//    s'appliquait plus — client débité, aucune heure en plus.
// 2. Une prolongation réglée sur une prestation close entre-temps rallongeait
//    quand même ce qui était terminé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, confirmerPaiement, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

async function prolongationChiffree() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set extra_hours_requested = 2, extra_hours_tarif = 13, extra_hours_status = 'accepte_presta' where id = '${m.id}'`);
  return { p, c, m };
}

test("une prolongation chiffrée ne se refuse plus pendant que le client paie", async () => {
  const { p, c, m } = await prolongationChiffree();
  const intent = await api("/api/stripe-intent", { mode: "supplement", mission_id: m.id, currency: "eur" }, c.jeton);
  expect(intent.statut, intent.texte.slice(0, 200)).toBe(200);
  const refus = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "refuse" }, p.jeton);
  expect(refus.statut, refus.texte.slice(0, 200)).toBe(409);
  const pay = await confirmerPaiement(intent.json.clientSecret);
  expect(pay.statut, pay.erreur || "").toBe("succeeded");
  const conf = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: pay.paymentIntent }, c.jeton);
  expect(conf.statut, conf.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select hours from missions where id = '${m.id}'`);
  expect(Number(l.hours), "le client a payé : les heures sont ajoutées").toBe(6);
});

test("une prolongation réglée sur une prestation close est remboursée, pas appliquée", async () => {
  const { c, m } = await prolongationChiffree();
  const intent = await api("/api/stripe-intent", { mode: "supplement", mission_id: m.id, currency: "eur" }, c.jeton);
  expect(intent.statut, intent.texte.slice(0, 200)).toBe(200);
  const pay = await confirmerPaiement(intent.json.clientSecret);
  expect(pay.statut, pay.erreur || "").toBe("succeeded");
  // Entre le paiement et sa confirmation, la prestation est close.
  await sql(`update missions set status = 'completed' where id = '${m.id}'`);
  const conf = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: pay.paymentIntent }, c.jeton);
  expect(conf.statut, conf.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select hours from missions where id = '${m.id}'`);
  expect(Number(l.hours), "rien d'ajouté").toBe(4);
  const s = await paiementStripe(pay.paymentIntent);
  expect(s.rembourse, "le complément est rendu").toBe(s.preleve);
});
