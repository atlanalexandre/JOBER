import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lirePosition, constatArrivee, libelleConstat, CONSTATS_ARRIVEE, SEUIL_SUR_PLACE_M } from "../../../api/_localisation.js";

// Pointage localisé (29/09/2026) : le serveur compare une fois la position du
// prestataire à l'adresse, garde un constat et une distance, ne bloque rien.

const TOUR_EIFFEL = { lat: 48.8584, lon: 2.2945 };
// ~111 m par millième de degré de latitude
const aMetres = (m) => ({ lat: TOUR_EIFFEL.lat + m / 111_000, lng: TOUR_EIFFEL.lon, precision: 0 });

describe("constatArrivee()", () => {
  it("sur place à moins de 300 m", () => {
    const c = constatArrivee(aMetres(120), TOUR_EIFFEL);
    expect(c.constat).toBe("sur_place");
    expect(c.distance_m).toBeGreaterThan(100);
    expect(c.distance_m).toBeLessThan(140);
  });

  it("éloigné au-delà", () => {
    expect(constatArrivee(aMetres(2000), TOUR_EIFFEL).constat).toBe("eloignee");
  });

  it("déduit l'imprécision annoncée par le téléphone, dans une limite", () => {
    // 450 m relevés, annoncés à ±200 m : compatible avec la présence.
    expect(constatArrivee({ ...aMetres(450), precision: 200 }, TOUR_EIFFEL).constat).toBe("sur_place");
    // Un téléphone qui annonce ±5 km ne prouve rien : on plafonne à 500 m.
    expect(constatArrivee({ ...aMetres(3000), precision: 5000 }, TOUR_EIFFEL).constat).toBe("eloignee");
  });

  it("ne conclut rien sans position ni sans adresse", () => {
    expect(constatArrivee(null, TOUR_EIFFEL)).toEqual({ constat: "position_absente", distance_m: null });
    expect(constatArrivee(aMetres(10), null)).toEqual({ constat: "adresse_introuvable", distance_m: null });
  });

  it("ne produit que des valeurs que la base accepte", () => {
    const sql = readFileSync(new URL("../../../migrations/2026-09-29_pointage_localise.sql", import.meta.url), "utf8");
    for (const v of CONSTATS_ARRIVEE) expect(sql).toContain(`'${v}'`);
    expect(SEUIL_SUR_PLACE_M).toBe(300);
  });
});

describe("lirePosition()", () => {
  it("refuse ce qui n'est pas une position", () => {
    expect(lirePosition({})).toBeNull();
    expect(lirePosition({ lat: "abc", lng: 2 })).toBeNull();
    expect(lirePosition({ lat: 95, lng: 2 })).toBeNull();
    expect(lirePosition({ lat: null, lng: null })).toBeNull();
  });

  it("accepte une position, précision absente ou négative comptée zéro", () => {
    expect(lirePosition({ lat: 48.8, lng: 2.3 })).toEqual({ lat: 48.8, lng: 2.3, precision: 0 });
    expect(lirePosition({ lat: 48.8, lng: 2.3, precision: -4 }).precision).toBe(0);
  });
});

describe("libelleConstat()", () => {
  it("dit la distance en français", () => {
    expect(libelleConstat("eloignee", 2340)).toBe("Position relevée à 2,3 km de l'adresse.");
    expect(libelleConstat("eloignee", 420)).toBe("Position relevée à 420 m de l'adresse.");
    expect(libelleConstat("sur_place", 40)).toBe("Position vérifiée : sur place.");
  });
});

describe("le pointage ne garde aucune coordonnée", () => {
  it("l'API n'écrit ni latitude ni longitude en base", () => {
    const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    const bloc = src.slice(src.indexOf('action === "checkin_mission"'), src.indexOf('action === "confirmer_identite"'));
    expect(bloc).toContain("arrivee_localisation: constat");
    expect(bloc).not.toMatch(/arrivee_lat|arrivee_lng|latitude:/);
  });
});
