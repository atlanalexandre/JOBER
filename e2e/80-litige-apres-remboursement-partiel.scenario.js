// Litige dénoué par un remboursement, sur une prestation dont une partie avait DÉJÀ été
// rendue au client (étude d'octobre 2026, domaine « argent »).
//
// Un décalage d'horaire refusé, ou jamais arbitré puis plafonné à la validation, rend au
// client les heures non faites. Le dénouement d'un litige qui suit (« rembourser le
// client ») ne tenait pas compte de ce premier remboursement :
//   - avant la validation, il demandait le prix entier, Stripe le plafonnait à ce qui
//     restait — frais de service compris —, et le « reliquat » calculé sur le prix entier
//     était VERSÉ au prestataire : ALANE rendait ses frais et payait en plus ;
//   - après la validation, le prix enregistré avait été ramené au dû : les frais n'y
//     étaient plus reconnus, et ils étaient rendus avec le reste.
// Règle attendue (CGPS art. 17.1) : le client récupère tout sauf les frais de service,
// et rien ne sort qu'ALANE n'ait encaissé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, bo, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const centimes = (e) => Math.round(Number(e) * 100);

/** Prestation de 8 h acceptée, démarrée avec une heure de retard. */
async function prestationEnRetard() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 8 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now() - interval '9 hours', validation_prestataire = true,
             delay_status = 'pending', arrival_delay_minutes = 60 where id = '${m.id}'`);
  const [l] = await sql(`select montant_total, tarif_horaire from missions where id = '${m.id}'`);
  return { p, c, m, prix: Number(l.montant_total), tarif: Number(l.tarif_horaire) };
}

async function rembourserParDecision(m) {
  const r = await bo("executer_decision", { mission_id: m.id, resolution: "rembourser_client", cause: "justice", justification: "Recette — décision de test" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  const [f] = await sql(`select status, payout_status, payout_amount from missions where id = '${m.id}'`);
  return f;
}

test("décalage refusé, puis litige remboursé avant validation : frais retenus, rien au prestataire", async () => {
  const { c, m, prix, tarif } = await prestationEnRetard();
  const frais = Math.round((prix - 8 * tarif) * 100) / 100;

  const d = await api("/api/missions", { action: "respond_delay", mission_id: m.id, response: "rejected" }, c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "l'heure de retard, rendue au refus").toBe(centimes(tarif));

  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(200);
  const f = await rembourserParDecision(m);

  const rendu = (await paiementStripe(m.paymentIntent)).rembourse;
  expect(rendu, "le prix de la prestation rendu en tout, frais de service retenus").toBe(centimes(8 * tarif));
  expect(f.payout_status, "rien n'est dû au prestataire").not.toBe("pending");
  const verse = f.payout_status === "pending" ? centimes(f.payout_amount) : 0;
  expect(rendu + verse, "rien ne sort qu'ALANE n'ait encaissé, frais compris").toBeLessThanOrEqual(centimes(prix - frais));
});

test("décalage plafonné à la validation, puis litige remboursé : les frais restent retenus", async () => {
  const { c, m, prix, tarif } = await prestationEnRetard();
  const frais = Math.round((prix - 8 * tarif) * 100) / 100;

  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "l'heure non faite, rendue à la validation").toBe(centimes(tarif));

  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Recette" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(200);
  const f = await rembourserParDecision(m);

  const rendu = (await paiementStripe(m.paymentIntent)).rembourse;
  expect(rendu, "tout sauf les frais de service").toBe(centimes(prix - frais));
  expect(f.payout_status).not.toBe("pending");
});
