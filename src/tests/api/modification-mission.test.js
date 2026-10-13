// « Modifier » du back-office : le formulaire renvoie toutes les valeurs lues à
// l'ouverture de la liste. Une heure supplémentaire payée entre-temps était
// effacée par un simple changement de ville (relecture du 12/10/2026).
import { describe, it, expect } from "vitest";
import { champsModifies, gardeEcriture, porteHeuresAjoutees, touchePrixOuJours } from "../../../api/_modification.js";

const base = {
  date: "2026-10-20", date_debut: null, date_fin: null, hours: 6, tarif_horaire: "18.00",
  ville: "Paris", metier: "Agent d'entretien", heures_ajoutees_detail: null,
  extra_hours_status: "paye", extra_hours_appliquees: "2",
};

describe("champsModifies", () => {
  it("un changement de ville ne réécrit pas les heures lues avant le paiement des heures supp", () => {
    const saisie = { date: "2026-10-20", hours: "4", tarif_horaire: "18", ville: "Lyon", metier: "Agent d'entretien" };
    const updates = champsModifies({ ...base, hours: 4 }, saisie);
    expect(updates).toEqual({ ville: "Lyon" });
  });

  it("la saisie périmée (4 h) face à la base (6 h) apparaît comme une modification des heures", () => {
    const updates = champsModifies(base, { hours: "4", ville: "Paris" });
    expect(updates).toEqual({ hours: 4 });
    expect(touchePrixOuJours(updates)).toBe(true);
    expect(porteHeuresAjoutees(base)).toBe(true);
  });

  it("rien de changé : rien à écrire", () => {
    expect(champsModifies(base, { date: "2026-10-20", hours: "6", tarif_horaire: "18", ville: "Paris", metier: base.metier })).toEqual({});
  });

  it("une date changée entraîne la période d'une prestation sur plusieurs jours", () => {
    const multi = { ...base, date_debut: "2026-10-20 00:00:00+00", date_fin: "2026-10-22 00:00:00+00" };
    expect(champsModifies(multi, { date: "2026-10-27" }))
      .toEqual({ date: "2026-10-27", date_debut: "2026-10-27T00:00:00Z", date_fin: "2026-10-29T00:00:00Z" });
  });
});

describe("porteHeuresAjoutees", () => {
  it("heures appliquées, détail par journée ou demande en cours", () => {
    const sans = { ...base, extra_hours_appliquees: null, extra_hours_status: null };
    expect(porteHeuresAjoutees(sans)).toBe(false);
    expect(porteHeuresAjoutees({ ...sans, heures_ajoutees_detail: [{ jour: "2026-10-20", heures: 1 }] })).toBe(true);
    expect(porteHeuresAjoutees({ ...sans, extra_hours_status: "pending" })).toBe(true);
    expect(porteHeuresAjoutees({ ...sans, extra_hours_appliquees: "1.5" })).toBe(true);
  });
});

describe("gardeEcriture", () => {
  it("ville seule : aucune condition", () => {
    expect(gardeEcriture(base, { ville: "Lyon" })).toBe("");
  });

  it("heures : la base doit valoir encore la valeur lue, sans heures ajoutées", () => {
    const g = gardeEcriture({ ...base, hours: 4 }, { hours: 5 });
    expect(g).toContain("hours.eq.4");
    expect(g).toContain("or(extra_hours_appliquees.is.null,extra_hours_appliquees.eq.0)");
    expect(g).toContain("extra_hours_status.not.in.(pending,accepte_presta)");
    expect(g.startsWith("&and=(")).toBe(true);
  });

  it("date : comparée au jour lu ; valeur absente → is.null", () => {
    expect(gardeEcriture({ ...base, date: "2026-10-20" }, { date: "2026-10-21" })).toContain("date.eq.2026-10-20");
    expect(gardeEcriture({ ...base, date: null }, { date: "2026-10-21" })).toContain("date.is.null");
  });
});

// Relecture du 13/10/2026 : l'écran envoie les valeurs qu'il affichait.
import { champsPerimes, valeursNumeriquesInvalides } from "../../../api/_modification.js";
import { readFileSync } from "node:fs";

describe("champsPerimes", () => {
  it("heures changées en base depuis l'ouverture de la liste : refus", () => {
    expect(champsPerimes({ ...base, hours: 5 }, { hours: 4 }, { hours: 4 })).toEqual(["hours"]);
  });
  it("valeurs affichées encore à jour : rien de périmé", () => {
    expect(champsPerimes({ ...base, hours: 4 }, { hours: 4, date: "2026-10-20" }, { hours: 6 })).toEqual([]);
  });
  it("un champ non modifié n'est pas comparé (la ville seule passe même si les heures ont bougé)", () => {
    expect(champsPerimes({ ...base, hours: 6 }, { hours: 4 }, { ville: "Lyon" })).toEqual([]);
  });
  it("écran d'une version antérieure, sans `avant` : rien n'est comparé", () => {
    expect(champsPerimes(base, undefined, { hours: 4 })).toEqual([]);
  });
});

describe("valeursNumeriquesInvalides", () => {
  it("refuse ce que Number() changerait en NaN — écrit null, donc un tarif effacé", () => {
    expect(valeursNumeriquesInvalides({ tarif_horaire: "18,50" })).toMatch(/Tarif invalide/);
    expect(valeursNumeriquesInvalides({ tarif_horaire: "abc" })).toMatch(/Tarif invalide/);
    expect(valeursNumeriquesInvalides({ hours: "4.5" })).toMatch(/Heures invalides/);
    expect(valeursNumeriquesInvalides({ hours: "-2" })).toMatch(/Heures invalides/);
  });
  it("accepte des valeurs correctes, ou absentes", () => {
    expect(valeursNumeriquesInvalides({ hours: "6", tarif_horaire: "18.50" })).toBeNull();
    expect(valeursNumeriquesInvalides({})).toBeNull();
  });
});

describe("l'écran du back-office", () => {
  const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
  it("n'envoie que les champs modifiés, avec les valeurs lues", () => {
    expect(ecran).toContain("...changes, avant");
    expect(ecran).not.toContain('mission_id:missionId, ...editMissionVals');
  });
});
