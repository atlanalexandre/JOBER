// Contestation bancaire reçue AVANT la clôture (décision d'Alexandre du 01/10/2026).
//
// Il n'y avait alors aucun versement à retenir : il n'existe qu'à la clôture. Le
// webhook inscrit désormais la retenue (motif, terme) ; le traitement des
// versements la fait jouer au moment d'émettre, quelle que soit la façon dont la
// prestation a été clôturée. Le webhook lui-même est éprouvé par
// src/tests/api/contestation-bancaire.test.js ; ici, la retenue inscrite est posée
// telle qu'il l'écrit, et c'est le traitement réel des versements qui est éprouvé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("retenue inscrite avant la clôture : à l'échéance, le versement est retenu, pas émis", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // La contestation arrive avant la clôture : ce que le webhook inscrit.
  await sql(`update missions set payout_hold_reason = 'opposition_bancaire', payout_hold_at = now(),
             payout_hold_until = now() + interval '90 days' where id = '${m.id}'`);
  // La prestation est ensuite clôturée et son échéance de versement atteinte.
  await sql(`update missions set status = 'completed', payout_status = 'pending', payout_amount = 104,
             payout_due_at = now() - interval '1 hour' where id = '${m.id}'`);

  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select payout_status, stripe_transfer_id from missions where id = '${m.id}'`);
  expect(l.payout_status, "retenu, pas en attente ni émis").toBe("held");
  expect(l.stripe_transfer_id).toBeNull();
  const [n] = await sql(`select count(*)::int as n from notifications where user_id = '${p.id}' and title = 'Versement suspendu'`);
  expect(n.n, "le prestataire est prévenu").toBe(1);
});
