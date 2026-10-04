// Le passage mensuel ne déclare plus « remboursée » une demande qu'il n'a pas
// remboursée (relecture du 04/10/2026).
//
// Un second bloc d'expiration, exécuté le 1er du mois, ne lisait pas le paiement :
// il passait toute demande expirée en « refusée » sans rembourser, et écrivait
// au client « Votre paiement a été intégralement remboursé » — y compris pour
// celles que le premier bloc remettait en attente parce que Stripe avait refusé
// le remboursement.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("demande expirée dont le remboursement échoue : ni « refusée » ni annoncée remboursée", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  // Expirée, et un paiement que Stripe ne connaît pas : le remboursement échoue.
  await sql(`update missions set acceptance_deadline = now() - interval '1 hour',
             stripe_payment_intent = 'pi_inexistant_recette_${Date.now()}' where id = '${m.id}'`);

  const r = await tachePlanifiee("/api/cron-reset-monthly");
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "remise en attente pour un prochain essai, pas close sans remboursement").toBe("pending_acceptance");
  const faux = await sql(`select count(*)::int n from notifications where user_id = '${c.id}'
                          and body like '%intégralement remboursé%'`);
  expect(faux[0].n, "aucun message de remboursement sans remboursement").toBe(0);
});
