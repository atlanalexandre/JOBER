import { describe, it, expect } from "vitest";
import { METIERS, correspondRecherche, normaliserTexte, motsCherchables } from "../constants/data.js";

const TOUS = Object.values(METIERS).flat();
const trouve = (q) => TOUS.filter(m => correspondRecherche(m, q));

// Vingt métiers portent une terminaison entre parenthèses. Une recherche par
// `includes` sur le libellé brut ne trouvait AUCUNE des deux formes réellement
// tapées : « gouvernante », « hôtesse », « serveuse » renvoyaient zéro
// résultat, alors que les métiers existaient depuis toujours.
describe("recherche d'un métier écrit en écriture inclusive", () => {
  it("trouve la forme féminine ET la forme masculine", () => {
    for (const [feminin, masculin] of [
      ["gouvernante", "gouvernant"],
      ["hôtesse de caisse", "hôte de caisse"],
      ["serveuse", "serveur"],
      ["caissière", "caissier"],
      ["animatrice", "animateur"],
    ]) {
      expect(trouve(feminin).length, `« ${feminin} »`).toBeGreaterThan(0);
      expect(trouve(masculin).length, `« ${masculin} »`).toBeGreaterThan(0);
    }
  });

  it("trouve « gouvernante » — le cas qui a fait découvrir le problème", () => {
    expect(trouve("gouvernante")).toEqual(
      expect.arrayContaining(["Gouvernant(e) d'étage", "Gouvernant(e) général(e)"])
    );
  });

  it("se moque des accents et de l'ordre des mots", () => {
    expect(trouve("etage gouvernante")).toContain("Gouvernant(e) d'étage");
    expect(trouve("GOUVERNANTE ÉTAGE")).toContain("Gouvernant(e) d'étage");
  });

  it("ne renvoie pas tout et n'importe quoi", () => {
    expect(trouve("plombier")).toHaveLength(0);
    expect(trouve("gouvernante").length).toBeLessThan(5);
  });

  // Le repliement du genre s'applique des deux côtés : il rapproche, il
  // n'invente pas. Un métier absent du catalogue doit rester introuvable.
  it("trouve aussi les féminins des libellés SANS parenthèses", () => {
    expect(trouve("vendeuse").length).toBeGreaterThan(0);
    expect(trouve("chauffeuse").length).toBeGreaterThan(0);
    expect(trouve("coiffeuse")).toHaveLength(0);   // ce métier n'existe pas
  });

  it("une recherche vide n'exclut personne", () => {
    expect(correspondRecherche("Plongeur", "")).toBe(true);
    expect(correspondRecherche("Plongeur", "   ")).toBe(true);
  });
});

describe("normaliserTexte() et motsCherchables()", () => {
  it("retire les accents et la ponctuation", () => {
    expect(normaliserTexte("Hôte(sse) d'accueil")).toBe("hote sse d accueil");
  });

  it("produit les formes masculine et féminine d'un libellé", () => {
    const foin = motsCherchables("Gouvernant(e) d'étage");
    expect(foin).toContain("gouvernant d etage");
    expect(foin).toContain("gouvernante d etage");
  });

  it("laisse intact un libellé sans parenthèse", () => {
    expect(motsCherchables("Plongeur")).toBe("plongeur");
  });
});
