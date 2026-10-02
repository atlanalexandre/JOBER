// Interrompre une prestation « en cours » (audit des prestations, 01/10/2026).
//
// Rien ne vérifiait qu'elle avait démarré ni qu'elle avait lieu ce jour-là : une
// prestation prévue DEMAIN, « interrompue » aujourd'hui après son heure de début,
// était close comme faite et le prestataire payé. Et « écourter seulement
// aujourd'hui » se répétait à volonté, ajoutant chaque fois des heures non faites
// que le prestataire perdait à la clôture.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

/** Date et heure de Paris, décalées de `heures` (négatif : dans le passé). */
function paris(decalageJours, heuresAvant) {
  const d = new Date(Date.now() + decalageJours * 864e5 - heuresAvant * 3600e3);
  return {
    date: d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }),
    heure: new Date(Date.now() - heuresAvant * 3600e3).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }),
  };
}

async function prestationAcceptee() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 6 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  return { p, c, m };
}

test("une prestation de demain ne s'« interrompt » pas aujourd'hui", async () => {
  const { c, m } = await prestationAcceptee();
  const demain = paris(1, 0);
  const ilYa1h = paris(0, 1);
  await sql(`update missions set date = '${demain.date}', date_debut = '${demain.date}', date_fin = '${demain.date}',
             heure_debut = '${ilYa1h.heure}' where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select status, payout_status from missions where id = '${m.id}'`);
  expect(l.status, "pas close comme faite").toBe("assigned");
  expect(l.payout_status).toBeNull();
});

test("écourter la même journée deux fois : la seconde est refusée, les heures ne doublent pas", async () => {
  const { c, m } = await prestationAcceptee();
  const hier = paris(-1, 0), apresDemain = paris(2, 0), ilYa2h = paris(0, 2);
  await sql(`update missions set date = '${hier.date}', date_debut = '${hier.date}', date_fin = '${apresDemain.date}',
             heure_debut = '${ilYa2h.heure}', started_at = now() - interval '2 hours' where id = '${m.id}'`);
  const r1 = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id, annuler_reste: false }, c.jeton);
  expect(r1.statut, r1.texte.slice(0, 200)).toBe(200);
  const [a] = await sql(`select heures_perdues from missions where id = '${m.id}'`);
  const r2 = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id, annuler_reste: false }, c.jeton);
  expect(r2.statut, r2.texte.slice(0, 200)).toBe(409);
  const [b] = await sql(`select heures_perdues, status from missions where id = '${m.id}'`);
  expect(Number(b.heures_perdues), "comptées une seule fois").toBe(Number(a.heures_perdues));
  expect(b.status).toBe("assigned");
});

// Relecture du 02/10/2026 : la condition des journées restantes était inversée.
// Série de quatre jours (hier → après-demain), interrompue le deuxième.
async function serieEnCours() {
  const { c, m } = await prestationAcceptee();
  const hier = paris(-1, 0), apresDemain = paris(2, 0), ilYa2h = paris(0, 2);
  await sql(`update missions set date = '${hier.date}', date_debut = '${hier.date}', date_fin = '${apresDemain.date}',
             heure_debut = '${ilYa2h.heure}', started_at = now() - interval '26 hours' where id = '${m.id}'`);
  return { c, m };
}

test("série : « arrêter seulement aujourd'hui » ne rend que les heures du jour", async () => {
  const { c, m } = await serieEnCours();
  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id, annuler_reste: false }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status, heures_perdues from missions where id = '${m.id}'`);
  expect(l.status, "la série continue demain").toBe("assigned");
  // 6 h prévues aujourd'hui, environ 2 h faites : les deux journées suivantes,
  // que le prestataire fera, ne sont NI remboursées NI retirées de sa part.
  expect(Number(l.heures_perdues)).toBeGreaterThan(0);
  expect(Number(l.heures_perdues), "pas les journées suivantes (2 × 6 h)").toBeLessThanOrEqual(6);
});

test("série : « tout arrêter » rend les journées suivantes, et le virement part 48 h après aujourd'hui", async () => {
  const { c, m } = await serieEnCours();
  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id, annuler_reste: true }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status, heures_perdues, payout_due_at from missions where id = '${m.id}'`);
  expect(l.status).toBe("completed");
  // Heures non faites aujourd'hui + les deux journées qui n'auront pas lieu.
  expect(Number(l.heures_perdues), "les deux journées suivantes comptent").toBeGreaterThanOrEqual(12);
  expect(Number(l.heures_perdues)).toBeLessThanOrEqual(18);
  // Échéance : fin d'aujourd'hui + 48 h (≈ 2 jours), pas fin d'après-demain + 48 h (≈ 4 jours).
  const dans = (new Date(l.payout_due_at).getTime() - Date.now()) / 864e5;
  expect(dans, `virement dans ${dans.toFixed(1)} jours`).toBeLessThan(3);
});
