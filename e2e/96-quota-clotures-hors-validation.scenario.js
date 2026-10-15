// Une prestation close autrement que par la validation compte aussi au quota du mois
// (relecture du 15/10/2026).
//
// Seules la validation par le client et la validation automatique comptaient (`e2e/90`).
// L'arrêt complet d'une prestation en cours et le dénouement d'un litige qui paie le
// prestataire la faisaient quitter les « en cours » — que le contrôle de quota additionne
// au compteur — sans l'y ajouter : la place se libérait, et un compte gratuit dépassait sa
// limite. La validation forcée par le back-office comptait, à sa façon : une seule journée
// quelle que soit la durée, et sans marquer le quota gratuit épuisé à la limite.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, bo } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const compteur = async (p) => Number((await sql(`select missions_completed_month n from profiles where id = '${p.id}'`))[0].n || 0);

async function prestationAcceptee() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 6 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update profiles set trial_exhausted = false where id = '${p.id}'`);
  return { p, c, m };
}

const jour = (d) => new Date(Date.now() + d * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

test("validation forcée par le back-office : chaque journée compte au quota", async () => {
  // Trois jours (avant-hier → aujourd'hui), comme une validation par le client.
  const { p, m } = await prestationAcceptee();
  await sql(`update missions set date = '${jour(-2)}', date_debut = '${jour(-2)}', date_fin = '${jour(0)}',
             started_at = now() - interval '50 hours', validation_prestataire = true where id = '${m.id}'`);
  const avant = await compteur(p);
  const r = await bo("force_complete_mission", { mission_id: m.id });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(await compteur(p), "trois journées de plus au compteur du mois").toBe(avant + 3);
});

test("série arrêtée en cours : les journées faites comptent au quota", async () => {
  // Quatre jours (hier → après-demain), arrêtée le deuxième : hier et aujourd'hui sont faits.
  const { p, c, m } = await prestationAcceptee();
  const ilYa2h = new Date(Date.now() - 2 * 3600e3).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  await sql(`update missions set date = '${jour(-1)}', date_debut = '${jour(-1)}', date_fin = '${jour(2)}',
             heure_debut = '${ilYa2h}', started_at = now() - interval '26 hours' where id = '${m.id}'`);
  const avant = await compteur(p);
  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: m.id, annuler_reste: true }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect((await sql(`select status from missions where id = '${m.id}'`))[0].status).toBe("completed");
  expect(await compteur(p), "les deux journées faites, pas les deux annulées").toBe(avant + 2);
});

test("litige versé au prestataire : la prestation compte au quota, une seule fois", async () => {
  const { p, c, m } = await prestationAcceptee();
  await sql(`update missions set started_at = now() - interval '9 hours', validation_prestataire = true where id = '${m.id}'`);
  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(200);
  const avant = await compteur(p);
  const r = await bo("executer_decision", { mission_id: m.id, resolution: "verser_prestataire", cause: "justice", justification: "Recette — décision de test" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  expect(await compteur(p), "contestée avant la validation : comptée au dénouement").toBe(avant + 1);
});
