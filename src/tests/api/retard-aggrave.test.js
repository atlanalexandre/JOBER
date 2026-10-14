// Décalage refusé, puis démarrage plus tardif encore : seul l'écart est
// déduit et rendu, la question n'est pas rouverte (étude du 14/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { retardAggraveApresRefus } from "../../../api/_decalage.js";

const base = { hours: 4, tarif_horaire: 15, date: "2026-10-20", delay_status: "rejected", arrival_delay_minutes: 20 };

describe("retard aggravé après un refus", () => {
  it("une journée : 20 min de plus retirées de la durée retenue, et rendues", () => {
    const r = retardAggraveApresRefus({ ...base, actual_hours: 4 - 20 / 60 }, 40);
    expect(r.ecartMin).toBe(20);
    expect(r.maj.arrival_delay_minutes).toBe(40);
    expect(r.maj.actual_hours).toBeCloseTo(4 - 40 / 60, 4);
    expect(r.aRendre).toBe(5);
    expect(r.maj.delay_status).toBeUndefined();
  });

  it("plusieurs jours : l'écart s'ajoute aux heures perdues", () => {
    const r = retardAggraveApresRefus({ ...base, date_debut: "2026-10-20", date_fin: "2026-10-22", heures_perdues: 1 / 3 }, 40);
    expect(r.maj.heures_perdues).toBeCloseTo(2 / 3, 4);
    expect(r.maj.actual_hours).toBeUndefined();
  });

  it("rien à faire si le décalage n'a pas été refusé, ou si le retard n'a pas grandi", () => {
    expect(retardAggraveApresRefus({ ...base, delay_status: "pending" }, 40)).toBeNull();
    expect(retardAggraveApresRefus({ ...base, delay_status: "approved" }, 40)).toBeNull();
    expect(retardAggraveApresRefus(base, 20)).toBeNull();
  });

  it("le démarrage ne rouvre plus un décalage refusé", () => {
    const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    const i = src.indexOf('if (action === "start_mission")');
    const bloc = src.slice(i, i + 9000);
    expect(bloc).toMatch(/m\.delay_status === "rejected"[\s\S]{0,300}retardAggraveApresRefus/);
  });
});
