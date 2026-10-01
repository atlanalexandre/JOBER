// Une prestation sur plusieurs jours finit le DERNIER jour (audit des prestations, 01/10/2026).
//
// La fin était calculée sur la seule première date : le prestataire pouvait
// confirmer la fin d'une série dès le soir du premier jour, et la validation
// automatique la clôturait — et la payait en entier — 24 h plus tard.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const jour = (decalage) => new Date(Date.now() + decalage * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

async function serieEnCours() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // Série commencée il y a deux jours, qui se termine dans trois.
  await sql(`update missions set date = '${jour(-2)}', date_debut = '${jour(-2)}', date_fin = '${jour(3)}',
             heure_debut = '08:00', started_at = '${jour(-2)}T06:05:00Z' where id = '${m.id}'`);
  return { p, c, m };
}

test("le prestataire ne confirme pas la fin d'une série en cours", async () => {
  const { p, m } = await serieEnCours();
  const r = await api("/api/missions", { action: "validate_presta", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(400);
  const [l] = await sql(`select validation_prestataire from missions where id = '${m.id}'`);
  expect(l.validation_prestataire).toBe(false);
});

test("la validation automatique ne clôture pas une série en cours", async () => {
  const { m } = await serieEnCours();
  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status, payout_status from missions where id = '${m.id}'`);
  expect(l.status, "toujours en cours").toBe("assigned");
  expect(l.payout_status).toBeNull();
});
