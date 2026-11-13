// Une décision du back-office (justice, établissement de paiement) prend le
// MÊME verrou que l'accord tacite de la tâche planifiée, avant tout mouvement
// d'argent : sans lui, le litige pouvait être dénoué deux fois — client
// remboursé ET prestataire payé (relecture du 11/11/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");

describe("executer_decision : un seul dénouement par litige", () => {
  const bo = lire("api/bo-action.js");
  const debut = bo.indexOf('if (action === "executer_decision")');
  const bloc = bo.slice(debut, bo.indexOf("if (action ===", debut + 30));
  const verrou = bloc.indexOf("resolution_executee_cause=is.null");
  const execution = bloc.indexOf("await executerResolution(");

  it("le verrou est pris, sur un litige toujours ouvert, AVANT l'exécution", () => {
    expect(verrou).toBeGreaterThan(0);
    expect(execution).toBeGreaterThan(verrou);
    expect(bloc.slice(verrou - 200, verrou)).toContain("status=eq.disputed");
  });
  it("verrou déjà pris : rien n'est exécuté (409)", () => {
    expect(bloc.slice(verrou, execution)).toMatch(/pris\.length === 0\) \{\s*return res\.status\(409\)/);
  });
  it("exécution en échec : le verrou est relâché, pour pouvoir réessayer", () => {
    expect(bloc.slice(execution)).toMatch(/if \(!out\.ok\) \{[\s\S]{0,300}resolution_executee_cause: null/);
  });
  it("c'est bien le verrou de l'accord tacite", () => {
    expect(lire("api/cron-reset-monthly.js")).toContain("resolution_executee_cause=is.null");
  });
});

describe("échec APRÈS un mouvement d'argent : le verrou est gardé (12/11/2026)", () => {
  it("back-office : retour sans relâcher, avant le relâchement ordinaire", () => {
    const bo = lire("api/bo-action.js");
    const bloc = bo.slice(bo.indexOf('if (action === "executer_decision")'));
    const garde = bloc.indexOf("if (!out.ok && out.argentParti)");
    const relache = bloc.indexOf("resolution_executee_cause: null");
    expect(garde).toBeGreaterThan(0);
    expect(relache).toBeGreaterThan(garde);
    expect(bloc.slice(garde, relache)).toMatch(/return res\.status\(500\)/);
  });
  it("tâche planifiée : même règle pour l'accord tacite", () => {
    const cron = lire("api/cron-reset-monthly.js");
    const garde = cron.indexOf("if (!out.ok && out.argentParti)");
    expect(garde).toBeGreaterThan(0);
    expect(cron.slice(garde, garde + 400)).toContain("continue;");
    expect(cron.indexOf("resolution_executee_cause: null", garde)).toBeGreaterThan(garde);
  });
});

