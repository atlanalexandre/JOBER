// Interrompre une prestation commencée EN RETARD (étude d'octobre 2026, `e2e/81`).
//
// L'interruption comptait le temps écoulé depuis l'heure de début PRÉVUE : le retard
// passait pour du travail fait. Constaté en recette, 8 h à 13 €, début prévu il y a
// 3 h 50, démarrage réel il y a 2 h 50 : 52 € rendus au client au lieu de 65 €.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { retardADeduireDuJour } from "../../../api/_decalage.js";
import { dateDuJourFr } from "../../../api/_temps.js";

const AUJOURDHUI = "2026-10-14";
const jourParis = (ms) => dateDuJourFr(ms);
const demarree = (statut, extra = {}) => ({
  arrival_delay_minutes: 60, delay_status: statut, started_at: "2026-10-14T08:00:00Z", ...extra,
});

describe("le retard compté comme travail fait, le jour du démarrage", () => {
  it("décalage accepté : le retard n'est pas du travail fait", () => {
    expect(retardADeduireDuJour(demarree("approved"), AUJOURDHUI, false, jourParis)).toBe(1);
    expect(retardADeduireDuJour(demarree("approved"), AUJOURDHUI, true, jourParis)).toBe(1);
  });

  it("décalage refusé sur un jour : la durée retenue l'exclut déjà", () => {
    expect(retardADeduireDuJour(demarree("rejected"), AUJOURDHUI, false, jourParis)).toBe(1);
  });

  it("refusé sur plusieurs jours : déjà dans les heures perdues, rien à retrancher", () => {
    expect(retardADeduireDuJour(demarree("rejected"), AUJOURDHUI, true, jourParis)).toBe(0);
  });

  it("jamais arbitré : la clôture plafonne et rend elle-même", () => {
    expect(retardADeduireDuJour(demarree("pending"), AUJOURDHUI, false, jourParis)).toBe(0);
  });

  it("un autre jour que celui du démarrage : rien", () => {
    expect(retardADeduireDuJour(demarree("approved"), "2026-10-15", true, jourParis)).toBe(0);
  });

  it("sans retard ou sans démarrage : rien", () => {
    expect(retardADeduireDuJour(demarree("approved", { arrival_delay_minutes: 0 }), AUJOURDHUI, false, jourParis)).toBe(0);
    expect(retardADeduireDuJour(demarree("approved", { started_at: null }), AUJOURDHUI, false, jourParis)).toBe(0);
  });
});

describe("cancel_in_progress", () => {
  const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = src.slice(src.indexOf('if (action === "cancel_in_progress")'), src.indexOf('if (action === "checkin_mission")'));

  it("lit le retard et son arbitrage — sans eux, la clôture ne plafonnait rien", () => {
    expect(bloc).toMatch(/select=[^`]*arrival_delay_minutes[^`]*delay_status/);
  });

  it("retranche le retard du temps écoulé", () => {
    expect(bloc).toMatch(/retardADeduireDuJour\(/);
    expect(bloc).toMatch(/Date\.now\(\) - debutDuJour - retardDuJourH \* 3600000/);
  });

  it("rend au client les heures retirées quand elle clôt un décalage non arbitré", () => {
    expect(bloc).toMatch(/annulerReste && partage\.ajustementRetard[\s\S]{0,200}rembourserHeuresRetirees/);
  });
});
