// Décalage refusé, puis démarrage plus tardif encore (étude du 14/10/2026).
//
// Le démarrage rouvrait la question au client avec le retard TOTAL. Accepté, le
// décalage effaçait la réduction déjà rendue : le prestataire était payé pour
// des minutes remboursées au client. Refusé de nouveau, le retard total était
// retiré une seconde fois, avec la même clé Stripe et un autre montant.
// Désormais : la question n'est pas reposée, seul l'écart est déduit et rendu.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const PARIS = { timeZone: "Europe/Paris" };
const heureParis = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { ...PARIS, hour: "2-digit", minute: "2-digit" });

test("décalage refusé puis démarrage encore plus tard : l'écart est rendu, rien n'est rouvert", async () => {
  test.skip(Number(heureParis(Date.now()).slice(0, 2)) < 1, "il faut une heure écoulée depuis minuit, heure de Paris");
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4, tarif: 15 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  // Arrivée 20 minutes après l'heure prévue ; le client refuse de décaler la fin.
  const jour = new Date().toLocaleDateString("fr-CA", PARIS);
  await sql(`update missions set date = '${jour}', heure_debut = '${heureParis(Date.now() - 20 * 60000)}', arrived_at = now(),
      arrival_delay_minutes = 20, delay_status = 'pending' where id = '${m.id}'`);
  const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  console.log("[85] refus :", d.texte.slice(0, 300));
  expect((await paiementStripe(m.paymentIntent)).rembourse, "20 minutes rendues").toBe(500);

  // Vingt minutes passent : le prestataire démarre 40 minutes après l'heure prévue.
  await sql(`update missions set heure_debut = '${heureParis(Date.now() - 40 * 60000)}' where id = '${m.id}'`);
  const s = await api("/api/missions", { action: "start_mission", mission_id: m.id }, p.jeton);
  expect(s.statut, s.texte.slice(0, 200)).toBe(200);

  const [f] = await sql(`select delay_status, arrival_delay_minutes, actual_hours from missions where id = '${m.id}'`);
  console.log("[85] après démarrage :", JSON.stringify(f));
  expect(f.delay_status, "le client a déjà répondu : la question n'est pas rouverte").toBe("rejected");
  const retard = Number(f.arrival_delay_minutes);
  expect(retard).toBeGreaterThanOrEqual(40);
  expect(retard).toBeLessThanOrEqual(41);
  expect(Number(f.actual_hours)).toBeCloseTo(4 - retard / 60, 3);
  // 15 €/h : 25 centimes la minute. Tout le retard est rendu, une seule fois.
  expect((await paiementStripe(m.paymentIntent)).rembourse, "le retard entier rendu, en deux fois").toBe(retard * 25);
});
