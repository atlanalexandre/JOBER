// Le cashback se dépense en réduction du paiement, comme un avoir (depuis le 17/08/2026),
// et seulement si le client l'accepte (depuis le 28/09/2026) : sinon il s'accumule.
//
// Jusqu'au 28/09/2026, la documentation affirmait qu'il n'avait « plus de chemin de
// dépense » et l'écran exigeait un minimum de 10 € — ni l'un ni l'autre n'était vrai,
// et aucun scénario ne l'éprouvait. Ce qui est vérifié ici : la carte supporte le prix
// MOINS le cashback, le solde est débité une fois le paiement confirmé, et le prix de
// la prestation (`montant_total`, base de la facture et du versement) ne bouge pas.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, tachePlanifiee, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("cashback accepté : la carte paie 5 € de moins, le solde tombe à zéro, le prix reste entier", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);

  const m = await reservationPayee({ prestataire: p, client: c, utiliserCashback: true });

  const [ligne] = await sql(`select montant_total, cashback_applique, cashback_debite from missions where id = '${m.id}'`);
  expect(Number(ligne.montant_total), "le prix de la prestation ne bouge pas").toBe(m.montant);
  expect(Number(ligne.cashback_applique)).toBe(5);
  expect(ligne.cashback_debite, "débité à la confirmation du paiement").toBe(true);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.preleve, "la carte supporte le prix moins le cashback").toBe(Math.round((m.montant - 5) * 100));

  const [prof] = await sql(`select cashback_balance from profiles where id = '${c.id}'`);
  expect(Number(prof.cashback_balance)).toBe(0);
});

test("cashback non accepté : prix plein, le solde est conservé et continue de s'accumuler", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);

  const m = await reservationPayee({ prestataire: p, client: c });

  const [ligne] = await sql(`select cashback_applique from missions where id = '${m.id}'`);
  expect(Number(ligne.cashback_applique || 0)).toBe(0);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.preleve, "prix plein sans l'accord du client").toBe(Math.round(m.montant * 100));
  const [prof] = await sql(`select cashback_balance from profiles where id = '${c.id}'`);
  expect(Number(prof.cashback_balance), "solde intact").toBe(5);
});

test("annulation automatique faute de prestataire : la carte ET le cashback sont rendus", async () => {
  // Relecture du 28/09/2026 : la tâche planifiée remboursait la carte mais gardait
  // la part réglée en cashback, alors que la notification promet un remboursement intégral.
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);
  const m = await reservationPayee({ prestataire: p, client: c, utiliserCashback: true });
  expect(Number((await sql(`select cashback_balance from profiles where id = '${c.id}'`))[0].cashback_balance)).toBe(0);

  // Personne n'a repris la prestation, et son heure de début est passée.
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null,
    date = (now() at time zone 'Europe/Paris')::date - 1 where id = '${m.id}'`);
  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const [ligne] = await sql(`select status from missions where id = '${m.id}'`);
  expect(ligne.status).toBe("cancelled");
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "la carte est remboursée").toBe(pi.preleve);
  const [prof] = await sql(`select cashback_balance from profiles where id = '${c.id}'`);
  expect(Number(prof.cashback_balance), "le cashback est rendu").toBe(5);
});

test("remboursement manuel au back-office : la carte ET le cashback sont rendus, une seule fois", async () => {
  // Relecture du 29/09/2026 : le back-office rendait la carte, jamais le cashback.
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);
  const m = await reservationPayee({ prestataire: p, client: c, utiliserCashback: true });

  const r = await bo("manual_refund", { mission_id: m.id, reason: "Recette" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse).toBe(pi.preleve);
  const [prof] = await sql(`select cashback_balance from profiles where id = '${c.id}'`);
  expect(Number(prof.cashback_balance), "le cashback est rendu").toBe(5);
  // La réduction reste inscrite : c'est elle qui borne ce que Stripe peut rendre.
  const [ligne] = await sql(`select cashback_applique, cashback_debite from missions where id = '${m.id}'`);
  expect(Number(ligne.cashback_applique)).toBe(5);
  expect(ligne.cashback_debite, "restitution prise : plus rien à rendre").toBe(false);
});
