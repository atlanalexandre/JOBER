// Exécution d'un remplacement (audit des prestations, 01/10/2026).
//
// Le changement de titulaire ne vérifiait pas son résultat : si la prestation
// n'était plus au prestataire sortant au moment de l'exécution (reprise par le
// back-office, autre remplacement), aucune ligne n'était modifiée — et les trois
// parties étaient prévenues que « le remplacement est validé ».
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("un remplacement sur une prestation reprise entre-temps n'est pas annoncé validé", async () => {
  const sortant = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const tiers = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: sortant, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, sortant.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut, accord_entrant_at)
     values ('${m.id}', '${sortant.id}', '${entrant.id}', '${c.id}', 'en_attente', now()) returning id`);
  // Entre-temps, la prestation a été confiée à quelqu'un d'autre.
  await sql(`update missions set prestataire_id = '${tiers.id}' where id = '${m.id}'`);

  const r = await api("/api/missions", { action: "repondre_remplacement", remplacement_id: d.id, reponse: "accepter" }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select statut from mission_remplacements where id = '${d.id}'`);
  expect(l.statut, "pas « accepté » : rien n'a été exécuté").not.toBe("accepte");
  const [mm] = await sql(`select prestataire_id from missions where id = '${m.id}'`);
  expect(mm.prestataire_id).toBe(tiers.id);
});

test("un remplacement normal s'exécute toujours", async () => {
  const sortant = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: sortant, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, sortant.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut, accord_entrant_at)
     values ('${m.id}', '${sortant.id}', '${entrant.id}', '${c.id}', 'en_attente', now()) returning id`);
  const r = await api("/api/missions", { action: "repondre_remplacement", remplacement_id: d.id, reponse: "accepter" }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [mm] = await sql(`select prestataire_id from missions where id = '${m.id}'`);
  expect(mm.prestataire_id).toBe(entrant.id);
});

test("le remplaçant signe le contrat en acceptant ; la signature passe sur la prestation", async () => {
  const sortant = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: sortant, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept", contrat_signe: true }, sortant.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut, accord_client_at)
     values ('${m.id}', '${sortant.id}', '${entrant.id}', '${c.id}', 'en_attente', now()) returning id`);

  const sans = await api("/api/missions", { action: "repondre_remplacement", remplacement_id: d.id, reponse: "accepter" }, entrant.jeton);
  expect(sans.statut, "pas d'accord sans signer le contrat").toBe(400);
  const r = await api("/api/missions", { action: "repondre_remplacement", remplacement_id: d.id, reponse: "accepter", contrat_signe: true }, entrant.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json.statut).toBe("accepte");
  const [l] = await sql(`select m.prestataire_id, m.contrat_presta_signe_at, r.accord_entrant_at
     from missions m join mission_remplacements r on r.mission_id = m.id where r.id = '${d.id}'`);
  expect(l.prestataire_id).toBe(entrant.id);
  expect(new Date(l.contrat_presta_signe_at).getTime(), "signature = accord du remplaçant").toBe(new Date(l.accord_entrant_at).getTime());
});

// Relecture du 03/10/2026 : l'annulation du prestataire ferme les demandes de
// remplacement AVANT le remboursement. Si celui-ci échoue, la prestation reste
// au prestataire — la demande convenue ne doit pas avoir disparu en silence.
test("annulation refusée par Stripe : la demande de remplacement reste ouverte", async () => {
  const sortant = await prestataireOperationnel();
  const entrant = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: sortant, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, sortant.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const [d] = await sql(`insert into mission_remplacements (mission_id, sortant_id, entrant_id, client_id, statut, accord_entrant_at)
     values ('${m.id}', '${sortant.id}', '${entrant.id}', '${c.id}', 'en_attente', now()) returning id`);
  // Un paiement que Stripe ne connaît pas : le remboursement échoue.
  await sql(`update missions set stripe_payment_intent = 'pi_inexistant_recette' where id = '${m.id}'`);

  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, sortant.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(500);
  const [mm] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(mm.status, "rien n'a été annulé").toBe("assigned");
  expect(mm.prestataire_id).toBe(sortant.id);
  const [l] = await sql(`select statut from mission_remplacements where id = '${d.id}'`);
  expect(l.statut, "la demande est rouverte").toBe("en_attente");
});
