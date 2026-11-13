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
    expect(bloc).toMatch(/missions\?id=eq\.\$\{mission_id\}&status=eq\.disputed&\$\{filtreVerrou\}/);
  });
  it("verrou déjà pris : rien n'est exécuté (409)", () => {
    expect(bloc.slice(verrou, execution)).toMatch(/pris\.length === 0\) \{\s*return res\.status\(409\)/);
  });
  it("exécution en échec : le verrou est relâché, pour pouvoir réessayer", () => {
    // Rendu à sa valeur d'avant (vide, ou « à reprendre »), jamais effacé d'office (13/11/2026).
    expect(bloc.slice(execution)).toMatch(/if \(!out\.ok\) \{[\s\S]{0,300}resolution_executee_cause: verrouAvant/);
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
    const relache = bloc.indexOf("resolution_executee_cause: verrouAvant");
    expect(garde).toBeGreaterThan(0);
    expect(relache).toBeGreaterThan(garde);
    expect(bloc.slice(garde, relache)).toMatch(/return res\.status\(500\)/);
  });
  it("tâche planifiée : même règle pour l'accord tacite", () => {
    const cron = lire("api/cron-reset-monthly.js");
    const garde = cron.indexOf("if (!out.ok && out.argentParti)");
    expect(garde).toBeGreaterThan(0);
    expect(cron.slice(garde, garde + 1200)).toContain("continue;");
    expect(cron.indexOf("resolution_executee_cause: m.resolution_executee_cause ?? null", garde)).toBeGreaterThan(garde);
  });
});

describe("un dénouement « à reprendre » se termine par un remboursement, jamais autrement (13/11/2026)", () => {
  const bo = lire("api/bo-action.js");
  const bloc = bo.slice(bo.indexOf('if (action === "executer_decision")'));
  const cron = lire("api/cron-reset-monthly.js");
  it("back-office : seul « rembourser le client », et seulement sur un litige qu'il a lui-même laissé à reprendre", () => {
    expect(bloc).toContain('? `or=(resolution_executee_cause.is.null,resolution_executee_cause.eq.${cause}_a_reprendre)`');
    expect(bloc).not.toContain("like.*_a_reprendre");
  });
  it("un échec de la reprise rend au verrou sa valeur d'avant, dans le back-office comme dans la tâche planifiée (13/11/2026)", () => {
    expect(bloc).toContain("const verrouAvant = m.resolution_executee_cause ?? null;");
    expect(bloc).toMatch(/select=id,status,[^`]*resolution_executee_cause`/);
    const cron = lire("api/cron-reset-monthly.js");
    expect(cron).toContain("resolution_montant,heures_perdues,resolution_executee_cause`");
    expect(cron).toMatch(/missions\?id=eq\.\$\{m\.id\}&resolution_executee_cause=eq\.accord_tacite`[\s\S]{0,200}resolution_executee_cause: m\.resolution_executee_cause \?\? null/);
  });
  it("back-office : l'échec après mouvement d'argent marque « à reprendre » et journalise la décision", () => {
    const garde = bloc.indexOf("if (!out.ok && out.argentParti)");
    const suite = bloc.slice(garde, bloc.indexOf("if (!out.ok) {", garde));
    expect(suite).toContain("`${cause}_a_reprendre`");
    expect(suite).toContain('await journaliser("executer_decision"');
  });
  it("tâche planifiée : seul un accord tacite de remboursement est repris d'office", () => {
    expect(cron).toMatch(/const filtreVerrou = m\.resolution_proposee === "rembourser_client"\s*\? "or=\(resolution_executee_cause\.is\.null,resolution_executee_cause\.eq\.accord_tacite_a_reprendre\)"/);
    expect(cron).toContain('resolution_executee_cause: "accord_tacite_a_reprendre"');
  });
});

