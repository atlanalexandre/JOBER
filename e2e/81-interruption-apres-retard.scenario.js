// Interrompre une prestation qui a commencé EN RETARD (étude d'octobre 2026, domaine
// « argent »).
//
// L'interruption compte les heures faites depuis l'heure de début PRÉVUE. Quand le
// prestataire a commencé une heure plus tard, cette heure était comptée comme faite :
//   - décalage accepté par le client : il payait une heure que personne n'avait faite ;
//   - décalage refusé : l'heure, rendue au refus, était de nouveau facturée ;
//   - décalage jamais arbitré : la prestation était close sans que l'heure retirée lui
//     soit rendue — les cinq autres clôtures la rendent (api/_decalage.js).
// Ici : 8 h réservées, début prévu il y a 3 h 50, démarrage réel il y a 2 h 50 — 3 h dues
// (arrondi à l'heure supérieure, au bénéfice du prestataire).
// Attendu dans les trois cas : le client paie 3 h et les frais, le prestataire reçoit 3 h.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api } from "./fabrique.js";
import { montantsDeCloture } from "../api/_cloture.js";

test.describe.configure({ timeout: 240_000 });

const PARIS = { timeZone: "Europe/Paris" };
const centimes = (e) => Math.round(Number(e) * 100);

async function commenceeEnRetard(arbitrage) {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 8 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  const debut = new Date(Date.now() - 230 * 60000);
  await sql(`update missions set date = '${debut.toLocaleDateString("fr-CA", PARIS)}', `
    + `heure_debut = '${debut.toLocaleTimeString("fr-FR", { ...PARIS, hour: "2-digit", minute: "2-digit" })}', `
    + `started_at = now() - interval '170 minutes', arrival_delay_minutes = 60, delay_status = 'pending' where id = '${m.id}'`);
  if (arbitrage) {
    const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: arbitrage }, c.jeton);
    expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  }
  const [l] = await sql(`select montant_total, tarif_horaire from missions where id = '${m.id}'`);
  const prix = Number(l.montant_total), tarif = Number(l.tarif_horaire);
  return { c, m, prix, tarif, frais: Math.round((prix - 8 * tarif) * 100) / 100 };
}

for (const [cas, arbitrage] of [["jamais arbitré", null], ["accepté", "approved"], ["refusé", "rejected"]]) {
  test(`décalage ${cas}, puis interruption : 3 h payées, 3 h versées`, async () => {
    const heureParis = Number(new Date().toLocaleTimeString("fr-FR", { ...PARIS, hour: "2-digit", hour12: false }));
    test.skip(heureParis < 5, "il faut quatre heures écoulées depuis minuit, heure de Paris");

    const { c, m, prix, tarif, frais } = await commenceeEnRetard(arbitrage);
    const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id }, c.jeton);
    expect(r.statut, r.texte.slice(0, 300)).toBe(200);

    const rendu = (await paiementStripe(m.paymentIntent)).rembourse;
    expect(rendu, "rendu au client : les 5 h non faites").toBe(centimes(5 * tarif));
    const [f] = await sql(`select * from missions where id = '${m.id}'`);
    expect(Number(f.payout_amount), "versé au prestataire : 3 h").toBe(3 * tarif);
    expect(montantsDeCloture(f).partPrestataire).toBe(3 * tarif);
    // Le compte tombe juste : rendu + versé + frais = payé.
    expect(rendu + centimes(f.payout_amount) + centimes(frais)).toBe(centimes(prix));
  });
}
