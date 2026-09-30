// Remboursements d'une prestation réglée en partie en cashback (audit du 30/09/2026).
//
// La carte ne paie que le prix MOINS le cashback. Trois chemins l'oubliaient :
//   - l'annulation par le client remboursait la carte sur le prix entier, PUIS rendait
//     le cashback : 105,98 € prélevés, 104,00 € rendus + 5 € de cashback, soit 1,98 €
//     de frais retenus au lieu de 6,98 € (mesuré sur la Preview) ;
//   - le refus d'identité demandait à Stripe de rendre le prix entier — plus que le
//     prélevé : Stripe refusait, le client restait sans prestation et sans argent ;
//   - l'annulation par le prestataire et le refus d'identité ne rendaient jamais le
//     cashback, alors que la prestation est annulée en entier avant son début (règle
//     d'Alexandre du 29/09/2026).
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function prestationAvecCashback() {
  const p = await prestataireOperationnel();
  const c = await client();
  await sql(`update profiles set cashback_balance = 5 where id = '${c.id}'`);
  const m = await reservationPayee({ prestataire: p, client: c, utiliserCashback: true });
  const [l] = await sql(`select montant_total, tarif_horaire, hours from missions where id = '${m.id}'`);
  return { p, c, m, prix: Math.round(Number(l.montant_total) * 100), partHoraire: Math.round(Number(l.tarif_horaire) * Number(l.hours) * 100) };
}

const soldeCashback = async (id) => Number((await sql(`select cashback_balance from profiles where id = '${id}'`))[0].cashback_balance);

test("le client annule : la carte récupère ce qu'elle a payé moins les frais, le cashback revient à part", async () => {
  const { c, m, prix, partHoraire } = await prestationAvecCashback();
  const r = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const pi = await paiementStripe(m.paymentIntent);
  const frais = prix - partHoraire;
  expect(pi.preleve, "la carte a payé le prix moins 5 € de cashback").toBe(prix - 500);
  expect(pi.rembourse, "rendu à la carte : ce qu'elle a payé, moins les frais").toBe(pi.preleve - frais);
  expect(await soldeCashback(c.id), "le cashback revient").toBe(5);
  // Au total, le client ne perd que les frais de service.
  expect(prix - (pi.rembourse + 500)).toBe(frais);
});

test("le prestataire annule : remboursement intégral de la carte, et le cashback revient", async () => {
  const { p, c, m } = await prestationAvecCashback();
  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse).toBe(pi.preleve);
  expect(await soldeCashback(c.id), "le cashback revient").toBe(5);
});

test("identité refusée : la carte est rendue en entier — Stripe ne refuse plus — et le cashback revient", async () => {
  const { p, c, m } = await prestationAvecCashback();
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // L'arrivée signalée : c'est elle qui ouvre la question de l'identité.
  await sql(`update missions set arrived_at = now() where id = '${m.id}'`);
  const r = await api("/api/missions", { action: "refuser_identite", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json?.rembourse, "remboursement parti").toBe(true);

  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "la carte récupère tout ce qu'elle a payé").toBe(pi.preleve);
  expect(await soldeCashback(c.id), "le cashback revient").toBe(5);
});
