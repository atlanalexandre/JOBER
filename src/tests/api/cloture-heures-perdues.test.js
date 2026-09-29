// Toute lecture de prestation qui alimente montantsDeCloture() doit lire `heures_perdues`.
//
// Relecture du 29/09/2026 : la validation par le client, la validation
// automatique, « Valider de force » et le dénouement des litiges ne lisaient pas
// cette colonne. Quand une journée avait été interrompue et le client remboursé
// des heures perdues, le prestataire était quand même payé pour elles —
// montantsDeCloture() sait les déduire, encore faut-il les lui transmettre.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const FICHIERS = ["api/missions.js", "api/cron-reset-monthly.js", "api/bo-action.js"];

describe("clôture : les heures perdues sont lues avant tout calcul", () => {
  for (const f of FICHIERS) {
    it(f, () => {
      const lignes = readFileSync(f, "utf8").split("\n");
      lignes.forEach((ligne, i) => {
        if (!ligne.includes("montantsDeCloture(") || ligne.includes("import ")) return;
        // La lecture la plus proche au-dessus de l'appel, sur 80 lignes.
        let lecture = null;
        for (let j = i; j >= Math.max(0, i - 80) && !lecture; j--) {
          if (/rest\/v1\/missions/.test(lignes[j]) && /select=/.test(lignes.slice(j, j + 6).join(" "))) {
            lecture = lignes.slice(j, j + 6).join(" ");
          }
        }
        // Un appel qui reçoit déjà `heures_perdues` explicitement est conforme.
        if (/heures_perdues/.test(ligne)) return;
        expect(lecture, `${f}:${i + 1} — aucune lecture de prestation trouvée`).toBeTruthy();
        expect(lecture, `${f}:${i + 1} — la lecture ne demande pas heures_perdues`).toMatch(/heures_perdues/);
      });
    });
  }
});
