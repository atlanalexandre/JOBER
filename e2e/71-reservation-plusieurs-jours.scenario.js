// Réservation sur plusieurs jours par l'écran (relecture du 06/10/2026).
//
// L'écran proposait « Plage de dates » et faisait payer toutes les journées,
// mais ne transmettait que la date de DÉBUT : la prestation était enregistrée
// comme une seule journée. Le serveur, qui revérifie le montant, ne voyait
// alors qu'un jour pour un prix de plusieurs — et refusait le paiement.
// Aucune réservation sur plusieurs jours ne pouvait aboutir.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, payerPrestation } from "./fabrique.js";
import { connexion, reserverJusquauPaiement } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

test("une réservation de trois jours est enregistrée sur trois jours, et se paie", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  const debut = await reserverJusquauPaiement(page, { nbJours: 3 });

  const [m] = await sql(`select id, date, date_debut::date::text as debut, date_fin::date::text as fin, hours, tarif_horaire, montant_total
    from missions where client_id = '${c.id}' order by created_at desc limit 1`);
  expect(m, "la prestation est créée avant le paiement").toBeTruthy();
  expect(String(m.date).slice(0, 10), "la date reste le premier jour").toBe(debut);
  expect(m.debut, "premier jour").toBe(debut);
  expect(m.fin, "dernier jour : deux jours après le premier").toBe(new Date(new Date(`${debut}T12:00:00Z`).getTime() + 2 * 864e5).toISOString().slice(0, 10));
  // 3 jours × 8 h × 13 € = 312 €, plus les frais de service.
  expect(Number(m.montant_total)).toBeGreaterThan(312);

  const r = await payerPrestation({ jetonClient: c.jeton, missionId: m.id, montant: Number(m.montant_total), prestataireId: p.id });
  expect(r.etape, `paiement : ${JSON.stringify(r)}`).toBe("ok");
  expect(r.centimesPreleves, "Stripe prélève les trois journées").toBe(Math.round(Number(m.montant_total) * 100));
});
