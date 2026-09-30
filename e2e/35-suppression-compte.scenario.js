// Suppression de compte (audit du domaine « comptes », 30/09/2026).
//
// Deux clés étrangères de la base décident de ce qui arrive aux prestations quand
// un compte disparaît, et le code ne les avait jamais prises en compte :
//   - missions.client_id → profiles : ON DELETE CASCADE. Supprimer un client
//     effaçait TOUTES ses prestations, y compris celles dont le prestataire
//     attendait encore son virement : la ligne disparue, le traitement des
//     versements ne la trouvait plus, et le prestataire n'était jamais payé ;
//   - missions.prestataire_id → profiles : NO ACTION. Un prestataire ayant déjà
//     travaillé ne pouvait donc PAS être supprimé : la base refusait, l'écran
//     affichait « compte supprimé », et le compte restait ouvert.
// Et le back-office effaçait les prestations — remboursement réussi ou non — et
// laissait les pièces d'identité dans le stockage.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, bo, reservationPayee, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function prestationTerminee(p, c, champs) {
  const id = crypto.randomUUID();
  await sql(`insert into missions (id, client_id, prestataire_id, sector, metier, date, hours, heure_debut,
      tarif_horaire, montant_total, adresse, ville, status, stripe_payment_intent, payout_amount, payout_status, payout_due_at)
    values ('${id}', '${c.id}', '${p.id}', 'hotellerie', 'Femme/Valet de chambre', current_date - 3, 8, '09:00',
      13, 110.98, '10 rue de Rivoli', 'Paris', 'completed', 'pi_recette_${id.slice(0, 8)}', 104, '${champs.payout_status}',
      now() + interval '1 day')`);
  return id;
}

const compteExiste = async (id) => (await sql(`select count(*)::int as n from auth.users where id = '${id}'`))[0].n === 1;

test("un client supprime son compte : le virement dû au prestataire n'est pas effacé avec lui", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const mission = await prestationTerminee(p, c, { payout_status: "pending" });

  const r = await api("/api/support", { action: "delete_account" }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(await compteExiste(c.id), "le compte du client est bien supprimé").toBe(false);

  const [m] = await sql(`select payout_status, payout_amount, client_id from missions where id = '${mission}'`);
  expect(m, "la prestation — et le virement qu'elle porte — existe toujours").toBeTruthy();
  expect(m.payout_status).toBe("pending");
  expect(Number(m.payout_amount)).toBe(104);
});

test("un prestataire qui a déjà travaillé supprime son compte : il est réellement supprimé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const mission = await prestationTerminee(p, c, { payout_status: "transferred" });

  const r = await api("/api/support", { action: "delete_account" }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(await compteExiste(p.id), "« compte supprimé » doit être vrai").toBe(false);

  const [m] = await sql(`select status, prestataire_id from missions where id = '${mission}'`);
  expect(m, "l'historique du client est conservé").toBeTruthy();
  expect(m.status).toBe("completed");
});

const fichiersDe = async (id) => (await sql(`select count(*)::int as n from storage.objects where bucket_id = 'Documents' and name like '${id}/%'`))[0].n;

test("le back-office supprime un prestataire : son client est remboursé, la prestation reste, les pièces partent", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  expect(await fichiersDe(p.id), "le dossier du prestataire est bien dans le stockage").toBeGreaterThan(0);

  const r = await bo("delete", { profileId: p.id, reason: "Scénario de recette" });
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  expect(await compteExiste(p.id)).toBe(false);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "le client est intégralement remboursé").toBe(pi.preleve);
  const [l] = await sql(`select status, prestataire_id, client_id from missions where id = '${m.id}'`);
  expect(l, "la prestation n'est plus effacée").toBeTruthy();
  expect(l.status).toBe("cancelled");
  expect(l.client_id).toBe(c.id);
  expect(await fichiersDe(p.id), "les pièces d'identité ne restent pas dans le stockage").toBe(0);
  const [n] = await sql(`select count(*)::int as n from notifications where user_id = '${c.id}' and title like 'Prestation annulée%'`);
  expect(n.n, "le client est prévenu").toBe(1);
});
