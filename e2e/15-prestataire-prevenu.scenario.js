// Le prestataire est prévenu PAR LE SERVEUR à chaque affectation (#856, 25/09/2026).
//
// Avant, c'était le navigateur du client qui prévenait, avec ses propres données : le
// tarif urgent n'apparaissait pas, le vrai prestataire d'une prestation chez un tiers
// n'était pas averti, et en cascade le suivant n'était prévenu par rien. On vérifie ici
// la notification enregistrée pour le bon prestataire, UNE fois, avec le vrai délai.
//
// Aucun e-mail ni SMS ne part de la recette (RESEND_API_KEY et BREVO_API_KEY absentes) :
// c'est la notification dans l'application, écrite par `notifier()`, qui fait foi.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee, paiementStripe, jetonDe } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const DECLARATION_TIERS = {
  beneficiaire: "Hôtel du Parc (client de Camille Recette)",
  service_vendu: "Remise en état de 12 chambres",
  perimetre: "Chambres du 2e étage, hors parties communes",
  livrable: "12 chambres prêtes à la location",
  organisateur: "Le prestataire organise seul son travail",
};

const demandes = (missionId) => sql(`select user_id, title, body, created_at from notifications
  where ref_id = '${missionId}' and title = 'Nouvelle demande de prestation' order by created_at`);

const etat = async (id) => (await sql(`select status, prestataire_id, acceptance_deadline,
  extract(epoch from (acceptance_deadline - now()))/60 as minutes_restantes from missions where id = '${id}'`))[0];

test("réservation d'un prestataire choisi : il est prévenu une fois, avec le vrai délai de réponse", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });

  const n = await demandes(m.id);
  console.log("[15] notification :", JSON.stringify(n));
  expect(n.length, "une seule notification — la push partait en double").toBe(1);
  expect(n[0].user_id).toBe(p.id);
  expect(n[0].body, "le délai annoncé est celui fixé par le serveur (4 h)").toContain("Vous avez 4 heures pour accepter ou refuser");

  // Un onglet resté sur l'ancienne version appelle encore notify_prestataire : rien de plus ne part.
  const ancien = await api("/api/missions", { action: "notify_prestataire", prestataire_id: p.id }, c.jeton);
  expect(ancien.statut).toBe(200);
  expect((await demandes(m.id)).length, "pas de seconde notification").toBe(1);
});

test("réservation urgente : délai de 20 minutes, annoncé tel quel au prestataire", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, dansJours: 0, debutMs: Date.now() + 3 * 3600e3, heures: 4, urgent: true });
  const e = await etat(m.id);
  expect(Number(e.minutes_restantes), "20 minutes pour répondre en urgence").toBeGreaterThan(17);
  expect(Number(e.minutes_restantes)).toBeLessThan(21);
  const n = await demandes(m.id);
  expect(n.length).toBe(1);
  expect(n[0].body).toMatch(/Vous avez (19|20) minutes pour accepter ou refuser/);
});

test("chez un tiers : la plateforme choisit, et c'est CE prestataire qui est prévenu ; s'il refuse, le suivant l'est aussi", async () => {
  await prestataireOperationnel();
  await prestataireOperationnel(); // au moins deux candidats
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: null, client: c, declaration: DECLARATION_TIERS });
  expect(m.mode, "affectée par la plateforme").toBe("affectation");

  const premier = (await etat(m.id)).prestataire_id;
  expect(premier).toBeTruthy();
  let n = await demandes(m.id);
  expect(n.map((x) => x.user_id), "le prestataire choisi par la plateforme est prévenu").toEqual([premier]);

  // Il refuse : la commande tient, le suivant est affecté ET prévenu.
  const [{ email }] = await sql(`select email from auth.users where id = '${premier}'`);
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "refuse" }, await jetonDe(email));
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  console.log("[15] cascade :", JSON.stringify(e));
  expect(e.status).toBe("pending_acceptance");
  expect(e.prestataire_id, "un autre prestataire").not.toBe(premier);
  expect(Number(e.minutes_restantes), "délai standard de 4 h pour le suivant").toBeGreaterThan(235);
  n = await demandes(m.id);
  expect(n.map((x) => x.user_id), "le suivant est prévenu à son tour").toEqual([premier, e.prestataire_id]);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "rien n'est remboursé : la commande tient").toBe(0);
});

test("chez un tiers, en urgence : le suivant a 20 minutes, pas 4 heures", async () => {
  await prestataireOperationnel();
  await prestataireOperationnel();
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: null, client: c, declaration: DECLARATION_TIERS,
    dansJours: 0, debutMs: Date.now() + 3 * 3600e3, heures: 4, urgent: true });
  const premier = (await etat(m.id)).prestataire_id;
  const [{ email }] = await sql(`select email from auth.users where id = '${premier}'`);
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "refuse" }, await jetonDe(email));
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  expect(e.prestataire_id).not.toBe(premier);
  expect(Number(e.minutes_restantes), "délai urgent repris par la cascade").toBeLessThan(21);
  expect(Number(e.minutes_restantes)).toBeGreaterThan(17);
});

test("client professionnel, dans ses propres locaux : le prestataire qu'il a choisi refuse, il est remboursé", async () => {
  // Il a désigné CE prestataire : rien ne permet à la plateforme de lui en imposer un autre.
  const p = await prestataireOperationnel();
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: p, client: c, declaration: { lieu: "etablissement_propre" } });
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "refuse" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  console.log("[15] refus, dans ses locaux :", JSON.stringify(e));
  expect(e.status, "refusée, comme pour un particulier").toBe("refused");
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse, "remboursement intégral").toBe(s.preleve);
});

test("client professionnel, dans ses propres locaux : délai dépassé, il est remboursé", async () => {
  const p = await prestataireOperationnel();
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: p, client: c, declaration: { lieu: "etablissement_propre" } });
  await sql(`update missions set acceptance_deadline = now() - interval '1 minute' where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "acceptance_timeout", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect((await etat(m.id)).status).toBe("refused");
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse, "remboursement intégral").toBe(s.preleve);
});
