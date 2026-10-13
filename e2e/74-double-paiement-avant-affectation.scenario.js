// Deux paiements réussis pour UNE réservation : le second n'est jamais encaissé
// (étude du 13/10/2026).
//
// `stripe-intent` ne refusait un second paiement que si le premier était déjà
// RATTACHÉ à la prestation — ce que fait l'affectation, juste après le paiement.
// Si l'affectation n'arrive pas (réseau coupé, application fermée), le client qui
// revient payer en changeant une option (« mémoriser ma carte », cashback) recevait
// un NOUVEAU paiement : il était débité deux fois. L'affectation rattachait le
// second ; le premier, réussi, n'était plus jamais remboursé — `cron-abandon` ne
// regarde que les prestations restées sans prestataire, et le webhook qui
// rembourse les doublons n'est pas abonné à cet événement.
//
// Et si les deux affectations arrivaient, la seconde était refusée (409
// « un autre paiement est déjà rattaché ») sans rien rendre.
import { test, expect, request } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, anon, confirmerPaiement, paiementStripe, carteDeTest } from "./fabrique.js";
import { calculerFrais } from "../api/_montant.js";

test.describe.configure({ timeout: 240_000 });

const SUPABASE = "https://qoizrysxwjmhqwuteajj.supabase.co";

async function nouvelleReservation(c) {
  const id = crypto.randomUUID();
  const date = new Date(Date.now() + 6 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const [reglage] = await sql("select value from platform_settings where key = 'frais_service'");
  const montant = Math.round((13 * 4 + calculerFrais("single", 13 * 4, 1, reglage?.value)) * 100) / 100;
  const h = await request.newContext({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ins = await h.post(`${SUPABASE}/rest/v1/missions`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${c.jeton}`, Prefer: "return=minimal" },
    data: {
      id, client_id: c.id, prestataire_id: null, sector: "hotellerie", metier: "Femme/Valet de chambre",
      date, hours: 4, heure_debut: "09:00", tarif_horaire: 13, montant_total: montant,
      description: "Scénario 74", adresse: "10 rue de Rivoli", ville: "Paris", status: "pending_acceptance",
    },
  });
  expect(ins.ok(), await ins.text()).toBeTruthy();
  return { id, montant };
}

const affecter = (c, p, missionId, pi) => api("/api/missions", {
  action: "assign_after_payment", mission_id: missionId, prestataire_id: p.id,
  stripe_payment_intent: pi, retractation_renoncee: true, contrat_signe: true,
}, c.jeton);

test("affectation perdue : un second paiement n'est pas créé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await nouvelleReservation(c);

  // Premier paiement, réussi — mais l'affectation n'arrive jamais.
  const i1 = await api("/api/stripe-intent", { mission_id: m.id, utiliser_cashback: false }, c.jeton);
  expect(i1.statut, i1.texte.slice(0, 200)).toBe(200);
  const c1 = await confirmerPaiement(i1.json.clientSecret, carteDeTest());
  expect(c1.statut).toBe("succeeded");

  // Le client revient et coche « mémoriser ma carte » : autres paramètres.
  const i2 = await api("/api/stripe-intent", { mission_id: m.id, utiliser_cashback: false, memoriser: true }, c.jeton);
  expect(i2.statut, `second paiement : ${i2.texte.slice(0, 200)}`).toBe(409);
  expect(i2.json?.code).toBe("deja_payee");
  expect(i2.json?.clientSecret, "aucun second paiement créé").toBeFalsy();

  // L'affectation du premier paiement reste possible.
  const a = await affecter(c, p, m.id, c1.paymentIntent);
  expect(a.statut, a.texte.slice(0, 200)).toBe(200);
});

test("deux paiements réussis : le second est remboursé à l'affectation", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await nouvelleReservation(c);

  // Deux paiements créés avant tout rattachement (deux onglets), tous deux réussis.
  const i1 = await api("/api/stripe-intent", { mission_id: m.id, utiliser_cashback: false }, c.jeton);
  const i2 = await api("/api/stripe-intent", { mission_id: m.id, utiliser_cashback: false, memoriser: true }, c.jeton);
  expect(i1.statut).toBe(200);
  expect(i2.statut).toBe(200);
  expect(i2.json.intentId).not.toBe(i1.json.intentId);
  const c1 = await confirmerPaiement(i1.json.clientSecret, carteDeTest());
  const c2 = await confirmerPaiement(i2.json.clientSecret, carteDeTest());
  expect(c1.statut).toBe("succeeded");
  expect(c2.statut).toBe("succeeded");

  const a1 = await affecter(c, p, m.id, c1.paymentIntent);
  expect(a1.statut, a1.texte.slice(0, 200)).toBe(200);
  const a2 = await affecter(c, p, m.id, c2.paymentIntent);
  expect(a2.statut).toBe(409);
  expect(a2.json?.error || "").toMatch(/rembours/i);

  const [ligne] = await sql(`select stripe_payment_intent from missions where id = '${m.id}'`);
  expect(ligne.stripe_payment_intent, "le premier paiement reste rattaché").toBe(c1.paymentIntent);
  const s1 = await paiementStripe(c1.paymentIntent);
  const s2 = await paiementStripe(c2.paymentIntent);
  expect(s1.rembourse, "le paiement rattaché n'est pas touché").toBe(0);
  expect(s2.rembourse, "le doublon est rendu en entier").toBe(s2.preleve);
});
