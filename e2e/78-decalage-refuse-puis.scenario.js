// Décalage refusé, PUIS interruption ou prolongation : l'heure non faite n'est
// rendue qu'une fois (relecture du 14/10/2026).
//
// Depuis le 13/10/2026, un décalage refusé sur une journée inscrit la durée
// retenue dans `actual_hours` et laisse `hours` — la durée réservée — intacte.
// Deux actions lisaient encore `hours` :
//   - l'interruption en cours rendait au client, une seconde fois, l'heure déjà
//     remboursée, tout en payant au prestataire les heures faites ;
//   - une prolongation payée remettait `actual_hours` à vide : la clôture
//     payait au prestataire l'heure déjà rendue au client.
// Dans les deux cas, ALANE versait plus qu'elle n'avait encaissé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api, confirmerPaiement } from "./fabrique.js";
import { montantsDeCloture } from "../api/_cloture.js";

test.describe.configure({ timeout: 240_000 });

const PARIS = { timeZone: "Europe/Paris" };
const centimes = (e) => Math.round(e * 100);

/** Prestation acceptée, démarrée avec une heure de retard, décalage refusé. */
async function decalageRefuse({ heures }) {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now(), arrival_delay_minutes = 60, delay_status = 'pending' where id = '${m.id}'`);
  const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select montant_total, tarif_horaire, hours, actual_hours from missions where id = '${m.id}'`);
  expect(Number(l.actual_hours)).toBe(heures - 1);
  return { p, c, m, prix: Number(l.montant_total), tarif: Number(l.tarif_horaire) };
}

test("décalage refusé puis interruption : l'heure non faite n'est rendue qu'une fois", async () => {
  // L'interruption compte les heures depuis l'heure de début du jour : il en faut
  // trois derrière nous, aujourd'hui.
  const heureParis = Number(new Date().toLocaleTimeString("fr-FR", { ...PARIS, hour: "2-digit", hour12: false }));
  test.skip(heureParis < 5, "il faut quatre heures écoulées depuis minuit, heure de Paris");

  const { c, m, prix, tarif } = await decalageRefuse({ heures: 8 });
  expect((await paiementStripe(m.paymentIntent)).rembourse, "l'heure de retard rendue").toBe(centimes(tarif));

  // Début prévu il y a 3 h 50, démarrage réel une heure plus tard, il y a 2 h 50 :
  // 3 h dues (arrondi à l'heure supérieure). L'heure de retard n'est pas du
  // travail fait — elle a été rendue au refus (étude d'octobre 2026, `e2e/81`).
  const debut = new Date(Date.now() - 230 * 60000);
  await sql(`update missions set date = '${debut.toLocaleDateString("fr-CA", PARIS)}', `
    + `heure_debut = '${debut.toLocaleTimeString("fr-FR", { ...PARIS, hour: "2-digit", minute: "2-digit" })}', `
    + `started_at = now() - interval '170 minutes' where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);

  // 8 h réservées, 1 h de retard rendue, 3 h faites : 4 h rendues en plus — l'heure
  // de retard ne l'est pas une seconde fois, ni facturée comme faite.
  const rendu = (await paiementStripe(m.paymentIntent)).rembourse;
  expect(rendu, "1 h de retard + 4 h non faites").toBe(centimes(5 * tarif));

  const [f] = await sql(`select * from missions where id = '${m.id}'`);
  expect(Number(f.actual_hours), "la durée retenue reste celle après décalage").toBe(7);
  const cloture = montantsDeCloture(f);
  expect(cloture.partPrestataire, "3 h versées").toBe(3 * tarif);
  // Rien ne sort qu'ALANE n'ait encaissé : versé + rendu ≤ payé.
  expect(centimes(cloture.partPrestataire) + rendu).toBeLessThanOrEqual(centimes(prix));
});

test("décalage refusé puis prolongation payée : la réduction reste", async () => {
  const { p, c, m, tarif } = await decalageRefuse({ heures: 4 });

  await sql(`update missions set extra_hours_requested = 1, extra_hours_status = 'pending' where id = '${m.id}'`);
  const a = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "accept", tarif_horaire: 20 }, p.jeton);
  expect(a.statut, a.texte.slice(0, 200)).toBe(200);
  const i = await api("/api/stripe-intent", { mode: "supplement", mission_id: m.id, currency: "eur" }, c.jeton);
  expect(i.statut, i.texte.slice(0, 200)).toBe(200);
  const pay = await confirmerPaiement(i.json.clientSecret);
  expect(pay.statut).toBe("succeeded");
  const conf = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: pay.paymentIntent }, c.jeton);
  expect(conf.statut, conf.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select hours, actual_hours from missions where id = '${m.id}'`);
  expect(Number(l.hours), "durée réservée + 1 h").toBe(5);
  expect(Number(l.actual_hours), "durée retenue + 1 h : l'heure de retard reste retirée").toBe(4);

  // Clôture : 3 h au tarif de base + 1 h au tarif de la prolongation.
  await sql(`update missions set started_at = now() - interval '5 hours', validation_prestataire = true where id = '${m.id}'`);
  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const [f] = await sql(`select payout_amount from missions where id = '${m.id}'`);
  expect(Number(f.payout_amount), "l'heure de retard, déjà rendue au client, n'est pas versée").toBe(3 * tarif + 20);
});
