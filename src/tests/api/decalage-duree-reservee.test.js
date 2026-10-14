// Retard au démarrage : la durée réservée ne bouge pas, et une série ne perd
// qu'une journée (étude du 13/10/2026, e2e/29).
//
// `hours` est une colonne ENTIÈRE : y écrire 7,67 h après un retard de vingt
// minutes faisait refuser par la base toute la réponse du client. Et sur une
// prestation de plusieurs jours, le retard du premier jour était retiré de la
// durée PAR JOUR, donc de chaque journée de la série.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { montantsDeCloture } from "../../../api/_cloture.js";
import { dureeTexte } from "../../../api/_temps.js";

const serie = { tarif_horaire: 13, hours: 8, date_debut: "2026-10-05", date_fin: "2026-10-09", montant_total: 534.5 };

describe("montantsDeCloture — retard non arbitré", () => {
  it("un jour : les heures retenues sont plafonnées", () => {
    const r = montantsDeCloture({ tarif_horaire: 13, hours: 8, montant_total: 110.98, delay_status: "pending", arrival_delay_minutes: 60 });
    expect(r.heuresEffectives).toBe(7);
    expect(r.partPrestataire).toBe(91);
    expect(r.ajustementRetard.unJour).toBeUndefined();
  });
  it("cinq jours : une heure de retard le lundi retire une heure, pas cinq", () => {
    const r = montantsDeCloture({ ...serie, delay_status: "pending", arrival_delay_minutes: 60 });
    expect(r.jours).toBe(5);
    expect(r.heuresEffectives, "la durée par jour reste celle réservée").toBe(8);
    expect(r.partPrestataire).toBe(13 * 8 * 5 - 13);
    expect(r.ajustementRetard.unJour).toBe(true);
    expect(r.deductions.valeurRetardUnJour).toBe(13);
  });
  it("le calcul est le même à chaque relecture : rien n'a à être réécrit en base", () => {
    const m = { ...serie, delay_status: "pending", arrival_delay_minutes: 20 };
    expect(montantsDeCloture(m).partPrestataire).toBe(montantsDeCloture(m).partPrestataire);
  });
  it("un refus sur plusieurs jours passe par heures_perdues, déduites une fois", () => {
    const r = montantsDeCloture({ ...serie, delay_status: "rejected", arrival_delay_minutes: 20, heures_perdues: 1 / 3 });
    expect(r.partPrestataire).toBeCloseTo(13 * 8 * 5 - 13 / 3, 2);
    expect(r.deductions.valeurPerdue).toBeCloseTo(4.33, 2);
  });
});

describe("respond_delay n'écrit plus dans la durée réservée", () => {
  const source = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = source.slice(source.indexOf('if (action === "respond_delay")'), source.indexOf('if (action === "affecter_tiers")'));
  it("aucune écriture de `hours` ni de `montant_total`", () => {
    const maj = bloc.slice(bloc.indexOf("const majDecalage"), bloc.indexOf("const decalageEcrit"));
    expect(maj).not.toMatch(/\bhours\s*:/);
    expect(maj).not.toMatch(/montant_total/);
  });
});

describe("dureeTexte", () => {
  it("écrit une durée comme on la dit", () => {
    expect(dureeTexte(8)).toBe("8 h");
    expect(dureeTexte(8 - 20 / 60)).toBe("7 h 40");
    expect(dureeTexte(7.75)).toBe("7 h 45");
  });
});

// Relecture du 14/10/2026 : deux actions lisaient encore `hours` après un
// décalage refusé, et rendaient ou versaient une seconde fois l'heure retirée.
describe("après un décalage refusé, la durée retenue fait foi", () => {
  const source = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const blocDe = (debut, fin) => source.slice(source.indexOf(debut), source.indexOf(fin, source.indexOf(debut)));

  it("l'interruption part de `actual_hours`", () => {
    const bloc = blocDe('if (action === "cancel_in_progress")', "const tarifHoraire = Number(mission.tarif_horaire)");
    expect(bloc).toMatch(/select=[^`]*\bactual_hours\b/);
    expect(bloc).toMatch(/const totalHours = mission\.actual_hours !== null && mission\.actual_hours !== undefined/);
  });

  it("la prolongation garde la réduction au lieu de vider `actual_hours`", () => {
    const bloc = blocDe('if (action === "confirmer_heures_supp")', "const up = await fetch(");
    expect(bloc).toMatch(/select=[^;]*\bactual_hours\b/);
    expect(bloc).not.toMatch(/actual_hours:\s*null\s*,/);
  });

  it("à la clôture, 4 h réservées, 1 h de retard refusée puis 1 h ajoutée : 4 h dues", () => {
    const r = montantsDeCloture({ tarif_horaire: 13, hours: 5, actual_hours: 4, extra_hours_appliquees: 1, extra_hours_tarif: 20, delay_status: "rejected", montant_total: 100 });
    expect(r.partPrestataire).toBe(3 * 13 + 20);
  });
});
