// Double clic sur « accepter » une candidature : jamais d'affectation sans
// paiement (relecture du 05/10/2026). Les appels simultanés portent la même clé
// d'idempotence ; Stripe répond aux suivants « requête en cours » sans paiement,
// et le code retombait alors sur l'affectation — prestation attribuée, rien encaissé.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("quatre acceptations simultanées : aucune n'attribue la prestation sans paiement", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const id = crypto.randomUUID();
  const jour = new Date(Date.now() + 6 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  await sql(`insert into missions (id, client_id, sector, metier, date, hours, heure_debut, tarif_horaire, montant_total, adresse, ville, status)
             values ('${id}', '${c.id}', 'hotellerie', 'Femme/Valet de chambre', '${jour}', 8, '09:00', 13, 110.98, '10 rue de Rivoli', 'Paris', 'open')`);
  const [cand] = await sql(`insert into candidatures (mission_id, prestataire_id, status) values ('${id}', '${p.id}', 'pending') returning id`);

  const appels = await Promise.all([0, 1, 2, 3].map(() =>
    api("/api/missions", { action: "accept", mission_id: id, candidature_id: cand.id }, c.jeton)));
  for (const r of appels) {
    expect([200, 409], r.texte.slice(0, 200)).toContain(r.statut);
    if (r.statut === 200) expect(r.json?.client_secret, "une réponse 200 porte toujours un paiement").toBeTruthy();
  }
  expect(appels.some(r => r.statut === 200 && r.json?.client_secret)).toBe(true);

  const [m] = await sql(`select status, stripe_payment_intent from missions where id = '${id}'`);
  expect(m.status, "la prestation n'est attribuée qu'après paiement").not.toBe("assigned");
});
