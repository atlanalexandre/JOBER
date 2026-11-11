// La validation (`complete`) et l'interruption (`cancel_in_progress`)
// programment le versement DANS l'écriture qui clôt la prestation, conditionnée
// à `status=eq.assigned` (relecture du 11/11/2026). Écrit à part, un échec
// laissait une prestation `completed` sans versement, que rien ne reprenait ;
// et l'interruption, sans condition, pouvait écraser une validation du même
// instant.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
const bloc = (action) => {
  const d = src.indexOf(`if (action === "${action}")`);
  return src.slice(d, src.indexOf("\n    if (action ===", d + 30));
};

describe("complete", () => {
  const b = bloc("complete");
  const ecriture = b.slice(b.indexOf("&status=eq.assigned`"), b.indexOf("const completedRows"));
  it("l'écriture conditionnelle qui clôt porte aussi le versement", () => {
    expect(ecriture).toContain('status: "completed"');
    expect(ecriture).toMatch(/payout_status: "pending",\s*payout_due_at: new Date\(echeanceVersement\)\.toISOString\(\),\s*payout_amount: partPrestataire/);
  });
  it("plus aucune seconde écriture du versement", () => {
    expect(b.slice(b.indexOf("const completedRows"))).not.toContain('payout_status: "pending"');
  });
});

describe("cancel_in_progress", () => {
  const b = bloc("cancel_in_progress");
  it("la clôture est conditionnée à une prestation toujours en cours", () => {
    expect(b).toMatch(/const majAnnul = await fetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/missions\?id=eq\.\$\{mission_id\}&status=eq\.assigned`/);
  });
  it("le versement d'une prestation arrêtée part dans cette même écriture, et nulle part ailleurs", () => {
    expect(b).toMatch(/\.\.\.versementInterruption,/);
    expect(b.match(/payout_status: "pending"/g)).toHaveLength(1);
    expect(b).toMatch(/const versementInterruption = annulerReste && proratedAmount > 0 && mission\.prestataire_id/);
  });
});
