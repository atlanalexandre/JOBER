// Suppression d'un compte (api/_suppression.js) — audit du 30/09/2026.
//
// La base refusait la suppression d'un prestataire ayant déjà travaillé, et le
// serveur répondait « supprimé ». L'abonnement Stripe d'un compte supprimé
// continuait d'être prélevé. Ces tests fixent ce que chaque étape rend.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STATUTS_EN_COURS, VERSEMENTS_DUS, resilierAbonnement, supprimerCompteAuth, effacerPieces } from "../../../api/_suppression.js";

const reponse = (status, corps) => ({ ok: status >= 200 && status < 300, status, json: async () => corps, text: async () => JSON.stringify(corps) });

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.STRIPE_SECRET_KEY; });

describe("ce qui bloque une suppression", () => {
  it("compte les prestations à remplacer et en litige comme en cours", () => {
    expect(STATUTS_EN_COURS).toEqual(expect.arrayContaining(["open", "pending_acceptance", "assigned", "needs_replacement", "disputed"]));
  });
  it("compte les virements retenus et à relancer comme encore dus", () => {
    expect(VERSEMENTS_DUS).toEqual(expect.arrayContaining(["pending", "processing", "held", "failed"]));
  });
});

describe("supprimerCompteAuth", () => {
  it("dit non quand la base refuse — c'était un faux « supprimé »", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(500, { msg: "Database error deleting user" }));
    expect(await supprimerCompteAuth("u1", "https://x", {}, "t")).toBe(false);
  });
  it("dit oui quand le compte est supprimé", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(200, {}));
    expect(await supprimerCompteAuth("u1", "https://x", {}, "t")).toBe(true);
  });
});

describe("resilierAbonnement", () => {
  it("n'appelle pas Stripe sans abonnement", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(200, [{ stripe_subscription_id: null }]));
    expect(await resilierAbonnement("u1", "https://x", {}, "t")).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("résilie l'abonnement existant", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(reponse(200, [{ stripe_subscription_id: "sub_1" }]))
      .mockResolvedValueOnce(reponse(200, { id: "sub_1", status: "canceled" }));
    expect(await resilierAbonnement("u1", "https://x", {}, "t")).toBe(true);
    expect(globalThis.fetch.mock.calls[1][0]).toContain("/v1/subscriptions/sub_1");
    expect(globalThis.fetch.mock.calls[1][1].method).toBe("DELETE");
  });
  it("accepte un abonnement déjà disparu chez Stripe", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(reponse(200, [{ stripe_subscription_id: "sub_1" }]))
      .mockResolvedValueOnce(reponse(404, { error: { code: "resource_missing" } }));
    expect(await resilierAbonnement("u1", "https://x", {}, "t")).toBe(true);
  });
  it("refuse de conclure quand Stripe échoue — le compte ne doit pas être supprimé", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(reponse(200, [{ stripe_subscription_id: "sub_1" }]))
      .mockResolvedValueOnce(reponse(500, { error: { message: "panne" } }));
    expect(await resilierAbonnement("u1", "https://x", {}, "t")).toBe(false);
  });
  it("refuse de conclure quand le profil est illisible", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(reponse(500, { message: "x" }));
    expect(await resilierAbonnement("u1", "https://x", {}, "t")).toBe(false);
  });
});

describe("effacerPieces", () => {
  it("efface aussi les fichiers sans fiche, trouvés dans le dossier du compte", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(reponse(200, [{ storage_path: "u1/cni" }]))
      .mockResolvedValueOnce(reponse(200, [{ name: "cni", id: "a" }, { name: "rib", id: "b" }, { name: "sous-dossier", id: null }]))
      .mockResolvedValueOnce(reponse(200, []))
      .mockResolvedValueOnce(reponse(204, null));
    expect(await effacerPieces("u1", "https://x", {}, "t")).toBe(true);
    const suppression = globalThis.fetch.mock.calls[2];
    expect(suppression[0]).toContain("/storage/v1/object/Documents");
    expect(JSON.parse(suppression[1].body).prefixes.sort()).toEqual(["u1/cni", "u1/rib"]);
  });
});
