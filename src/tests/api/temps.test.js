import { describe, it, expect } from "vitest";
import { frenchOffsetMs, debutPrestationMs, finPrestationMs, retardMinutes } from "../../../api/_temps.js";

// Repère : « 14:00 » le 6 août 2026 est une heure de Paris en heure d'été,
// donc 12:00 UTC. En janvier, la même heure vaut 13:00 UTC.
const AOUT_14H_UTC    = Date.UTC(2026, 7, 6, 12, 0, 0);
const JANVIER_14H_UTC = Date.UTC(2026, 0, 6, 13, 0, 0);

describe("frenchOffsetMs", () => {
  it("rend -2 h en heure d'été", () => {
    expect(frenchOffsetMs(new Date("2026-08-06T12:00:00Z"))).toBe(-7200000);
  });
  it("rend -1 h en heure d'hiver", () => {
    expect(frenchOffsetMs(new Date("2026-01-06T12:00:00Z"))).toBe(-3600000);
  });
  it("bascule au dernier dimanche de mars à 01:00 UTC", () => {
    // 2026 : dernier dimanche de mars = le 29
    expect(frenchOffsetMs(new Date("2026-03-29T00:59:00Z"))).toBe(-3600000);
    expect(frenchOffsetMs(new Date("2026-03-29T01:00:00Z"))).toBe(-7200000);
  });
  it("rebascule au dernier dimanche d'octobre à 01:00 UTC", () => {
    // 2026 : dernier dimanche d'octobre = le 25
    expect(frenchOffsetMs(new Date("2026-10-25T00:59:00Z"))).toBe(-7200000);
    expect(frenchOffsetMs(new Date("2026-10-25T01:00:00Z"))).toBe(-3600000);
  });
});

describe("debutPrestationMs", () => {
  it("convertit une heure d'été française en UTC", () => {
    expect(debutPrestationMs("2026-08-06", "14:00")).toBe(AOUT_14H_UTC);
  });
  it("convertit une heure d'hiver française en UTC", () => {
    expect(debutPrestationMs("2026-01-06", "14:00")).toBe(JANVIER_14H_UTC);
  });
  it("retombe sur 08:00 quand l'heure est absente", () => {
    expect(debutPrestationMs("2026-08-06", null)).toBe(Date.UTC(2026, 7, 6, 6, 0, 0));
  });
  it("rend null sans date, plutôt qu'un NaN qui se propage", () => {
    expect(debutPrestationMs(null, "14:00")).toBeNull();
    expect(debutPrestationMs("pas-une-date", "14:00")).toBeNull();
  });
});

describe("finPrestationMs", () => {
  it("part de l'horaire prévu quand rien n'a été pointé", () => {
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 3 }))
      .toBe(AOUT_14H_UTC + 3 * 3600000);
  });
  it("part du pointage réel quand il existe — une prestation démarrée en retard finit en retard", () => {
    const demarrage = new Date(AOUT_14H_UTC + 40 * 60000).toISOString();
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 2, started_at: demarrage }))
      .toBe(AOUT_14H_UTC + 40 * 60000 + 2 * 3600000);
  });
  it("préfère actual_hours à hours", () => {
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 3, actual_hours: 1.5 }))
      .toBe(AOUT_14H_UTC + 1.5 * 3600000);
  });
});

describe("retardMinutes", () => {
  // C'est le calcul de l'alerte « prestataire en retard » du cron toutes les
  // 30 min. Sans la conversion de fuseau, le retard sortait 120 min trop bas
  // en été : la fenêtre [15, 45[ ne s'ouvrait qu'après 2 h 15 de retard réel,
  // soit après la fin d'une prestation d'une heure.
  it("mesure un retard réel de 30 min comme 30 min, pas comme -90", () => {
    const maintenant = AOUT_14H_UTC + 30 * 60000;
    expect(retardMinutes("2026-08-06", "14:00", maintenant)).toBe(30);
  });
  it("ouvre bien la fenêtre d'alerte [15, 45[ sur un retard réel", () => {
    const dansLaFenetre = (min) => {
      const r = retardMinutes("2026-08-06", "14:00", AOUT_14H_UTC + min * 60000);
      return r >= 15 && r < 45;
    };
    expect(dansLaFenetre(10)).toBe(false);
    expect(dansLaFenetre(15)).toBe(true);
    expect(dansLaFenetre(44)).toBe(true);
    expect(dansLaFenetre(45)).toBe(false);
  });
  it("reste négatif tant que l'heure n'est pas atteinte", () => {
    expect(retardMinutes("2026-08-06", "14:00", AOUT_14H_UTC - 10 * 60000)).toBe(-10);
  });
  it("fonctionne aussi en heure d'hiver", () => {
    expect(retardMinutes("2026-01-06", "14:00", JANVIER_14H_UTC + 20 * 60000)).toBe(20);
  });
  it("rend null quand l'horaire est inconnu", () => {
    expect(retardMinutes(null, "14:00")).toBeNull();
  });
});
