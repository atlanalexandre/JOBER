// Back-office : rembourser, annuler, valider de force (relecture du 30/09/2026).
//
// « Rembourser » ignorait un versement déjà parti au prestataire — ALANE payait deux
// fois —, et un double clic affichait l'erreur brute de Stripe, en anglais.
// « Valider de force » acceptait une prestation jamais payée et programmait quand
// même le versement au prestataire.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, bo, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("valider de force une prestation jamais payée : refusé, aucun versement programmé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const id = crypto.randomUUID();
  await sql(`insert into missions (id, client_id, prestataire_id, sector, metier, date, hours, heure_debut, tarif_horaire, montant_total, ville, adresse, status)
    values ('${id}', '${c.id}', '${p.id}', 'hotellerie', 'Femme/Valet de chambre', current_date, 8, '09:00', 13, 110.98, 'Paris', '10 rue de Rivoli', 'assigned')`);
  const r = await bo("force_complete_mission", { mission_id: id });
  expect(r.statut, r.texte.slice(0, 200)).toBe(400);
  const [m] = await sql(`select status, payout_status from missions where id = '${id}'`);
  expect(m.status).toBe("assigned");
  expect(m.payout_status).toBeNull();
});

test("rembourser deux fois : le second clic ne fait rien de plus, sans erreur", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const r1 = await bo("manual_refund", { mission_id: m.id, reason: "Recette" });
  expect(r1.statut, r1.texte.slice(0, 200)).toBe(200);
  const r2 = await bo("manual_refund", { mission_id: m.id, reason: "Recette" });
  expect(r2.statut, r2.texte.slice(0, 200)).toBe(200);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse).toBe(pi.preleve);
});

test("prestataire déjà payé, virement impossible à reprendre : le client n'est PAS remboursé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  // Versement réputé parti, sous un identifiant que Stripe ne connaît pas : la
  // reprise échoue, et rien ne doit être remboursé — sinon ALANE paierait deux fois.
  await sql(`update missions set payout_status = 'transferred', stripe_transfer_id = 'tr_inconnu_recette' where id = '${m.id}'`);
  const r = await bo("manual_refund", { mission_id: m.id, reason: "Recette" });
  expect(r.statut).toBe(502);
  expect(r.json?.error).toMatch(/rien n'a été remboursé/);
  expect((await paiementStripe(m.paymentIntent)).rembourse).toBe(0);
});

test("virement en cours d'émission : remboursement refusé tant qu'on ne sait pas s'il est parti", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await sql(`update missions set payout_status = 'processing' where id = '${m.id}'`);
  const r = await bo("cancel_mission", { mission_id: m.id, refund: true, reason: "Recette" });
  expect(r.statut).toBe(409);
  expect((await paiementStripe(m.paymentIntent)).rembourse).toBe(0);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "rien n'est annulé").not.toBe("cancelled");
});

test("« Remboursements Stripe » du back-office : même règle — pas de remboursement si le virement ne peut être repris", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await sql(`update missions set payout_status = 'transferred', stripe_transfer_id = 'tr_inconnu_recette' where id = '${m.id}'`);
  const pin = await api("/api/bo-verify-pin", { pin: process.env.RECETTE_BO_PASSWORD });
  const r = await api("/api/stripe-refund", { paymentIntentId: m.paymentIntent, missionId: m.id }, pin.json?.token);
  expect(r.statut, r.texte.slice(0, 200)).toBe(502);
  expect((await paiementStripe(m.paymentIntent)).rembourse, "rien remboursé : ALANE ne paie pas deux fois").toBe(0);
});
