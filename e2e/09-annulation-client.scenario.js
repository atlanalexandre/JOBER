// Annulation par le client, avant le début de la prestation (CGPS art. 8.1).
//
// Plus ou moins de 24 h avant, la règle est la même : le prix de la prestation
// (tarif × durée) est remboursé, les frais de service sont retenus. Le délai ne
// change que le libellé — « coûts engagés » ou « indemnité d'annulation ». On le
// vérifie chez Stripe, au centime.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

async function annulerApresAcceptation(debut) {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, ...debut });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  const r = await api("/api/missions", { action: "cancel_client", mission_id: m.id, reason: "Scénario de recette" }, c.jeton);
  expect(r.statut, r.texte.slice(0, 300)).toBe(200);
  const [e] = await sql(`select status from missions where id = '${m.id}'`);
  const s = await paiementStripe(m.paymentIntent);
  return { m, e, s, r, c };
}

test("plus de 24 h avant : le prix est remboursé, les frais de service retenus", async () => {
  const { e, s } = await annulerApresAcceptation({ dansJours: 5 });
  console.log("[09] > 24 h :", JSON.stringify(s));
  expect(e.status).toBe("cancelled");
  expect(s.preleve).toBe(11098);            // 8 h × 13 € + 6,98 € de frais
  expect(s.rembourse, "prix de la prestation seul (8 h × 13 €)").toBe(10400);
});

test("moins de 24 h avant : le prix est remboursé, les frais de service retenus", async () => {
  const { e, s } = await annulerApresAcceptation({ debutMs: Date.now() + 5 * 3600e3 });
  console.log("[09] < 24 h :", JSON.stringify(s));
  expect(e.status).toBe("cancelled");
  expect(s.rembourse, "prix de la prestation seul (8 h × 13 €)").toBe(10400);
});

test("une prestation déjà annulée ne se rembourse pas deux fois", async () => {
  const { m, s, c } = await annulerApresAcceptation({ dansJours: 5 });
  const encore = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
  expect(encore.statut, encore.texte.slice(0, 200)).toBe(400);
  const s2 = await paiementStripe(m.paymentIntent);
  expect(s2.rembourse, "aucun second remboursement").toBe(s.rembourse);
});
