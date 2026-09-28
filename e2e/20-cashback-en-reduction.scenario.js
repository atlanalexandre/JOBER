// Le cashback se dépense en réduction du paiement, comme un avoir (depuis le 17/08/2026).
//
// Jusqu'au 28/09/2026, la documentation affirmait qu'il n'avait « plus de chemin de
// dépense » et l'écran exigeait un minimum de 10 € — ni l'un ni l'autre n'était vrai,
// et aucun scénario ne l'éprouvait. Ce qui est vérifié ici : la carte supporte le prix
// MOINS le cashback, le solde est débité une fois le paiement confirmé, et le prix de
// la prestation (`montant_total`, base de la facture et du versement) ne bouge pas.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("5 € de cashback : la carte paie 5 € de moins, le solde tombe à zéro, le prix reste entier", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);

  const m = await reservationPayee({ prestataire: p, client: c });

  const [ligne] = await sql(`select montant_total, cashback_applique, cashback_debite from missions where id = '${m.id}'`);
  expect(Number(ligne.montant_total), "le prix de la prestation ne bouge pas").toBe(m.montant);
  expect(Number(ligne.cashback_applique)).toBe(5);
  expect(ligne.cashback_debite, "débité à la confirmation du paiement").toBe(true);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.preleve, "la carte supporte le prix moins le cashback").toBe(Math.round((m.montant - 5) * 100));

  const [prof] = await sql(`select cashback_balance from profiles where id = '${c.id}'`);
  expect(Number(prof.cashback_balance)).toBe(0);
});
