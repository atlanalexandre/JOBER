import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { etatSecteur, etatDesSecteurs, etatSecteursAvecCache, SECTEURS_CONNUS, SEUIL_PAR_DEFAUT } from "../../../api/_secteurs.js";

// ═══════════════════════════════════════════════════════════════════════════
// Ouverture et fermeture des secteurs
// ═══════════════════════════════════════════════════════════════════════════
//
// Un seuil identique existait, à 30, et n'a jamais fonctionné : l'action qui
// comptait les prestataires répondait 401. Le jour où ce défaut a été corrigé,
// appliquer le seuil aurait fermé TOUS les secteurs d'un coup.
//
// C'est exactement ce que ces tests vérifient : que la règle fait ce qu'on
// croit, y compris dans le cas qui a fait retirer la précédente.

const R = (seuil = 20, fermes = [], forces = []) => ({ seuil, fermes, forces });

describe("seuil d'ouverture automatique", () => {
  it("ferme un secteur sous le seuil", () => {
    const e = etatSecteur("proprete", 3, R(20));
    expect(e.open).toBe(false);
    expect(e.sous_seuil).toBe(true);
  });

  it("ouvre un secteur qui atteint exactement le seuil", () => {
    expect(etatSecteur("proprete", 20, R(20)).open).toBe(true);
  });

  it("ouvre un secteur au-dessus du seuil", () => {
    expect(etatSecteur("proprete", 47, R(20)).open).toBe(true);
  });

  it("un seuil à zéro ouvre tout — c'est la sortie de secours", () => {
    const e = etatSecteur("proprete", 0, R(0));
    expect(e.open).toBe(true);
    expect(e.sous_seuil).toBe(false);
  });
});

describe("fermeture d'autorité", () => {
  it("ferme un secteur même largement au-dessus du seuil", () => {
    const e = etatSecteur("proprete", 500, R(20, ["proprete"]));
    expect(e.open).toBe(false);
    expect(e.disabled).toBe(true);
  });

  it("l'emporte sur l'ouverture forcée — entre deux réglages contradictoires, le plus prudent", () => {
    const e = etatSecteur("proprete", 0, R(20, ["proprete"], ["proprete"]));
    expect(e.open).toBe(false);
    expect(e.disabled).toBe(true);
    expect(e.force_ouvert).toBe(false);
  });
});

describe("ouverture forcée", () => {
  // Sans elle, aucune plateforme ne démarre : il faudrait vingt prestataires
  // pour accepter la première commande, et une première commande pour attirer
  // des prestataires.
  it("ouvre un secteur à zéro prestataire", () => {
    const e = etatSecteur("hotellerie", 0, R(20, [], ["hotellerie"]));
    expect(e.open).toBe(true);
    expect(e.force_ouvert).toBe(true);
  });

  it("ne déborde pas sur les autres secteurs", () => {
    const etats = etatDesSecteurs({ hotellerie: 1 }, R(20, [], ["hotellerie"]));
    expect(etats.hotellerie.open).toBe(true);
    expect(etats.proprete.open).toBe(false);
    expect(etats.logistique.open).toBe(false);
  });

  it("signale quand même que le secteur est sous le seuil", () => {
    const e = etatSecteur("hotellerie", 1, R(20, [], ["hotellerie"]));
    expect(e.open).toBe(true);
    expect(e.sous_seuil).toBe(true); // le backoffice doit pouvoir l'afficher
  });
});

describe("état de l'ensemble des secteurs", () => {
  it("couvre tous les secteurs connus, même absents du décompte", () => {
    const etats = etatDesSecteurs({}, R(20));
    expect(Object.keys(etats).sort()).toEqual([...SECTEURS_CONNUS].sort());
    expect(Object.values(etats).every(e => e.count === 0 && !e.open)).toBe(true);
  });

  it("reproduit la situation qui a fait retirer l'ancien seuil", () => {
    // 1 prestataire en hôtellerie, 0 ailleurs, seuil à 20 : tout ferme.
    const etats = etatDesSecteurs({ hotellerie: 1 }, R(20));
    expect(Object.values(etats).some(e => e.open)).toBe(false);
  });
});

describe("valeur par défaut", () => {
  it("le seuil par défaut est explicite", () => {
    expect(SEUIL_PAR_DEFAUT).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Le cache ne doit pas figer les réglages
// ═══════════════════════════════════════════════════════════════════════════
//
// Constaté en production le 16/08/2026. `etatSecteursAvecCache` mettait en
// cache la DÉCISION complète, réglages compris, pendant cinq minutes. Or
// /api/stripe-intent et /api/missions sont deux fonctions serverless
// distinctes, chacune avec sa propre mémoire : après une ouverture de secteur
// depuis le backoffice, l'une pouvait avoir un cache frais et l'autre un cache
// vieux de quatre minutes.
//
// Résultat : le paiement accepté par le contrôle d'avant encaissement, puis
// l'affectation refusée juste après — exactement ce que ce contrôle devait
// empêcher. Le client était débité puis remboursé, pour rien.

describe("cache de l'état des secteurs", () => {
  const REGLAGES_URL = "platform_settings";
  let reglagesLus;

  const monterFetch = (forces) => {
    reglagesLus = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      if (u.includes(REGLAGES_URL)) {
        reglagesLus++;
        return { ok: true, json: async () => [
          { key: "sector_min_prestataires", value: 20 },
          { key: "disabled_sectors", value: [] },
          { key: "forced_open_sectors", value: forces },
        ] };
      }
      if (u.includes("/auth/v1/admin/users")) {
        return { ok: true, json: async () => ({ users: [{ id: "p1", user_metadata: { secteur: "hotellerie" } }] }) };
      }
      return { ok: true, json: async () => [{ id: "p1" }] };
    }));
  };

  beforeEach(() => { delete globalThis.__alaneSectorCounts; });
  afterEach(() => { vi.unstubAllGlobals(); delete globalThis.__alaneSectorCounts; });

  it("relit les réglages à chaque appel, même quand le décompte est en cache", async () => {
    monterFetch([]);
    const avant = await etatSecteursAvecCache("https://x", {});
    expect(avant.hotellerie.open).toBe(false);
    expect(reglagesLus).toBe(1);

    // Le secteur est ouvert de force depuis le backoffice. L'effet doit être
    // immédiat : c'est une décision humaine, pas une donnée qui se périme.
    monterFetch(["hotellerie"]);
    const apres = await etatSecteursAvecCache("https://x", {});
    expect(apres.hotellerie.open).toBe(true);
    expect(reglagesLus).toBe(1);
  });

  it("ne recompte pas les prestataires tant que le cache est valide", async () => {
    monterFetch([]);
    await etatSecteursAvecCache("https://x", {});
    const appelsApresLePremier = globalThis.fetch.mock.calls.length;

    await etatSecteursAvecCache("https://x", {});
    // Un seul appel de plus : la lecture des réglages. Pas le recensement des
    // comptes, qui est la partie coûteuse.
    expect(globalThis.fetch.mock.calls.length).toBe(appelsApresLePremier + 1);
  });
});
