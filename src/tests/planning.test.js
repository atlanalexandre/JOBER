// Planning prestataire : chaque journée travaillée apparaît (13/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prestationsDuMois } from "../lib/planning.js";

describe("prestationsDuMois", () => {
  it("une prestation d'un jour (sans date_debut) apparaît à sa date", () => {
    const { parJour, duMois } = prestationsDuMois([{ id:"a", date:"2026-10-13", date_debut:null }], 2026, 9);
    expect(Object.keys(parJour)).toEqual(["13"]);
    expect(duMois).toHaveLength(1);
  });
  it("une série apparaît sur chacun de ses jours, y compris à cheval sur deux mois", () => {
    const serie = { id:"s", date:"2026-10-30", date_debut:"2026-10-30 00:00:00+00", date_fin:"2026-11-02 00:00:00+00" };
    const oct = prestationsDuMois([serie], 2026, 9);
    expect(Object.keys(oct.parJour)).toEqual(["30", "31"]);
    const nov = prestationsDuMois([serie], 2026, 10);
    expect(Object.keys(nov.parJour)).toEqual(["1", "2"]);
    expect(nov.duMois[0]).toMatchObject({ premierJour:"2026-11-01", nbJours:2 });
  });
  it("une prestation d'un autre mois n'apparaît pas", () => {
    expect(prestationsDuMois([{ id:"b", date:"2026-12-01" }], 2026, 9).duMois).toHaveLength(0);
  });
});

describe("l'écran Planning", () => {
  const code = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");
  const bloc = code.slice(code.indexOf("export function CalendarScreen("), code.indexOf("const prevMonth", code.indexOf("export function CalendarScreen(")));
  it("lit `date`, vérifie l'erreur, et n'attend plus `date_debut` seul", () => {
    expect(bloc).toContain('"id,titre,metier,client_nom,date,date_debut,date_fin,heure_debut,status,montant_total"');
    expect(bloc).toContain("if (error)");
  });
});

// Même faute ailleurs : une lecture en échec affichait des écrans vides (13/10/2026).
describe("les lectures en échec se voient", () => {
  const presta = readFileSync(new URL("../components/presta-screens.jsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");
  it("tableau de bord prestataire", () => {
    expect(presta).toContain("{data:mData,error:mErr}");
    expect(presta).toContain("setErreurTableau(!!mErr)");
  });
  it("onglet Clients du prestataire", () => {
    expect(presta).toContain("setErreurClients(true)");
  });
  it("portefeuille cashback du client", () => {
    expect(client).toContain("error: errHisto");
    expect(client).toContain("Votre cashback n'a pas pu être chargé");
  });
});
