// Le prestataire déclare son SIRET lui-même, UNE fois, dans son espace
// (13/11/2026). Vérifié par le serveur avant d'être enregistré ; un SIRET déjà
// présent ne se remplace pas — c'était la faille fermée le 14/10/2026
// (repousser l'échéance URSSAF en changeant de SIRET).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { validerSiret } from "../../../api/_siret.js";

describe("validerSiret", () => {
  it("14 chiffres et clé de Luhn ; espaces et points acceptés", () => {
    expect(validerSiret("732 829 320 00074")).toEqual({ ok: true, siret: "73282932000074" });
    expect(validerSiret("73282932000075").ok).toBe(false);
    expect(validerSiret("123").erreur).toContain("14 chiffres");
    expect(validerSiret(null).ok).toBe(false);
  });
  it("La Poste (SIREN 356000000) : sa règle propre est admise", () => {
    expect(validerSiret("35600000000048").ok).toBe(true);
  });
});

const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";

function simuler({ fiche = { role: "prestataire", siret: null, missions_enabled: false }, sirene = { siren: "732829320", nom_complet: "MON ENTREPRISE", etat_administratif: "A", siege: { siret: "73282932000074" } }, ecrites = [{ id: PRESTA }], listeNoire = [] } = {}) {
  const patchs = [];
  patchs.meta = [];
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    if (u.endsWith("/auth/v1/user")) return json({ id: PRESTA });
    if (u.includes("/profiles?") && u.includes("select=status")) return json([{ status: "pending" }]);
    if (u.includes(`/profiles?id=eq.${PRESTA}&select=role,siret`)) return json([fiche]);
    if (u.includes("/account_blacklist?")) return json(listeNoire);
    if (u.includes(`/auth/v1/admin/users/${PRESTA}`) && m === "PUT") { patchs.meta.push(JSON.parse(String(o.body))); return json({ id: PRESTA }); }
    if (u.includes(`/auth/v1/admin/users/${PRESTA}`)) return json({ id: PRESTA, user_metadata: { prenom: "Léa", role: "prestataire" } });
    if (u.includes("recherche-entreprises")) return json({ results: sirene ? [sirene] : [] });
    if (u.includes("/profiles?") && m === "PATCH") { patchs.push({ u, corps: JSON.parse(String(o.body)) }); return json(ecrites); }
    return json([]);
  }));
  return patchs;
}
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; r.send = () => r; r.end = () => r; r.setHeader = () => r; return r; };
const declarer = async (siret) => {
  const { default: handler } = await import("../../../api/support.js");
  const r = reponse();
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { action: "declarer_siret", siret }, query: {} }, r);
  return r;
};

