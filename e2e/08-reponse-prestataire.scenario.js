// Le prestataire répond à une réservation payée : il accepte, il refuse, ou il ne
// répond pas dans le délai. Dans les deux derniers cas, le client doit être
// remboursé INTÉGRALEMENT — c'est ce que lui annonce l'écran d'attente — et on le
// vérifie chez Stripe, pas seulement en base.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee, paiementStripe, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const etat = async (id) => (await sql(`select status, prestataire_id, acceptance_deadline from missions where id = '${id}'`))[0];

async function reservation() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  return { p, c, m };
}

test("le prestataire accepte : la prestation lui est attribuée, rien n'est remboursé", async () => {
  const { p, m } = await reservation();
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  expect(e.status).toBe("assigned");
  expect(e.prestataire_id).toBe(p.id);
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse, "aucun remboursement sur une prestation acceptée").toBe(0);
});

test("le prestataire refuse : la prestation est close et le client intégralement remboursé", async () => {
  const { p, m } = await reservation();
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "refuse" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  expect(e.status).toBe("refused");
  expect(e.prestataire_id).toBeNull();
  const s = await paiementStripe(m.paymentIntent);
  console.log("[08] refus :", JSON.stringify(s));
  expect(s.rembourse, "remboursement intégral, frais de service compris").toBe(s.preleve);
});

test("un autre prestataire ne peut pas répondre à sa place", async () => {
  const { m } = await reservation();
  const intrus = await prestataireOperationnel();
  const r = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, intrus.jeton);
  expect(r.statut).toBe(404);
  expect((await etat(m.id)).status).toBe("pending_acceptance");
});

test("délai dépassé : le prestataire ne peut plus accepter, la tâche planifiée rembourse", async () => {
  const { p, m } = await reservation();
  // Le délai est calculé par le serveur (4 h ici) : on le recule en base.
  await sql(`update missions set acceptance_deadline = now() - interval '5 minutes' where id = '${m.id}'`);

  const tard = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(tard.statut, tard.texte.slice(0, 200)).toBe(410);
  expect((await etat(m.id)).status, "l'acceptation tardive ne vaut pas").toBe("pending_acceptance");

  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  const e = await etat(m.id);
  console.log("[08] après la tâche planifiée :", JSON.stringify(e));
  expect(e.status).toBe("refused");
  const s = await paiementStripe(m.paymentIntent);
  console.log("[08] délai dépassé :", JSON.stringify(s));
  expect(s.rembourse, "remboursement intégral après un délai dépassé").toBe(s.preleve);
});

test("délai dépassé, constaté par l'écran du client : remboursement intégral", async () => {
  const { c, m } = await reservation();
  // Avant l'échéance, le client ne peut pas décider seul que le délai est écoulé.
  const tot = await api("/api/missions", { action: "acceptance_timeout", mission_id: m.id }, c.jeton);
  expect(tot.statut).toBe(400);

  await sql(`update missions set acceptance_deadline = now() - interval '1 minute' where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "acceptance_timeout", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect((await etat(m.id)).status).toBe("refused");
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse).toBe(s.preleve);
});
