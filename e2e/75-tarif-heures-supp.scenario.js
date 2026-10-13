// Le tarif d'une prolongation déjà payée ne se réécrit pas (étude du 13/10/2026).
//
// Sur une prestation d'un jour, toutes les heures supplémentaires réglées sont
// payées au prestataire au tarif `extra_hours_tarif` — un seul tarif. Accepter une
// SECONDE demande réécrivait ce tarif dès l'acceptation, avant tout paiement : la
// première heure, réglée 20 € par le client, était versée au tarif de la seconde —
// même si le client ne payait jamais celle-ci.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, confirmerPaiement } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("seconde prolongation : le tarif déjà payé reste celui de ses heures", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  // Première prolongation : 1 h à 20 €, acceptée puis réglée.
  await sql(`update missions set extra_hours_requested = 1, extra_hours_status = 'pending' where id = '${m.id}'`);
  const a1 = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "accept", tarif_horaire: 20 }, p.jeton);
  expect(a1.statut, a1.texte.slice(0, 200)).toBe(200);
  const i1 = await api("/api/stripe-intent", { mode: "supplement", mission_id: m.id, currency: "eur" }, c.jeton);
  expect(i1.statut, i1.texte.slice(0, 200)).toBe(200);
  const p1 = await confirmerPaiement(i1.json.clientSecret);
  expect(p1.statut).toBe("succeeded");
  const c1 = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: p1.paymentIntent }, c.jeton);
  expect(c1.statut, c1.texte.slice(0, 200)).toBe(200);

  // Seconde demande : le prestataire l'accepte à 60 €/h — le client ne la paiera pas.
  await sql(`update missions set extra_hours_requested = 1, extra_hours_status = 'pending' where id = '${m.id}'`);
  const a2 = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "accept", tarif_horaire: 60 }, p.jeton);
  expect(a2.statut, "un autre tarif que celui des heures déjà réglées est refusé").toBe(409);
  const [l] = await sql(`select extra_hours_tarif from missions where id = '${m.id}'`);
  expect(Number(l.extra_hours_tarif), "le tarif payé n'a pas bougé").toBe(20);

  // Au même tarif, la seconde prolongation reste possible.
  const a3 = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "accept", tarif_horaire: 20 }, p.jeton);
  expect(a3.statut, a3.texte.slice(0, 200)).toBe(200);

  // Clôture : 4 h × 13 € + 1 h × 20 €, la seconde n'ayant pas été payée.
  await sql(`update missions set started_at = now() - interval '5 hours', validation_prestataire = true where id = '${m.id}'`);
  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);
  const [f] = await sql(`select payout_amount from missions where id = '${m.id}'`);
  expect(Number(f.payout_amount)).toBe(4 * 13 + 20);
});
