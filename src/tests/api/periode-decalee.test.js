// « Modifier » du back-office : la période d'une prestation sur plusieurs jours
// suit la nouvelle date (relecture du 09/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { periodeDecalee } from "../../../api/_creneaux.js";

describe("periodeDecalee", () => {
  it("décale début et fin d'autant, la durée conservée", () => {
    expect(periodeDecalee({ date:"2026-10-13", date_debut:"2026-10-13 00:00:00+00", date_fin:"2026-10-15 00:00:00+00" }, "2026-10-20"))
      .toEqual({ date_debut:"2026-10-20T00:00:00Z", date_fin:"2026-10-22T00:00:00Z" });
  });

  it("recule aussi, et franchit un changement de mois", () => {
    expect(periodeDecalee({ date:"2026-11-02", date_debut:"2026-11-02T00:00:00+00:00", date_fin:"2026-11-03T00:00:00+00:00" }, "2026-10-30"))
      .toEqual({ date_debut:"2026-10-30T00:00:00Z", date_fin:"2026-10-31T00:00:00Z" });
  });

  it("ne touche rien pour une prestation d'un jour", () => {
    expect(periodeDecalee({ date:"2026-10-13", date_debut:null, date_fin:null }, "2026-10-20")).toEqual({});
  });

  it("une date illisible ne produit pas de date invalide", () => {
    expect(periodeDecalee({ date:"2026-10-13", date_debut:"2026-10-13" }, "n'importe quoi")).toEqual({});
  });
});

describe("update_mission l'applique", () => {
  const code = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const bloc = code.slice(code.indexOf('action === "update_mission"'), code.indexOf('action === "adjust_cashback"'));
  it("décale la période quand la date change, et refuse une date mal formée", () => {
    expect(bloc).toContain("Object.assign(updates, periodeDecalee(actuelle, date))");
    expect(bloc).toContain("Date invalide");
  });
});
