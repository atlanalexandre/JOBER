// Une erreur du serveur ne devient plus une liste vide (recette du 07/10/2026).
import { describe, it, expect, vi } from "vitest";
import { lireJsonAvecReprise } from "../lib/lecture.js";

const reponse = (statut, corps) => ({ ok: statut < 300, status: statut, json: async () => corps });

describe("lire avec reprise", () => {
  it("une erreur passagère est réessayée, et la liste arrive", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reponse(500, { error: "délai dépassé" }))
      .mockResolvedValueOnce(reponse(200, { prestataires: [{ id: "a" }] }));
    expect(await lireJsonAvecReprise("/api/prestataires", { attenteMs: 0, fetchImpl: f })).toEqual({ prestataires: [{ id: "a" }] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("le corps d'une erreur n'est jamais rendu comme un résultat", async () => {
    const f = vi.fn().mockResolvedValue(reponse(500, { error: "délai dépassé" }));
    await expect(lireJsonAvecReprise("/api/prestataires", { attenteMs: 0, fetchImpl: f })).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("une coupure réseau est aussi réessayée", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(reponse(200, { ok: 1 }));
    expect(await lireJsonAvecReprise("/x", { attenteMs: 0, fetchImpl: f })).toEqual({ ok: 1 });
  });
});

describe("une erreur définitive n'est pas réessayée (relecture du 08/10/2026)", () => {
  it("un 404 échoue tout de suite, sans attendre", async () => {
    const f = vi.fn().mockResolvedValue(reponse(404, { error: "introuvable" }));
    await expect(lireJsonAvecReprise("/api/prestataires", { attenteMs: 10_000, fetchImpl: f })).rejects.toThrow(/404/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("passager malgré un 4xx, ou réponse tronquée (relecture du 09/10/2026)", () => {
  it("une limite de débit (429) et un délai dépassé (408) sont réessayés", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reponse(429, {}))
      .mockResolvedValueOnce(reponse(408, {}))
      .mockResolvedValueOnce(reponse(200, { ok: 1 }));
    expect(await lireJsonAvecReprise("/x", { attenteMs: 0, fetchImpl: f })).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("un 200 au corps tronqué est réessayé", async () => {
    const tronque = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } };
    const f = vi.fn().mockResolvedValueOnce(tronque).mockResolvedValueOnce(reponse(200, { ok: 1 }));
    expect(await lireJsonAvecReprise("/x", { attenteMs: 0, fetchImpl: f })).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("un corps toujours tronqué finit en erreur, jamais en résultat", async () => {
    const tronque = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } };
    const f = vi.fn().mockResolvedValue(tronque);
    await expect(lireJsonAvecReprise("/x", { attenteMs: 0, fetchImpl: f })).rejects.toThrow(/illisible/);
  });
});
