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
    // « coiffeuse » tenait ce rôle jusqu'au 11/09/2026 — le métier a été ajouté
    // depuis. « soudeuse » et « couvreuse » le remplacent : le bâtiment reste
    // volontairement hors catalogue (garantie décennale, assurances que la
    // RC Pro demandée à l'inscription ne couvre pas).
    expect(trouve("soudeuse")).toHaveLength(0);
    expect(trouve("couvreuse")).toHaveLength(0);
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

// L'écriture inclusive réglée, il restait un écart plus banal : l'appellation
// courante n'est pas le libellé officiel. « Femme de ménage » — le terme le
// plus employé du premier secteur de la plateforme — ne renvoyait aucun
// résultat, pas plus qu'« enseignant » ou « vigile ».
describe("appellations courantes", () => {
  it("trouve le métier sous le nom que les gens emploient", () => {
    expect(trouve("femme de ménage")).toContain("Agent de propreté");
    expect(trouve("homme de ménage")).toContain("Agent de propreté");
    expect(trouve("vigile")).toContain("Agent de sécurité");
    expect(trouve("enseignant")).toContain("Professeur particulier / Soutien scolaire");
    expect(trouve("instituteur")).toContain("Professeur particulier / Soutien scolaire");
  });

  // On rapproche, on n'élargit pas : un mot dont le métier n'existe pas au
  // catalogue doit rester sans résultat. Mieux vaut ne rien trouver que d'être
  // envoyé vers autre chose.
  it("ne renvoie rien pour un métier réellement absent", () => {
    for (const q of ["nounou", "plombier", "électricien", "aide-soignant"]) {
      expect(trouve(q), `« ${q} »`).toHaveLength(0);
    }
  });
});

// Ajoutés le 03/09/2026 : « professeur » ne renvoyait rien, alors que c'est
// l'une des activités les plus exercées en micro-entreprise.
describe("enseignement et formation", () => {
  it("propose les cours et la formation", () => {
    expect(trouve("professeur").length).toBeGreaterThanOrEqual(3);
    expect(trouve("professeure").length).toBeGreaterThanOrEqual(3);   // forme féminine
    expect(trouve("formateur").length).toBeGreaterThanOrEqual(2);
    expect(trouve("formatrice").length).toBeGreaterThanOrEqual(2);
    expect(trouve("soutien scolaire")).toContain("Professeur particulier / Soutien scolaire");
  });
});

// Ajouté le 11/09/2026 : « coiffeur » ne renvoyait rien, alors que la coiffure
// à domicile est l'une des activités les plus répandues en micro-entreprise.
describe("coiffure", () => {
  it("se trouve sous toutes les formes réellement tapées", () => {
    for (const q of ["coiffeur", "coiffeuse", "coiffure", "barbier", "COIFFEUR",
                     "coiffeur a domicile", "coiffeuse à domicile"]) {
      expect(trouve(q), `« ${q} »`).toContain("Coiffeur(se) à domicile");
    }
  });

  // Toujours la même règle : on rapproche, on n'élargit pas. Les métiers
  // voisins n'existent pas au catalogue et doivent rester introuvables, plutôt
  // que d'envoyer quelqu'un vers un coiffeur pour une manucure.
  // La manucure est devenue un métier du catalogue le 02/11/2026 : elle mène
  // à elle-même, jamais au coiffeur.
  it("n'attire pas les métiers voisins de la beauté", () => {
    for (const q of ["maquilleuse"]) {
      expect(trouve(q), `« ${q} »`).toHaveLength(0);
    }
    for (const q of ["manucure", "prothésiste ongulaire"]) {
      expect(trouve(q), `« ${q} »`).toEqual(["Prothésiste ongulaire / Manucure"]);
    }
  });
});

