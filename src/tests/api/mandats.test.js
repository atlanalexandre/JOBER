import { describe, it, expect } from "vitest";
import { mandatsManquants, messageMandatsManquants } from "../../../api/_mandats.js";

// L'article 7.2 des CGPS annonce que le mandat d'encaissement est recueilli
// « préalablement à tout encaissement ». Rien ne le vérifiait : ALANE encaissait
// et versait pour le compte de prestataires qui n'avaient rien signé.
describe("mandatsManquants()", () => {
  const signe = "2026-08-27T09:00:00.000Z";

  it("ne bloque rien quand les deux sont signés", () => {
    expect(mandatsManquants({ mandat_facturation_at: signe, mandat_encaissement_at: signe })).toEqual([]);
  });

  it("nomme celui qui manque, et pas l'autre", () => {
    expect(mandatsManquants({ mandat_facturation_at: signe, mandat_encaissement_at: null }))
      .toEqual(["le mandat d'encaissement"]);
    expect(mandatsManquants({ mandat_facturation_at: null, mandat_encaissement_at: signe }))
      .toEqual(["le mandat de facturation"]);
  });

  it("les signale tous les deux quand aucun n'est signé", () => {
    expect(mandatsManquants({})).toHaveLength(2);
  });

  // En cas de doute sur une pièce contractuelle, on n'ouvre pas : un profil
  // illisible ne doit pas valoir autorisation.
  it("refuse aussi sur un profil absent ou illisible", () => {
    for (const v of [null, undefined, "", 0, "profil"]) {
      expect(mandatsManquants(v)).toHaveLength(2);
    }
  });
});

describe("messageMandatsManquants()", () => {
  it("dit quoi faire, et où", () => {
    const m = messageMandatsManquants(["le mandat de facturation"]);
    expect(m).toContain("le mandat de facturation");
    expect(m).toContain("onglet Revenus");
    expect(m).toContain("7.2");
  });
});
