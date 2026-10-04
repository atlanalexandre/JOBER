// Une prestation commencée ne s'annule plus avec remboursement intégral
// (relecture du 03/10/2026).
//
// Le client pouvait « annuler » une prestation déjà pointée — tout lui était
// rendu sauf les frais — et le prestataire, une journée commencée : dans les
// deux cas, les heures faites n'étaient payées à personne.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

async function prestationCommencee() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 8 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const aujourdhui = new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const ilYa6h = new Date(Date.now() - 6 * 3600e3).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  await sql(`update missions set date = '${aujourdhui}', date_debut = '${aujourdhui}', date_fin = '${aujourdhui}',
             heure_debut = '${ilYa6h}', started_at = now() - interval '6 hours' where id = '${m.id}'`);
  return { p, c, m };
}

test("le client n'annule pas une prestation commencée : il l'interrompt", async () => {
  const { c, m } = await prestationCommencee();
  const r = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  expect(JSON.parse(r.texte).code).toBe("prestation_commencee");
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "ni annulée ni remboursée").toBe("assigned");
});

test("le prestataire n'annule pas une journée commencée", async () => {
  const { p, m } = await prestationCommencee();
  const r = await api("/api/missions", { action: "presta_cancel", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  expect(JSON.parse(r.texte).code).toBe("prestation_commencee");
  const [l] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(l.status).toBe("assigned");
  expect(l.prestataire_id).toBe(p.id);
});
