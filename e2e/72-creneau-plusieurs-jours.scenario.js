// Un prestataire ne peut pas être réservé deux fois au même moment — journée
// par journée (06/10/2026).
//
// Le contrôle ne comparait que le PREMIER JOUR. Une réservation du lundi au
// mercredi ne voyait pas la prestation déjà acceptée le mardi ; une prestation
// le mardi ne voyait pas la série déjà en cours ce jour-là. Et l'écran faisait
// la vérification lui-même, alors que la base ne lui montre que les
// prestations du client connecté : un prestataire réservé par un autre client
// paraissait toujours libre.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const jour = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

/** Une prestation acceptée par `p`, le jour J+`dans` de 9 h à 17 h. */
async function priseLe(p, dans) {
  const a = await client();
  const m = await reservationPayee({ prestataire: p, client: a, dansJours: dans, heure: "09:00", heures: 8 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  return m;
}

test("une réservation sur trois jours voit la prestation déjà prise le deuxième", async () => {
  const p = await prestataireOperationnel();
  await priseLe(p, 6);
  const b = await client();
  const pris = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(5), date_fin: jour(7), heure_debut: "10:00", hours: 4 }, b.jeton);
  expect(pris.statut, pris.texte.slice(0, 200)).toBe(200);
  expect(pris.json).toEqual({ libre: false, jour: jour(6) });

  const libre = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(8), date_fin: jour(9), heure_debut: "10:00", hours: 4 }, b.jeton);
  expect(libre.json).toEqual({ libre: true });
  const autreHoraire = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(5), date_fin: jour(7), heure_debut: "18:00", hours: 2 }, b.jeton);
  expect(autreHoraire.json, "même jours, après 17 h : libre").toEqual({ libre: true });
});

test("une prestation ponctuelle voit la série en cours ce jour-là", async () => {
  const p = await prestataireOperationnel();
  const m = await priseLe(p, 5);
  await sql(`update missions set date_debut = '${jour(5)}', date_fin = '${jour(7)}' where id = '${m.id}'`);
  const b = await client();
  const r = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(6), heure_debut: "11:00", hours: 2 }, b.jeton);
  expect(r.json).toEqual({ libre: false, jour: jour(6) });
});

test("le prestataire ne peut pas accepter une série qui chevauche une prestation acceptée", async () => {
  const p = await prestataireOperationnel();
  // Premium : le plan gratuit plafonne à deux prestations par mois, et ce
  // plafond répondrait avant le contrôle du créneau.
  await sql(`update profiles set plan_abonnement = 'premium', subscription_end_date = now() + interval '30 days' where id = '${p.id}'`);
  await priseLe(p, 6);
  const b = await client();
  const m = await reservationPayee({ prestataire: p, client: b, dansJours: 5, heure: "09:00", heures: 4 });
  await sql(`update missions set date_debut = '${jour(5)}', date_fin = '${jour(7)}' where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "toujours en attente").toBe("pending_acceptance");
});

test("une journée prolongée occupe le prestataire jusqu'à sa nouvelle fin", async () => {
  const p = await prestataireOperationnel();
  const m = await priseLe(p, 6);
  // 9 h – 17 h, plus 3 h ajoutées ce jour-là : jusqu'à 20 h.
  await sql(`update missions set heures_ajoutees_detail = '[{"jour":"${jour(6)}","heures":3,"tarif":13,"paiement":null}]'::jsonb where id = '${m.id}'`);
  const b = await client();
  const r = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(6), heure_debut: "18:00", hours: 2 }, b.jeton);
  expect(r.json).toEqual({ libre: false, jour: jour(6) });
});

test("une nuit qui déborde sur le lendemain annonce le lendemain", async () => {
  const p = await prestataireOperationnel();
  const m = await priseLe(p, 6);
  await sql(`update missions set heure_debut = '05:00', hours = 2 where id = '${m.id}'`);
  const b = await client();
  const r = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(5), heure_debut: "22:00", hours: 8 }, b.jeton);
  expect(r.json, "le conflit est le lendemain matin").toEqual({ libre: false, jour: jour(6) });
});

test("seul un client peut demander si un prestataire est libre", async () => {
  const p = await prestataireOperationnel();
  const autre = await prestataireOperationnel();
  const r = await api("/api/missions", { action: "verifier_creneau", prestataire_id: p.id,
    date: jour(6), heure_debut: "10:00", hours: 2 }, autre.jeton);
  expect(r.statut, "un prestataire ne lit pas l'agenda d'un autre").toBe(403);
});

test("une demande mal formée est refusée", async () => {
  const b = await client();
  const r = await api("/api/missions", { action: "verifier_creneau", prestataire_id: "x", date: "demain", heure_debut: "9h" }, b.jeton);
  expect(r.statut).toBe(400);
  const anonyme = await api("/api/missions", { action: "verifier_creneau" });
  expect(anonyme.statut).toBe(401);
});
