// Un versement « échoué » se relance depuis le back-office (30/09/2026).
// Il n'existait aucun moyen de le faire : « Programmer » refuse un versement déjà
// programmé, et retenir puis lever écrivait au prestataire que son versement était
// suspendu.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("versement échoué : « Relancer » le remet en attente, une seule fois", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await sql(`update missions set status = 'completed', payout_status = 'failed', payout_amount = 104 where id = '${m.id}'`);
  const r = await bo("relancer_versement", { mission_id: m.id });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select payout_status from missions where id = '${m.id}'`);
  expect(l.payout_status).toBe("pending");
  expect((await bo("relancer_versement", { mission_id: m.id })).statut, "déjà en attente : rien à relancer").toBe(409);
});
