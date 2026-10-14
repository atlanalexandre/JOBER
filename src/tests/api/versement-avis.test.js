// Le prestataire n'apprenait jamais que son virement était parti, ni qu'il
// avait été refusé : la tâche des versements inscrivait le statut et écrivait
// au journal, sans notification (étude du 14/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { avisDeVersement } from "../../../api/_virement.js";

const m = { metier: "Femme/Valet de chambre", date: "2026-10-12" };

describe("avis de versement au prestataire", () => {
  it("virement émis : montant à la française, prestation et date", () => {
    const a = avisDeVersement(m, 104, "emis");
    expect(a.title).toMatch(/Virement envoyé/);
    expect(a.body).toContain("104,00 €");
    expect(a.body).toContain("« Femme/Valet de chambre » du 12/10/2026");
  });

  it("virement refusé : l'argent reste dû, l'équipe est prévenue", () => {
    const a = avisDeVersement({ sector: "hotellerie", date: null }, 20.2, "refuse");
    expect(a.title).toMatch(/bloqué/);
    expect(a.body).toContain("20,20 €");
    expect(a.body).toMatch(/reste dû/);
    expect(a.body).not.toMatch(/ du \//);
  });

  it("la tâche des versements prévient le prestataire dans les deux cas", () => {
    const src = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    const emis = src.indexOf('payout_status: "transferred", stripe_transfer_id: td.id');
    const refus = src.indexOf('{ payout_status: "failed" }, headers, `versements/refus');
    expect(emis).toBeGreaterThan(0);
    expect(refus).toBeGreaterThan(0);
    expect(src.slice(emis, emis + 1500)).toMatch(/notifier\(\{[^}]*avisDeVersement\(m, cents \/ 100, "emis"\)/);
    expect(src.slice(refus, refus + 800)).toMatch(/notifier\(\{[^}]*avisDeVersement\(m, cents \/ 100, "refuse"\)/);
  });
});
