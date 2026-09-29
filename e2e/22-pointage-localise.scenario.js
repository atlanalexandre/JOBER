// Pointage d'arrivée localisé (29/09/2026).
//
// Le serveur ne voyait jamais la position du prestataire : un bouton de secours
// permettait de pointer de n'importe où, sans que rien ne le distingue d'un
// vrai pointage sur place. Désormais, la position est comparée UNE FOIS à
// l'adresse ; seuls un constat et une distance sont gardés, et le pointage
// n'est jamais bloqué.
//
// Prérequis : migration 2026-09-29_pointage_localise.sql.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

// L'adresse de reservationPayee : 10 rue de Rivoli, Paris (4e).
const RIVOLI = { lat: 48.8557, lng: 2.3589 };
const MARSEILLE = { lat: 43.2965, lng: 5.3698 };

async function prestationSurLePointDeCommencer() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, debutMs: Date.now() + 5 * 60e3, heures: 2 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  return { p, c, m };
}

async function constat(id) {
  const [l] = await sql(`select arrived_at, arrivee_localisation, arrivee_distance_m from missions where id = '${id}'`);
  return l;
}

test("sur place : pointage enregistré, constat « sur place »", async () => {
  const { p, m } = await prestationSurLePointDeCommencer();
  const r = await api("/api/missions", { action: "checkin_mission", mission_id: m.id, ...RIVOLI, precision: 20 }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const l = await constat(m.id);
  expect(l.arrived_at).not.toBeNull();
  expect(l.arrivee_localisation).toBe("sur_place");
  expect(l.arrivee_distance_m).toBeLessThan(300);
});

test("pointé depuis Marseille : enregistré quand même, mais constaté éloigné", async () => {
  const { p, m } = await prestationSurLePointDeCommencer();
  const r = await api("/api/missions", { action: "checkin_mission", mission_id: m.id, ...MARSEILLE, precision: 15 }, p.jeton);
  expect(r.statut, "le pointage n'est jamais bloqué").toBe(200);
  const l = await constat(m.id);
  expect(l.arrived_at).not.toBeNull();
  expect(l.arrivee_localisation).toBe("eloignee");
  expect(l.arrivee_distance_m).toBeGreaterThan(600_000);
});

test("sans position : enregistré, et dit comme tel", async () => {
  const { p, m } = await prestationSurLePointDeCommencer();
  const r = await api("/api/missions", { action: "checkin_mission", mission_id: m.id }, p.jeton);
  expect(r.statut).toBe(200);
  const l = await constat(m.id);
  expect(l.arrivee_localisation).toBe("position_absente");
  expect(l.arrivee_distance_m).toBeNull();
});

test("le prestataire ne peut pas s'écrire « sur place » lui-même", async () => {
  const { p, m } = await prestationSurLePointDeCommencer();
  await api("/api/missions", { action: "checkin_mission", mission_id: m.id, ...MARSEILLE }, p.jeton);
  // Même chemin que la console du navigateur : clé publique, jeton du prestataire.
  const [{ ok }] = await sql(`select not has_column_privilege('authenticated', 'public.missions', 'arrivee_localisation', 'UPDATE') as ok`);
  expect(ok, "colonne fermée à l'écriture depuis le navigateur").toBe(true);
  expect((await constat(m.id)).arrivee_localisation).toBe("eloignee");
});
