// Le nom du propriétaire n'apparaît dans AUCUN texte qu'un utilisateur peut
// lire — site, e-mails, SMS, notifications, ni dans le code source d'un e-mail
// (un commentaire HTML s'y lit par « afficher la source »). Décision du
// 13/11/2026. Les commentaires internes du code (// et /* */), qui ne sortent
// jamais du dépôt, ne sont pas visés.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const racine = new URL("../../../", import.meta.url).pathname;

// Le texte d'un fichier, commentaires retirés : ce qu'un utilisateur peut lire.
const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const fichiers = (dossier) => readdirSync(join(racine, dossier)).flatMap((n) => {
  const p = join(racine, dossier, n);
  if (statSync(p).isDirectory()) return n === "tests" ? [] : fichiers(join(dossier, n));
  return /\.(js|jsx|html)$/.test(n) ? [p] : [];
});

describe("le nom du propriétaire n'apparaît dans aucun texte visible (décision du 13/11/2026)", () => {
  it("ni dans le site, ni dans les e-mails, SMS et notifications du serveur", () => {
    const fautifs = [...fichiers("src"), ...fichiers("api"), ...fichiers("public")]
      .filter(p => /alexandre|atlan/i.test(sansCommentaires(readFileSync(p, "utf8"))));
    expect(fautifs).toEqual([]);
  });
});
