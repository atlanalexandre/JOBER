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
