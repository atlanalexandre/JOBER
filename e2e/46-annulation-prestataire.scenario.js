// Annulation par le prestataire (audit des prestations, 01/10/2026).
//
// 1. Les demandes de remplacement en attente étaient fermées AVANT de vérifier
//    que l'appelant était bien le prestataire de la prestation : n'importe quel
//    compte pouvait fermer celles d'une prestation qui n'était pas la sienne.
// 2. Une demande pas encore acceptée pouvait être « annulée » : le client était
//    remboursé et la prestation close, au lieu du refus — qui, sur une
//    prestation affectée par la plateforme, passe au candidat suivant.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("un autre compte ne ferme pas les demandes de remplacement d'une prestation", async () => {
  const p = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const intrus = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut)
     values ('${m.id}', '${p.id}', '${entrant.id}', '${c.id}', 'en_attente') returning id`);

  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, intrus.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(404);
  const [l] = await sql(`select statut from mission_remplacements where id = '${d.id}'`);
  expect(l.statut, "la demande de remplacement est intacte").toBe("en_attente");
});

test("une demande pas encore acceptée se refuse, elle ne s'annule pas", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(l.status).toBe("pending_acceptance");
  expect(l.prestataire_id).toBe(p.id);
});

test("l'annulation d'une prestation acceptée fonctionne toujours", async () => {
  const p = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut)
     values ('${m.id}', '${p.id}', '${entrant.id}', '${c.id}', 'en_attente') returning id`);
  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status).toBe("cancelled");
  const [rp] = await sql(`select statut from mission_remplacements where id = '${d.id}'`);
  expect(rp.statut, "le remplacement n'a plus d'objet").toBe("annule");
});

// Relecture du 02/10/2026 : depuis que la fin d'une série est son dernier jour,
// le prestataire pouvait annuler en plein milieu — client intégralement
// remboursé des journées déjà faites, prestataire payé de rien.
test("une série commencée ne s'annule pas en bloc", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const jour = (d) => new Date(Date.now() + d * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  await sql(`update missions set date = '${jour(-1)}', date_debut = '${jour(-1)}', date_fin = '${jour(3)}',
             heure_debut = '23:30', started_at = now() - interval '24 hours' where id = '${m.id}'`);

  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  expect(JSON.parse(r.texte).code).toBe("serie_commencee");
  const [l] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(l.status, "ni annulée ni remboursée").toBe("assigned");
  expect(l.prestataire_id).toBe(p.id);
});
