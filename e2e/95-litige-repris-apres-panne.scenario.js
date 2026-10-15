// Litige dénoué par un remboursement, REPRIS après une clôture manquée (relecture du
// 15/10/2026).
//
// Le remboursement part chez Stripe, puis l'écriture en base échoue : la prestation reste
// en litige, et le passage suivant — traitement automatique ou back-office — recommence.
// Il comptait le remboursement qu'il avait lui-même fait dans ce qui avait « déjà été
// rendu » : il ne trouvait plus rien à rendre, demandait la totalité sous la même clé
// d'idempotence, et Stripe refusait la clé réutilisée avec d'autres paramètres. Le litige
// ne se fermait plus ; passé les 24 h où Stripe garde la clé, les frais de service étaient
// rendus en plus.
//
// La panne de la base ne se provoque pas sur la recette : on remet la prestation dans
// l'état exact qu'elle laisse — remboursée chez Stripe, toujours en litige en base.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, bo, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const decision = (m) => bo("executer_decision", { mission_id: m.id, resolution: "rembourser_client", cause: "justice", justification: "Recette — décision de test" });

test("clôture manquée puis reprise : un seul remboursement, frais de service retenus", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 8, tarif: 13 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now() - interval '9 hours', validation_prestataire = true where id = '${m.id}'`);
  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(200);
  const [avant] = await sql(`select payout_status from missions where id = '${m.id}'`);

  const premier = await decision(m);
  expect(premier.statut, premier.texte.slice(0, 300)).toBe(200);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "8 h à 13 € rendues, frais retenus").toBe(10400);

  // L'état laissé par une clôture manquée : remboursé chez Stripe, en litige en base.
  await sql(`update missions set status = 'disputed', payout_status = ${avant.payout_status ? `'${avant.payout_status}'` : "null"},
             resolution_executee_cause = null where id = '${m.id}'`);

  const reprise = await decision(m);
  expect(reprise.statut, `la reprise doit clore le litige : ${reprise.texte.slice(0, 300)}`).toBe(200);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "aucun second remboursement : les frais de service restent retenus").toBe(10400);
  const [f] = await sql(`select status, payout_status from missions where id = '${m.id}'`);
  expect(f.status).toBe("closed");
  expect(f.payout_status, "rien n'est dû au prestataire").toBe("annule");
});
