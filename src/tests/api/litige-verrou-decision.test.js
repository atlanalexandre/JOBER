// Une décision du back-office (justice, établissement de paiement) prend le
// MÊME verrou que l'accord tacite de la tâche planifiée, avant tout mouvement
// d'argent : sans lui, le litige pouvait être dénoué deux fois — client
// remboursé ET prestataire payé (relecture du 11/11/2026). Suites des 12 et
// 13/11/2026 : le verrou reste quand l'argent est parti, se reprend par un
// remboursement, et l'état repris se lit sur l'écriture qui prend le verrou.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
const bo = lire("api/bo-action.js");
const debut = bo.indexOf('if (action === "executer_decision")');
const bloc = bo.slice(debut, bo.indexOf("\n    if (action ===", debut + 30));
const cron = lire("api/cron-reset-monthly.js");

describe("executer_decision : un seul dénouement par litige", () => {
  const prise = bloc.indexOf("const prendre = async (filtre)");
  const execution = bloc.indexOf("await executerResolution(");
  it("le verrou est pris, sur un litige toujours ouvert, AVANT l'exécution", () => {
    expect(prise).toBeGreaterThan(0);
    expect(execution).toBeGreaterThan(prise);
    expect(bloc).toContain("missions?id=eq.${mission_id}&status=eq.disputed&${filtre}");
    expect(bloc).toContain('pris = await prendre("resolution_executee_cause=is.null")');
  });
  it("verrou déjà pris : rien n'est exécuté (409), et le message dit quoi faire", () => {
    const refus = bloc.slice(bloc.indexOf("if (!pris) {"), execution);
    expect(refus).toContain("return res.status(409)");
    expect(refus).toContain("relancez « rembourser le client » avec la cause");
    expect(refus).toContain("la tâche planifiée la termine");
    expect(refus).toContain("signalez-le à la maintenance");
  });
  it("exécution en échec sans mouvement d'argent : le verrou retrouve sa valeur d'avant", () => {
    expect(bloc.slice(execution)).toMatch(/if \(!out\.ok\) \{[\s\S]{0,300}resolution_executee_cause: verrouAvant/);
  });
  it("c'est bien le verrou de l'accord tacite", () => {
    expect(cron).toContain('prendre("resolution_executee_cause=is.null")');
  });
});

describe("échec APRÈS un mouvement d'argent : le verrou est gardé, marqué « à reprendre »", () => {
  it("back-office : marqué, journalisé, et le retour précède le relâchement ordinaire", () => {
    const garde = bloc.indexOf("if (!out.ok && out.argentParti)");
    const relache = bloc.indexOf("resolution_executee_cause: verrouAvant");
    expect(garde).toBeGreaterThan(0);
    expect(relache).toBeGreaterThan(garde);
    const suite = bloc.slice(garde, relache);
    expect(suite).toContain("`${cause}_a_reprendre`");
    expect(suite).toContain('await journaliser("executer_decision"');
    expect(suite).toMatch(/return res\.status\(500\)/);
  });
  it("tâche planifiée : même règle pour l'accord tacite", () => {
    const garde = cron.indexOf("if (!out.ok && out.argentParti)");
    expect(garde).toBeGreaterThan(0);
    expect(cron.slice(garde, garde + 1200)).toContain("continue;");
    expect(cron).toContain('resolution_executee_cause: "accord_tacite_a_reprendre"');
  });
});

describe("reprise d'un dénouement « à reprendre » (13/11/2026)", () => {
  it("back-office : seul « rembourser le client », et seulement le sien (même cause)", () => {
    expect(bloc).toMatch(/if \(resolution === "rembourser_client"\) \{\s*pris = await prendre\(`resolution_executee_cause=eq\.\$\{cause\}_a_reprendre`\);\s*if \(pris\) verrouAvant = `\$\{cause\}_a_reprendre`;/);
    expect(bloc).not.toContain("like.*_a_reprendre");
  });
  it("l'état repris vient de l'écriture qui prend le verrou, jamais d'une lecture antérieure", () => {
    expect(bloc).not.toContain("m.resolution_executee_cause");
    expect(cron).not.toContain("m.resolution_executee_cause");
    expect(cron).toMatch(/if \(m\.resolution_proposee === "rembourser_client"\) \{\s*pris = await prendre\("resolution_executee_cause=eq\.accord_tacite_a_reprendre"\);\s*if \(pris\) verrouAvant = "accord_tacite_a_reprendre";/);
    expect(cron).toContain("resolution_executee_cause: verrouAvant");
  });
});

describe("le back-office ne reprend jamais un accord tacite (13/11/2026)", () => {
  it("il ne serait annoncé que comme une décision de justice : refusé, avec un message qui le dit", () => {
    expect(bloc).not.toContain('prendre("resolution_executee_cause=eq.accord_tacite_a_reprendre"');
    expect(bloc).not.toContain("causeEffective");
  });
  it("la relecture de la cause en cours journalise ses erreurs (CLAUDE.md 1.2)", () => {
    expect(bloc).toContain("illisible — message générique");
  });
});

