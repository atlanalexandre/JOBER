// Réaffectation d'une prestation au back-office (relecture du 04/10/2026).
//
// Le prestataire était cherché sur une seule page de comptes, à la casse près, et
// n'importe quel compte trouvé — même client — recevait la prestation.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, bo } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("l'adresse saisie en majuscules retrouve le prestataire", async () => {
  const p = await prestataireOperationnel();
  const autre = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const r = await bo("reassign_mission", { mission_id: m.id, new_presta_email: autre.email.toUpperCase(), reason: "recette" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select prestataire_id from missions where id = '${m.id}'`);
  expect(l.prestataire_id).toBe(autre.id);
});

test("un compte client ne reçoit pas la prestation", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const intrus = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const r = await bo("reassign_mission", { mission_id: m.id, new_presta_email: intrus.email, reason: "recette" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select prestataire_id from missions where id = '${m.id}'`);
  expect(l.prestataire_id, "inchangé").toBe(p.id);
});
