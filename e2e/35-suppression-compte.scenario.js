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
import { test, expect, request } from "@playwright/test";
import { sql, RECETTE_REF } from "./outils.js";
import { prestataireOperationnel, client, api, bo, reservationPayee, paiementStripe, anon } from "./fabrique.js";

const SUPABASE = `https://${RECETTE_REF}.supabase.co`;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

/** Dépose un fichier dans le dossier du prestataire, avec SON jeton, comme son espace. */
async function deposerFichier(p, type) {
  const c = await request.newContext({ proxy });
  const up = await c.post(`${SUPABASE}/storage/v1/object/Documents/${p.id}/${type}`, {
    headers: { Authorization: `Bearer ${p.jeton}`, apikey: await anon(), "x-upsert": "true", "Content-Type": "application/pdf" },
    data: Buffer.from(`%PDF-1.4\n% piece de recette ${Date.now()}\n`),
  });
  expect(up.ok(), `dépôt du fichier ${type} : ${up.status()}`).toBeTruthy();
  await c.dispose();
}

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

/**
 * Un compte supprimé laisse son empreinte (téléphone, IBAN) dans la liste
 * anti-recréation. Les comptes de recette partagent tous le même téléphone et le
 * même IBAN : supprimer l'un d'eux faisait passer TOUS les suivants pour des
 * comptes recréés, privés d'essai gratuit — et cassait les autres scénarios. Le
 * compte à supprimer reçoit donc des coordonnées qui ne sont qu'à lui.
 */
async function coordonneesPropres(compte) {
  const n = String(Date.now()).slice(-8);
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"telephone":"07${n}"}'::jsonb where id = '${compte.id}'`);
  await sql(`update profiles set rib = 'FR76 9999 ${n} ${compte.id.slice(0, 8)}' where id = '${compte.id}'`);
}

const compteExiste = async (id) => (await sql(`select count(*)::int as n from auth.users where id = '${id}'`))[0].n === 1;

test("un client supprime son compte : le virement dû au prestataire n'est pas effacé avec lui", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const mission = await prestationTerminee(p, c, { payout_status: "pending" });

  await coordonneesPropres(c);
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

  await coordonneesPropres(p);
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
  // Une pièce avec sa fiche, et une sans (dépôt interrompu) : les deux doivent partir.
  await deposerFichier(p, "cni");
  await deposerFichier(p, "domicile");
  await sql(`delete from documents where prestataire_id = '${p.id}' and type = 'domicile'`);
  await sql(`update documents set storage_path = '${p.id}/cni' where prestataire_id = '${p.id}' and type = 'cni'`);
  expect(await fichiersDe(p.id), "le dossier du prestataire est bien dans le stockage").toBe(2);

  await coordonneesPropres(p);
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
