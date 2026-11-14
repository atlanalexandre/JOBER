// Une demande dépassée que personne n'a prise, et que personne n'a payée, est
// close par la tâche planifiée. Depuis le 13/11/2026, Stripe est interrogé avant
// (un paiement non rattaché serait rendu) — mais la recherche envoyée mêlait AND
// et OR, que Stripe refuse : la vérification échouait à chaque passage, et la
// clôture était reportée sans fin (relecture du 14/11/2026). Ce scénario joue la
// vraie recherche, contre le vrai Stripe de test.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, tachePlanifieeJusqua } from "./fabrique.js";

test("demande dépassée sans paiement : la tâche planifiée la clôt", async () => {
  const c = await client();
  const [m] = await sql(`insert into missions (client_id, status, sector, metier, titre, date, heure_debut, hours, tarif_horaire, ville)
     values ('${c.id}', 'open', 'hotellerie', 'Femme/Valet de chambre', 'Recette 103', (now() at time zone 'Europe/Paris')::date - 1, '09:00', 4, 13, 'Paris') returning id`);
  const statut = async () => (await sql(`select status from missions where id = '${m.id}'`))[0].status;
  // 20 demandes par passage, tirées au hasard : plusieurs passages au besoin.
  const t = await tachePlanifieeJusqua(async () => (await statut()) !== "open", { max: 5 });
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  expect(await statut()).toBe("closed");
});
