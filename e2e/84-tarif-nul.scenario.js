// Une réservation à tarif nul n'engage pas un prestataire (étude du 14/10/2026).
//
// Le navigateur crée lui-même la prestation. Avec `tarif_horaire: 0`, le contrôle
// du montant n'avait plus rien à décomposer et laissait passer ; l'affectation
// sautait la comparaison au tarif du prestataire (« si le tarif payé est
// positif »). Un client pouvait ainsi payer 1 ou 2 € de frais et envoyer une
// demande à un prestataire, qui l'acceptait — l'acceptation vaut signature — et
// travaillait sans être payé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, creerPrestationBrute, payerPrestation, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("prestation à 0 €/h payée : non affectée, client remboursé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const id = crypto.randomUUID();
  const cree = await creerPrestationBrute(c, { id, tarif_horaire: 0, montant_total: 2 });
  expect(cree.statut, `création : ${cree.texte}`).toBe(201);

  const r = await payerPrestation({ jetonClient: c.jeton, missionId: id, montant: 2, prestataireId: p.id });
  console.log("[84] paiement et affectation :", JSON.stringify(r));
  // Si le paiement est déjà refusé en amont, c'est tout aussi bien : rien n'engage le prestataire.
  if (r.etape === "creation du paiement") return;
  expect(r.etape, "l'affectation doit être refusée").toBe("affectation");
  expect(r.statut).toBe(400);

  const [m] = await sql(`select prestataire_id, status from missions where id = '${id}'`);
  expect(m.prestataire_id, "aucun prestataire engagé").toBeNull();
  const s = await paiementStripe(r.paymentIntent);
  expect(s.rembourse, "le client est remboursé").toBe(s.preleve);
});