// Relecture du 06/11/2026 : un mot tapé doit COMMENCER un mot du métier.
describe("un mot tapé commence un mot du métier", () => {
  it("plus de rencontres de hasard au milieu d'un mot", () => {
    expect(trouve("chat")).not.toContain("Professeur de danse (autres styles)"); // baChATa
    expect(trouve("sport")).not.toContain("Planificateur transport");          // tranSPORT
    expect(trouve("ménage")).not.toContain("Déménageur");
    expect(trouve("ménage")).not.toContain("Vendeur en électroménager");
    expect(trouve("rat")).toHaveLength(0);
  });
  it("la saisie en cours marche toujours", () => {
    expect(trouve("gouv")).toContain("Gouvernant(e) d'étage");
    expect(trouve("prép")).toContain("Préparateur de commandes");
  });
  it("un mot long se trouve encore au cœur d'un mot composé", () => {
    expect(trouve("conseiller")).toContain("Téléconseiller");
    expect(trouve("nettoyage")).toContain("Agent de bionettoyage (milieu de santé)");
    expect(trouve("scolaire")).toContain("Animateur périscolaire (BAFA)");
    expect(trouve("vendeur")).toContain("Télévendeur");
  });
});

describe("des mots courants qui ne trouvaient rien (06/11/2026)", () => {
  const attendus = {
    "esthéticienne": "Spa praticien / Esthéticien",
    "technicienne de surface": "Technicien de surface",
    "aide ménagère": "Aide à domicile",
    "maître-chien": "Agent cynophile de sécurité",
    "garde-malade": "Auxiliaire de vie",
    "prof de maths": "Professeur particulier / Soutien scolaire",
    "aide aux devoirs": "Professeur particulier / Soutien scolaire",
    "cours d'anglais": "Professeur de langues",
    "piano": "Professeur de musique",
    "zumba": "Professeur de danse (autres styles)",
    "cantine": "Agent de restauration scolaire",
    "inventaire": "Inventoriste",
    "mise en rayon": "Employé de rayon",
    "déménagement": "Déménageur",
    "repassage": "Agent de blanchisserie / Repasseur",
    "médiatrice": "Agent de médiation",
    "baignade": "Maître-nageur sauveteur (BNSSA)",
    "télémarketing": "Télévendeur",
  };
  for (const [q, m] of Object.entries(attendus)) it(`« ${q} » → ${m}`, () => expect(trouve(q)).toContain(m));
  it("on rapproche, on n'élargit pas : « surveillant », « taxi », « aide-soignante » restent sans résultat", () => {
    for (const q of ["surveillant", "taxi", "aide-soignante", "infirmière"]) expect(trouve(q), q).toHaveLength(0);
  });
});

// Relecture du 07/11/2026 : la liste ne se vide plus au milieu d'un mot tapé.
describe("la saisie en cours, lettre après lettre", () => {
  const tapeLettreParLettre = (mot, metier, depuis = 3) => {
    for (let n = depuis; n <= mot.length; n++) expect(trouve(mot.slice(0, n)), `« ${mot.slice(0, n)} »`).toContain(metier);
  };
  it("« gouvernante », « serveuse », « praticienne », « esthéticienne », « vendeuse » ne vident jamais la liste", () => {
    tapeLettreParLettre("gouvernante", "Gouvernant(e) d'étage");
    tapeLettreParLettre("serveuse", "Serveur(se)");
    tapeLettreParLettre("praticienne", "Praticien(ne) en modelage bien-être");
    tapeLettreParLettre("esthéticienne", "Spa praticien / Esthéticien");
    tapeLettreParLettre("vendeuse", "Vendeur en restauration");
    tapeLettreParLettre("caissière", "Caissier(ère) principal(e)");
  });
  it("les morceaux de parenthèse ne trouvent plus rien par hasard", () => {
    expect(trouve("tri")).not.toContain("Animateur(trice) événementiel(le)");
    expect(trouve("cav")).not.toContain("Employé de cafétéria");
    expect(trouve("inv")).not.toContain("Formateur bureautique / informatique");
  });
});
