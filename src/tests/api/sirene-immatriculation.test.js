import { describe, it, expect, vi, afterEach } from "vitest";
import { dateImmatriculation } from "../../../api/_sirene.js";

// Ce module décide, indirectement, de la suspension d'un compte. La règle qui
// compte n'est pas « trouver la date » mais « ne jamais inventer » : tout ce
// qui n'est pas une date lisible doit ressortir en `null`, c'est-à-dire en
// « on ne sait pas », et un `null` ne suspend personne (voir _documents.js).

const repondre = (json, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => json });

afterEach(() => { vi.unstubAllGlobals(); });

describe("la lecture de la date d'immatriculation", () => {
  it("lit date_creation", async () => {
    vi.stubGlobal("fetch", repondre({ results: [{ date_creation: "2024-03-15" }] }));
    expect(await dateImmatriculation("11111111111111")).toBe("2024-03-15");
  });

  it("se rabat sur celle du siège", async () => {
    vi.stubGlobal("fetch", repondre({ results: [{ siege: { date_creation: "2022-07-01" } }] }));
    expect(await dateImmatriculation("22222222222222")).toBe("2022-07-01");
  });

  it("ignore une date qui n'a pas la forme attendue", async () => {
    vi.stubGlobal("fetch", repondre({ results: [{ date_creation: "15/03/2024" }] }));
    expect(await dateImmatriculation("33333333333333")).toBeNull();
  });

  it("renvoie null si l'entreprise est introuvable", async () => {
    vi.stubGlobal("fetch", repondre({ results: [] }));
    expect(await dateImmatriculation("44444444444444")).toBeNull();
  });

  it("renvoie null quand le service refuse", async () => {
    vi.stubGlobal("fetch", repondre({}, false, 429));
    expect(await dateImmatriculation("55555555555555")).toBeNull();
  });

  it("renvoie null quand le réseau tombe, sans lever", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
    await expect(dateImmatriculation("66666666666666")).resolves.toBeNull();
  });

  it("n'appelle rien pour un SIRET absent ou illisible", async () => {
    const f = repondre({ results: [] });
    vi.stubGlobal("fetch", f);
    expect(await dateImmatriculation(null)).toBeNull();
    expect(await dateImmatriculation("12345")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("n'interroge le service qu'une fois par SIRET", async () => {
    const f = repondre({ results: [{ date_creation: "2020-01-02" }] });
    vi.stubGlobal("fetch", f);
    await dateImmatriculation("77777777777777");
    await dateImmatriculation("777 777 777 77777".replace(/ /g, "").slice(0, 14));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("accepte un SIREN à neuf chiffres et les séparateurs", async () => {
    vi.stubGlobal("fetch", repondre({ results: [{ date_creation: "2019-09-09" }] }));
    expect(await dateImmatriculation("888 888 888")).toBe("2019-09-09");
  });
});