describe("action declarer_siret", () => {
  // Module neuf à chaque test : la limite d'essais (5 par 10 min) vit en mémoire.
  beforeEach(() => { vi.resetModules(); for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("SIRET valide, entreprise active, aucun SIRET encore : enregistré, conditionné à « encore aucun »", async () => {
    const patchs = simuler();
    const r = await declarer("732 829 320 00074");
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps.entreprise).toBe("MON ENTREPRISE");
    expect(patchs).toHaveLength(1);
    expect(patchs[0].u).toContain("siret=is.null");
    expect(patchs[0].corps).toEqual({ siret: "73282932000074" });
    // Aussi dans le compte : la liste noire et la validation l'y lisent (13/11/2026).
    expect(patchs.meta).toEqual([{ user_metadata: { prenom: "Léa", role: "prestataire", siret: "73282932000074" } }]);
  });
  it("accès aux prestations déjà ouvert : refusé — un premier SIRET y reculerait l'échéance URSSAF", async () => {
    const patchs = simuler({ fiche: { role: "prestataire", siret: null, missions_enabled: true } });
    const r = await declarer("73282932000074");
    expect(r.statut).toBe(409);
    expect(patchs).toHaveLength(0);
  });
  it("un SIREN de 9 chiffres admis à l'inscription se complète par un SIRET de la même entreprise, jamais d'une autre", async () => {
    let patchs = simuler({ fiche: { role: "prestataire", siret: "732829320", missions_enabled: false } });
    expect((await declarer("73282932000074")).statut).toBe(200);
    expect(patchs[0].u).toContain("siret=eq.732829320");
    patchs = simuler({ fiche: { role: "prestataire", siret: "552100554", missions_enabled: false } });
    expect((await declarer("73282932000074")).statut).toBe(409);
    expect(patchs).toHaveLength(0);
  });
  it("SIRET d'un compte supprimé (liste noire) : l'essai gratuit n'est pas rendu", async () => {
    const patchs = simuler({ listeNoire: [{ id: "bl1", missions_completed_month: 3 }] });
    expect((await declarer("73282932000074")).statut).toBe(200);
    expect(patchs.find(p => p.corps.trial_exhausted)?.corps).toEqual({ trial_exhausted: true, missions_completed_month: 3 });
  });
  it("un SIRET déjà enregistré ne se remplace pas (409), rien n'est écrit", async () => {
    const patchs = simuler({ fiche: { role: "prestataire", siret: "73282932000074", missions_enabled: false } });
    const r = await declarer("35600000000048");
    expect(r.statut).toBe(409);
    expect(r.corps.error).toContain("support@alane.fr");
    expect(patchs).toHaveLength(0);
  });
  it("clé invalide, entreprise introuvable ou fermée, client : refusé, rien n'est écrit", async () => {
    const ecritures = [];
    const cas = [
      [{}, "73282932000075", 400],
      [{ sirene: null }, "73282932000074", 400],
      [{ sirene: { siren: "732829320", nom_complet: "X", etat_administratif: "F", siege: { siret: "73282932000074" } } }, "73282932000074", 400],
      [{ fiche: { role: "client", siret: null, missions_enabled: false } }, "73282932000074", 403],
    ];
    for (const [options, siret, attendu] of cas) {
      const patchs = simuler(options);
      const r = await declarer(siret);
      expect(r.statut, JSON.stringify(r.corps)).toBe(attendu);
      ecritures.push(...patchs);
    }
    expect(ecritures).toHaveLength(0);
  });
  it("cinq essais par dix minutes : le registre SIRENE n'est pas un relais", async () => {
    simuler({ sirene: null });
    for (let i = 0; i < 5; i++) expect((await declarer("73282932000074")).statut).toBe(400);
    expect((await declarer("73282932000074")).statut).toBe(429);
  });
  it("écriture concurrente : un autre envoi a écrit entre-temps (0 ligne) — 409", async () => {
    simuler({ ecrites: [] });
    expect((await declarer("73282932000074")).statut).toBe(409);
  });
});

describe("l'écran et les e-mails", () => {
  const ecran = readFileSync(new URL("../../components/presta-screens.jsx", import.meta.url), "utf8");
  it("la liste reste affichée tant que le SIRET manque, même fermée ; cochée seulement par 14 chiffres sur la fiche", () => {
    expect(ecran).toContain("if (dismissed && siretComplet) return null;");
    expect(ecran).toContain('const siretComplet = /^\\d{14}$/.test(String(profil.siret || ""));');
  });
  it("la liste « Pour recevoir des prestations » propose la saisie quand il n'y a pas de SIRET", () => {
    expect(ecran).toContain('{ id:"siret",   label:"Numéro SIRET renseigné"');
    expect(ecran).toContain('item.id === "siret" && <SaisieSiret');
    expect(ecran).toContain('action: "declarer_siret"');
  });
  it("la relance et l'e-mail de validation renvoient vers cette saisie", () => {
    const vagues = readFileSync(new URL("../../../api/_vagues.js", import.meta.url), "utf8");
    const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    for (const t of [vagues, bo]) expect(t).toContain("rubrique « Pour recevoir des prestations »");
  });
});
