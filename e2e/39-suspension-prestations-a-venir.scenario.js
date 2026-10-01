// Suspension d'un prestataire : ses prestations à venir (décision d'Alexandre du 30/09/2026).
//
// Suspendu, il ne peut plus se connecter. Ses prestations acceptées restaient à son
// nom, et le client attendait quelqu'un qui ne viendrait pas, sans en être prévenu.
// Chacune est désormais annulée, le client intégralement remboursé et prévenu.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api, bo } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("suspendu : ses prestations à venir sont annulées, les clients remboursés et prévenus", async () => {
  const p = await prestataireOperationnel();
  const c1 = await client();
  const c2 = await client();
  const acceptee = await reservationPayee({ prestataire: p, client: c1 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: acceptee.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const enAttente = await reservationPayee({ prestataire: p, client: c2, dansJours: 6 });

  const r = await bo("suspend", { profileId: p.id, reason: "Scénario de recette : suspension conservatoire" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  expect(r.json.annulees).toBe(2);
  expect(r.json.echecs).toEqual([]);

  for (const [m, c] of [[acceptee, c1], [enAttente, c2]]) {
    const [l] = await sql(`select status from missions where id = '${m.id}'`);
    expect(l.status).toBe("cancelled");
    const pi = await paiementStripe(m.paymentIntent);
    expect(pi.rembourse, "remboursement intégral, frais compris").toBe(pi.preleve);
    const [n] = await sql(`select count(*)::int as n from notifications where user_id = '${c.id}' and ref_id = '${m.id}' and title like 'Prestation annulée%'`);
    expect(n.n, "le client est prévenu").toBe(1);
  }
});

test("une prestation déjà démarrée reste en place, et elle est signalée", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  await sql(`update missions set started_at = now() - interval '1 hour' where id = '${m.id}'`);

  const r = await bo("suspend", { profileId: p.id, reason: "Scénario de recette : suspension conservatoire" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  expect(r.json.enCoursDemarrees).toEqual([m.id]);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status).toBe("assigned");
  expect((await paiementStripe(m.paymentIntent)).rembourse).toBe(0);
});

test("ancienne réservation payée par portefeuille : laissée en place et signalée, pas annulée sans remboursement", async () => {
  // Le portefeuille a été retiré le 23/09/2026, mais une réservation réglée avant
  // peut encore exister. Stripe ne la rembourse pas : l'annuler faisait perdre la
  // somme au client, prévenu d'un « remboursement » (relecture du 01/10/2026).
  const p = await prestataireOperationnel();
  const c = await client();
  const id = crypto.randomUUID();
  await sql(`insert into missions (id, client_id, prestataire_id, sector, metier, date, hours, heure_debut, tarif_horaire,
             montant_total, adresse, ville, status, stripe_payment_intent)
             values ('${id}', '${c.id}', '${p.id}', 'hotellerie', 'Femme/Valet de chambre', current_date + 4, 8, '09:00', 13,
             110.98, '10 rue de Rivoli', 'Paris', 'assigned', 'wallet_recette_${id.slice(0, 8)}')`);

  const r = await bo("suspend", { profileId: p.id, reason: "Scénario de recette : suspension conservatoire" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  expect(r.json.annulees).toBe(0);
  expect(r.json.echecs.map(e => e.id)).toEqual([id]);
  const [l] = await sql(`select status from missions where id = '${id}'`);
  expect(l.status, "pas annulée tant qu'elle n'est pas remboursée").toBe("assigned");
  const [n] = await sql(`select count(*)::int as n from notifications where user_id = '${c.id}' and ref_id = '${id}'`);
  expect(n.n, "aucun « remboursement » annoncé à tort").toBe(0);
});
