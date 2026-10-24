// « 🧾 Export comptable » du back-office (relecture du 24/10/2026) : il
// inventait une commission ALANE à 20 % du prix, et s'arrêtait à 1 000 lignes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ecran = readFileSync(new URL("../components/backoffice.jsx", import.meta.url), "utf8");
const bo = readFileSync(new URL("../../api/bo-action.js", import.meta.url), "utf8");
const exportEcran = ecran.slice(ecran.indexOf("export function BOExportMissions"), ecran.indexOf("export function BOExportPDF"));
const exportServeur = bo.slice(bo.indexOf('if (action === "list_missions_export")'), bo.indexOf('if (action === "bo_log_export")'));

describe("l'export comptable n'invente rien", () => {
  it("aucun taux de commission calculé", () => {
    expect(exportEcran).not.toMatch(/COMMISSION|0\.20|\* 0\.2/);
    expect(exportEcran).not.toMatch(/Commission ALANE/);
  });
  it("le versement prestataire est celui enregistré", () => {
    expect(exportEcran).toContain("Versement prestataire (€)");
    expect(exportServeur).toMatch(/payout_amount,payout_status/);
  });
  it("toutes les prestations, pas les 1 000 premières ; un échec se voit", () => {
    expect(exportServeur).toMatch(/missions = await lireTout\(/);
    expect(exportServeur).toMatch(/return res\.status\(502\)/);
    expect(exportEcran).toMatch(/showToast\(`Export non produit/);
  });
});
