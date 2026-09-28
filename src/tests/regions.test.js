import { describe, it, expect } from "vitest";
import { regionDe, REGIONS } from "../constants/regions.js";

describe("regionDe", () => {
  it("Paris et sa banlieue sont en Île-de-France, par le code postal", () => {
    for (const cp of ["75015", "92100", "93200", "94000", "77000", "78000", "91000", "95100"]) {
      expect(regionDe({ code_postal: cp }), cp).toBe("idf");
    }
  });
  it("sans code postal, quelques grandes villes par leur nom", () => {
    expect(regionDe({ ville: "Paris 15e" })).toBe("idf");
    expect(regionDe({ ville: "Montreuil" })).toBe("idf");
    expect(regionDe({ ville: "Lyon" })).toBe("ara");
    expect(regionDe({ ville: "  MARSEILLE " })).toBe("pac");
  });
  it("le code postal l'emporte sur le nom", () => {
    expect(regionDe({ code_postal: "13001", ville: "Paris" })).toBe("pac");
  });
  it("Corse et outre-mer", () => {
    expect(regionDe({ code_postal: "20000" })).toBe("cor");
    expect(regionDe({ code_postal: "97400" })).toBe("om");
  });
  it("jamais devinée : inconnue reste null", () => {
    expect(regionDe({ ville: "Trifouilly" })).toBeNull();
    expect(regionDe({})).toBeNull();
    expect(regionDe({ code_postal: "abc" })).toBeNull();
  });
  it("chaque département métropolitain appartient à une seule région", () => {
    const vus = new Map();
    for (const [id, r] of Object.entries(REGIONS)) for (const d of r.deps) {
      expect(vus.has(d), `${d} en double`).toBe(false);
      vus.set(d, id);
    }
    // 94 départements métropolitains à deux chiffres (20 couvre la Corse) + 75.
    const metro = [...vus.keys()].filter(d => d.length === 2);
    expect(metro.length).toBe(95);
  });
});
