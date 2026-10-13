// Sommes dues par un prestataire : aucun message n'annonce une retenue sur ses
// versements (CGPS art. 8B.3, version du 06/10/2026 — étude du 13/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");

describe("créance : le texte suit l'article 8B.3", () => {
  const bo = lire("api/bo-action.js");
  const debut = bo.indexOf('if (action === "creer_creance")');
  const bloc = bo.slice(debut, bo.indexOf("if (action ===", debut + 30));
  it("ni la notification ni l'e-mail ne promettent une retenue de la moitié des versements", () => {
    expect(bloc).not.toMatch(/moitié/);
    expect(bloc).not.toMatch(/récupérée sur vos versements/);
    expect(bloc).toMatch(/accord écrit|accord exprès et écrit/);
  });
  it("aucun traitement n'opère de compensation unilatérale", () => {
    for (const f of ["api/cron-reset-monthly.js", "api/bo-action.js", "api/missions.js", "api/_virement.js"]) {
      expect(lire(f), f).not.toMatch(/repartirCompensation\(/);
    }
  });
});
