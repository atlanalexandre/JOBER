import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// 30/09/2026 : un remboursement au motif « fraudulent » inscrit la carte ET l'e-mail
// du payeur sur la liste de blocage Radar. Le refus d'identité et la suppression d'un
// compte prestataire bloquaient ainsi des clients qui n'avaient rien fait.
describe("motif des remboursements Stripe", () => {
  it("aucun remboursement automatique au motif « fraudulent »", () => {
    const dossier = new URL("../../../api/", import.meta.url);
    const fautifs = readdirSync(dossier).filter(f => f.endsWith(".js"))
      .filter(f => /reason:\s*["']fraudulent["']|reason=fraudulent/.test(readFileSync(new URL(f, dossier), "utf8")));
    expect(fautifs).toEqual([]);
  });
});
