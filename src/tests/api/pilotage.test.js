// Pilotage de l'activité (01/11/2026) : demandes servies, délai d'acceptation,
// retour des clients — sur les seules réservations PAYÉES.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chiffresPilotage, estServie } from "../../../api/_pilotage.js";

const T = Date.parse("2026-11-01T12:00:00Z");
const jour = (n) => new Date(T - n * 86400000).toISOString();
const m = (extra) => ({ id: Math.random().toString(36).slice(2), client_id: "c1", prestataire_id: "p1", status: "completed",
  created_at: jour(1), stripe_payment_intent: "pi_x", sector: "hotellerie", ...extra });
const depuisMs = T - 30 * 86400000;

describe("demandes servies", () => {
  it("parmi les réservations payées et tranchées ; les paniers abandonnés ne comptent pas", () => {
    const c = chiffresPilotage([
      m({ status: "completed" }), m({ status: "assigned" }), m({ status: "refused", prestataire_id: null }),
      m({ status: "open", stripe_payment_intent: null }), // panier abandonné
      m({ status: "pending_acceptance" }),                // en attente : ni servie ni perdue
    ], { depuisMs });
    expect(c).toMatchObject({ demandes: 4, en_attente: 1, tranchees: 3, servies: 2 });
    expect(c.taux_servies).toBeCloseTo(2 / 3);
  });
  it("une annulation n'est jamais servie, et reste dans le calcul — le chiffre peut sous-estimer, jamais rassurer à tort (02/11/2026)", () => {
    // Annulée par le traitement automatique faute de prestataire, ou retirée par le prestataire après acceptation.
    const c = chiffresPilotage([m({ status: "completed" }), m({ status: "cancelled" }), m({ status: "cancelled", acceptee_at: jour(1) })], { depuisMs });
    expect(c).toMatchObject({ tranchees: 3, servies: 1, annulees: 2 });
    expect(estServie({ status: "cancelled", acceptee_at: jour(1) })).toBe(false);
  });
  it("« remplaçant recherché » est en attente, pas servie : le webhook la pose aussi sans qu'aucun prestataire ait accepté", () => {
    const c = chiffresPilotage([m({ status: "needs_replacement", prestataire_id: null })], { depuisMs });
    expect(c).toMatchObject({ en_attente: 1, tranchees: 0, servies: 0 });
    expect(estServie({ status: "needs_replacement" })).toBe(false);
  });
  it("hors période : non comptée", () => {
    expect(chiffresPilotage([m({ created_at: jour(40) })], { depuisMs }).demandes).toBe(0);
  });
  it("aucune demande : taux « — » (null), pas 0 %", () => {
    expect(chiffresPilotage([], { depuisMs }).taux_servies).toBeNull();
  });
});

describe("délai d'acceptation", () => {
  it("médiane, en minutes, seulement si la base l'enregistre", () => {
    const ms = [
      m({ created_at: "2026-10-31T10:00:00Z", acceptee_at: "2026-10-31T10:30:00Z" }),
      m({ created_at: "2026-10-31T10:00:00Z", acceptee_at: "2026-10-31T11:00:00Z" }),
      m({ created_at: "2026-10-31T10:00:00Z", acceptee_at: "2026-10-31T13:00:00Z" }),
    ];
    expect(chiffresPilotage(ms, { depuisMs, delaiDisponible: true })).toMatchObject({ delai_mediane_min: 60, delai_mesures: 3 });
    expect(chiffresPilotage(ms, { depuisMs })).toMatchObject({ delai_disponible: false, delai_mediane_min: null });
  });
});

describe("retour des clients", () => {
  it("clients servis au moins deux fois, sur toute l'histoire", () => {
    const c = chiffresPilotage([
      m({ client_id: "a", created_at: jour(60) }), m({ client_id: "a" }),   // revenu
      m({ client_id: "b" }),                                                 // une fois
      m({ client_id: "c", status: "refused" }), m({ client_id: "c", status: "refused" }), // jamais servi
    ], { depuisMs });
    expect(c).toMatchObject({ clients_servis: 2, clients_revenus: 1 });
    expect(c.taux_retour).toBe(0.5);
  });
});

describe("retour des clients et séries (02/11/2026)", () => {
  it("les semaines suivantes d'une série ne font pas d'un client un « client qui revient »", () => {
    const c = chiffresPilotage([
      m({ client_id: "s" }), m({ client_id: "s", parent_mission_id: "x1" }), m({ client_id: "s", parent_mission_id: "x2" }),
    ], { depuisMs });
    expect(c).toMatchObject({ clients_servis: 1, clients_revenus: 0 });
  });
});

describe("par secteur", () => {
  it("où il manque des prestataires", () => {
    const c = chiffresPilotage([m({ sector: "hotellerie" }), m({ sector: "hotellerie", status: "refused" }), m({ sector: "proprete" })], { depuisMs });
    expect(c.par_secteur).toEqual([{ secteur: "hotellerie", demandes: 2, servies: 1 }, { secteur: "proprete", demandes: 1, servies: 1 }]);
  });
});

describe("l'action et l'écran", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const action = bo.slice(bo.indexOf('if (action === "pilotage_activite")'), bo.indexOf("// ── Journal comptable du mois"));
  it("toutes les réservations payées (lireTout) ; le délai lu à part, pour qu'une migration absente ne casse pas le tableau", () => {
    expect(action).toMatch(/lireTout\(`\$\{SUPABASE_URL\}\/rest\/v1\/missions\?stripe_payment_intent=not\.is\.null/);
    expect(action).toMatch(/missions\?acceptee_at=not\.is\.null`/);
    expect(action).toContain("&select=id,acceptee_at&order=id.asc");
    expect(action).toContain("select=id,client_id,prestataire_id,status,created_at,stripe_payment_intent,sector,parent_mission_id&");
    // Douze mois au plus, jamais toute l'histoire (02/11/2026).
    expect(action).toMatch(/&created_at=gte\.\$\{encodeURIComponent\(depuisLecture\)\}/);
  });
  it("le tableau est en tête du tableau de bord", () => {
    const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
    expect(ecran).toMatch(/\{tab==="dashboard" && <>[\s\S]{0,300}<BOPilotage \/>/);
  });
});

// Relecture du 03/11/2026 : la première acceptation depuis `needs_replacement`
// (paiement dont le prestataire n'a pas été retenu) n'était jamais datée.
import { readFileSync as lireFichier } from "node:fs";
describe("migration 2026-11-03 : première acceptation après un prestataire non retenu", () => {
  const sqlMig = lireFichier(new URL("../../../migrations/2026-11-03_pilotage_acceptee_at_remplacement.sql", import.meta.url), "utf8");
  it("date l'acceptation depuis needs_replacement, pour les seules prestations récentes et jamais acceptées", () => {
    expect(sqlMig).toMatch(/OLD\.acceptee_at IS NULL[\s\S]*OLD\.status = 'needs_replacement' AND OLD\.created_at >= '2026-11-03/);
  });
  it("ne réécrit aucune donnée", () => {
    expect(sqlMig).not.toMatch(/^\s*(UPDATE|DELETE|DROP)\b/m);
  });
});
