import { describe, it, expect } from "vitest";
import { moisProposes, moisEnCoursParis } from "../components/ui.jsx";

// Le choix du mois des factures (demande d'Alexandre du 05/10/2026) : le mois en
// cours d'abord, puis les douze précédents — le 2 novembre, c'est octobre qu'on déclare.
describe("mois proposés pour les factures", () => {
  it("le mois en cours, puis les douze précédents", () => {
    const l = moisProposes(new Date("2026-11-02T10:00:00Z"));
    expect(l).toHaveLength(13);
    expect(l[0]).toEqual({ valeur: "2026-11", court: "novembre", long: "novembre 2026" });
    expect(l[1].valeur).toBe("2026-10");
    expect(l[12].valeur).toBe("2025-11");
  });

  it("franchit le changement d'année", () => {
    const l = moisProposes(new Date("2026-01-15T10:00:00Z"));
    expect(l.slice(0, 3).map(x => x.valeur)).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(l[1].long).toBe("décembre 2025");
  });

  it("le 1er à 0 h 30 à Paris, on est déjà dans le nouveau mois", () => {
    // 31 octobre 23 h 30 UTC = 1er novembre 0 h 30 à Paris (heure d'hiver).
    expect(moisEnCoursParis(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(moisProposes(new Date("2026-10-31T23:30:00Z"))[0].valeur).toBe("2026-11");
  });
});
