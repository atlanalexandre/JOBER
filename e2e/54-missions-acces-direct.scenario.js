// Accès direct à la table `missions` depuis le navigateur (audit « sécurité », 01/10/2026).
//
// 1. Les demandes ouvertes se lisaient SANS COMPTE, toutes colonnes : adresse et nom
//    du client, description, montant, déclaration de tiers.
// 2. Client et prestataire pouvaient modifier directement les colonnes d'argent de
//    leurs prestations — date du virement, retenue pour contestation bancaire,
//    heures perdues… Le déclencheur ne protégeait que sept colonnes.
import { test, expect, request } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, anon } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });
const SUPABASE = "https://qoizrysxwjmhqwuteajj.supabase.co";

async function rest(methode, chemin, jeton, corps) {
  const k = await anon();
  const c = await request.newContext();
  const r = await c.fetch(`${SUPABASE}/rest/v1/${chemin}`, {
    method: methode, data: corps,
    headers: { apikey: k, Authorization: `Bearer ${jeton || k}`, Prefer: "return=representation", "Content-Type": "application/json" },
  });
  const texte = await r.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* corps non JSON : seul le statut compte */ }
  return { statut: r.status(), json };
}

test("un visiteur sans compte ne lit aucune demande ouverte", async () => {
  const c = await client();
  await sql(`insert into missions (client_id, status, sector, metier, titre, date, heure_debut, hours, tarif_horaire, ville, adresse)
     values ('${c.id}', 'open', 'hotellerie', 'Femme/Valet de chambre', 'Recette 54', current_date + 5, '09:00', 4, 13, 'Paris', '1 rue Secrète')`);
  const r = await rest("GET", "missions?status=eq.open&select=adresse&limit=50", null);
  expect(r.statut).toBe(200);
  expect(r.json.length, "aucune ligne lisible sans compte").toBe(0);
});

test("un autre compte ne lit pas la demande ouverte d'un client", async () => {
  const c = await client();
  const autre = await client();
  const [m] = await sql(`insert into missions (client_id, status, sector, metier, titre, date, heure_debut, hours, tarif_horaire, ville, adresse)
     values ('${c.id}', 'open', 'hotellerie', 'Femme/Valet de chambre', 'Recette 54', current_date + 5, '09:00', 4, 13, 'Paris', '1 rue Secrète') returning id`);
  const r = await rest("GET", `missions?id=eq.${m.id}&select=adresse`, autre.jeton);
  expect(r.json.length).toBe(0);
  const sien = await rest("GET", `missions?id=eq.${m.id}&select=adresse`, c.jeton);
  expect(sien.json.length, "le client lit toujours sa propre demande").toBe(1);
});

test("le prestataire ne modifie pas la date de son virement ni les heures", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await rest("PATCH", `missions?id=eq.${m.id}`, p.jeton, { payout_due_at: "2000-01-01T00:00:00Z", tarif_horaire: 99 });
  await rest("PATCH", `missions?id=eq.${m.id}`, c.jeton, { heures_perdues: 4 });
  const [l] = await sql(`select payout_due_at, tarif_horaire, heures_perdues from missions where id = '${m.id}'`);
  expect(l.payout_due_at, "date du virement intacte").toBeNull();
  expect(Number(l.tarif_horaire)).toBe(13);
  expect(Number(l.heures_perdues || 0), "heures perdues intactes").toBe(0);
});

test("le prestataire ne modifie ni les heures de prolongation, ni la série, ni l'adresse", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await rest("PATCH", `missions?id=eq.${m.id}`, p.jeton, { extra_hours_appliquees: 4 });
  await rest("PATCH", `missions?id=eq.${m.id}`, p.jeton, { recurrence: { type: "weekly" } });
  await rest("PATCH", `missions?id=eq.${m.id}`, p.jeton, { adresse: "Ailleurs" });
  const [l] = await sql(`select extra_hours_appliquees, recurrence, adresse from missions where id = '${m.id}'`);
  expect(Number(l.extra_hours_appliquees || 0), "heures de prolongation intactes").toBe(0);
  expect(l.recurrence, "série intacte").toBeNull();
  expect(l.adresse).toBe("10 rue de Rivoli");
});
