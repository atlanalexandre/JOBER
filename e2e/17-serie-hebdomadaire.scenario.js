// Réservation chaque semaine — chaque prestation payée à son tour (décidé le 25/09/2026).
//
// La première semaine se réserve et se paie comme une autre, carte enregistrée avec
// l'accord exprès du client. À la validation de chaque semaine, le serveur crée la
// suivante chez le MÊME prestataire, la débite seule sur cette carte, et la lui
// propose ; son versement suit la règle commune, 48 h après SA fin. Le client arrête
// la série quand il veut.
//
// Avant : la semaine suivante naissait « open », sans prestataire ni paiement, et
// personne ne pouvait la prendre. L'option n'existait que dans la demande diffusée.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, paiementStripe, tachePlanifiee } from "./fabrique.js";
import { connexion, reserverJusquauPaiement } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

const H = 3600e3;
const jourParis = (ms) => new Date(ms).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const plusSept = (jour) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); };
const suivante = async (id) => (await sql(`select id, date::text, status, prestataire_id, montant_total, tarif_horaire, hours,
  stripe_payment_intent, recurrence, extract(epoch from (acceptance_deadline - now()))/60 as minutes
  from missions where parent_mission_id = '${id}'`));

/** La semaine en cours s'est déroulée hier : acceptée, démarrée, fin confirmée par le prestataire. */
async function semaineFaite(p, m) {
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const jour = jourParis(Date.now() - 24 * H);
  await sql(`update missions set date = '${jour}', heure_debut = '09:00',
    started_at = ('${jour} 09:00'::timestamp at time zone 'Europe/Paris') where id = '${m.id}'`);
  const fin = await api("/api/missions", { action: "validate_presta", mission_id: m.id }, p.jeton);
  expect(fin.statut, fin.texte.slice(0, 200)).toBe(200);
  return jour;
}

test("par l'écran : « Répéter chaque semaine », puis l'accord exprès pour les semaines suivantes", async ({ page }) => {
  await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await reserverJusquauPaiement(page, { chaqueSemaine: true });

  const [m] = await sql(`select recurrence, montant_total from missions where client_id = '${c.id}' order by created_at desc limit 1`);
  expect(m.recurrence, "la réservation est enregistrée comme hebdomadaire").toBe("weekly");
  expect(Number(m.montant_total), "on ne paie que la première semaine").toBeCloseTo(110.98, 2);
  await expect(page.getByText("j'autorise ALANE à débiter cette carte", { exact: false })).toBeVisible();
  await page.screenshot({ path: "e2e-resultats/captures/17-accord-serie.png", fullPage: true });
});

test("semaine validée par le client : la suivante est créée, débitée seule, et proposée au même prestataire", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, recurrence: "weekly" });
  const jour = await semaineFaite(p, m);

  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);

  const [s] = await suivante(m.id);
  console.log("[17] semaine suivante :", JSON.stringify(s));
  expect(s, "la semaine suivante existe").toBeTruthy();
  expect(s.date, "même jour, sept jours plus tard").toBe(plusSept(jour));
  expect(s.status, "en attente de la réponse du prestataire").toBe("pending_acceptance");
  expect(s.prestataire_id, "le même prestataire").toBe(p.id);
  expect(Number(s.montant_total), "même prix : 8 h × 13 € + frais").toBeCloseTo(110.98, 2);
  expect(s.recurrence).toBe("weekly");
  expect(Number(s.minutes), "délai de réponse ordinaire (4 h)").toBeGreaterThan(235);

  const st = await paiementStripe(s.stripe_payment_intent);
  expect(st.statut, "débitée sur la carte enregistrée").toBe("succeeded");
  expect(st.preleve, "cette semaine seule").toBe(11098);

  const [presta] = await sql(`select body from notifications where user_id = '${p.id}' and ref_id = '${s.id}' and title = 'Nouvelle demande de prestation'`);
  expect(presta?.body, "le prestataire est prévenu").toContain("Vous avez 4 heures");
  const [cl] = await sql(`select body from notifications where user_id = '${c.id}' and ref_id = '${s.id}'`);
  expect(cl?.body, "le client sait ce qui a été débité").toContain("110,98 €");

  // Le versement de la semaine validée suit la règle commune : 48 h après sa fin.
  const [e] = await sql(`select payout_status, payout_due_at from missions where id = '${m.id}'`);
  const [{ fin_ms }] = await sql(`select extract(epoch from ('${jour} 17:00'::timestamp at time zone 'Europe/Paris')) * 1000 as fin_ms`);
  expect(e.payout_status).toBe("pending");
  expect(Math.abs(new Date(e.payout_due_at).getTime() - (Number(fin_ms) + 48 * H)), "versement 48 h après la fin").toBeLessThan(60e3);

  // Une seconde validation ne crée ni ne débite rien de plus.
  await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect((await suivante(m.id)).length, "une seule semaine suivante").toBe(1);
});

test("semaine validée automatiquement (24 h sans réponse du client) : la série continue aussi", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, recurrence: "weekly" });
  await semaineFaite(p, m);
  // Fin il y a plus de 24 h : la tâche planifiée valide d'office.
  const jour = jourParis(Date.now() - 2 * 24 * H);
  await sql(`update missions set date = '${jour}', started_at = ('${jour} 09:00'::timestamp at time zone 'Europe/Paris') where id = '${m.id}'`);
  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  expect((await sql(`select status from missions where id = '${m.id}'`))[0].status).toBe("completed");
  const [s] = await suivante(m.id);
  expect(s?.status, "semaine suivante créée par la validation automatique").toBe("pending_acceptance");
  expect(s?.prestataire_id).toBe(p.id);
  expect(s?.stripe_payment_intent).toBeTruthy();
});

test("le prestataire refuse une semaine : elle est remboursée, et la série s'arrête là", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, recurrence: "weekly" });
  await semaineFaite(p, m);
  await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  const [s] = await suivante(m.id);
  const r = await api("/api/missions", { action: "respond_mission", mission_id: s.id, response: "refuse" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const st = await paiementStripe(s.stripe_payment_intent);
  expect(st.rembourse, "remboursement intégral de cette semaine").toBe(st.preleve);
  expect((await suivante(s.id)).length, "aucune semaine d'après").toBe(0);
});

test("le client arrête la série : la semaine en cours se termine, plus rien n'est débité ensuite", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, recurrence: "weekly" });
  const intrus = await client();
  const refus = await api("/api/missions", { action: "arreter_serie", mission_id: m.id }, intrus.jeton);
  expect(refus.statut, "un autre client ne peut pas arrêter la série").toBe(404);

  const arret = await api("/api/missions", { action: "arreter_serie", mission_id: m.id }, c.jeton);
  expect(arret.statut, arret.texte.slice(0, 200)).toBe(200);
  await semaineFaite(p, m);
  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut).toBe(200);
  expect((await suivante(m.id)).length, "aucune semaine suivante").toBe(0);
});

test("une prestation unique n'est pas prise pour une série", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await semaineFaite(p, m);
  await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect((await suivante(m.id)).length).toBe(0);
});
