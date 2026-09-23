import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// Les deux scripts qui confrontent le code à la base. Le 23/09/2026, leur
// sortie passée sur la base réelle a produit deux fausses alertes. Un contrôle
// qui crie à tort finit ignoré (CLAUDE.md §4bis) : ces tests fixent les deux
// corrections.
const lancer = (script) => execFileSync("node", [`scripts/${script}`], { encoding: "utf8" });

describe("npm run colonnes", () => {
  const sortie = lancer("verifier-colonnes.mjs");
  const colonnes = (table) => {
    const m = sortie.match(new RegExp(`\\('${table}', ARRAY\\[([^\\]]*)\\]\\)`));
    return m ? m[1].split(",").map(c => c.replace(/'/g, "")) : [];
  };

  // Un gabarit imbriqué — `${cond ? `Part prestataire : …` : …}` — faisait
  // remonter le texte français comme une clé.
  it("ne lit pas le texte d'un gabarit imbriqué comme une colonne", () => {
    expect(colonnes("support_tickets")).not.toContain("prestataire");
  });

  it("relève toujours les vraies colonnes de la même écriture", () => {
    expect(colonnes("support_tickets")).toEqual(
      expect.arrayContaining(["subject", "message", "user_email", "user_id", "status"]));
  });

  it("relève `expires_at`, la colonne de fin de validité", () => {
    expect(colonnes("documents")).toContain("expires_at");
  });
});

describe("npm run contraintes", () => {
  const sortie = lancer("verifier-contraintes.mjs");
  const valeurs = (tc) => {
    const m = sortie.match(new RegExp(`\\n  ${tc.replace(".", "\\.")}\\n    ([^\\n]+)`));
    return m ? m[1].split(",").map(v => v.trim()) : [];
  };

  // `statut` est générique : créances, `identite_statut`, valeurs de retour.
  // Le relevé prêtait à `mission_remplacements` cinq valeurs qu'elle ne
  // reçoit jamais.
  it("ne relève pour les remplacements que les valeurs qui leur sont écrites", () => {
    expect(valeurs("mission_remplacements.statut").sort())
      .toEqual(["accepte", "annule", "en_attente", "expire", "refuse"]);
  });

  it("garde les autres colonnes intactes", () => {
    expect(valeurs("missions.delay_status").sort()).toEqual(["approved", "pending", "rejected"]);
    expect(valeurs("profiles.plan_abonnement").sort()).toEqual(["elite", "free", "premium"]);
  });
});
