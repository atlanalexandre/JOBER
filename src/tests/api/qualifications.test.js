import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { QUALIFICATIONS_OBLIGATOIRES, qualificationRequise, qualificationsPour } from "../../../api/_qualifications.js";
import { METIERS, docsRequisPour } from "../../constants/data.js";

// Le document « Diplômes & certifications » était facultatif pour TOUT LE
// MONDE. Un agent de sécurité pouvait donc être mis en relation avec un client
// sans avoir jamais produit sa carte professionnelle — alors qu'exercer sans
// carte est puni de trois ans d'emprisonnement et 45 000 € d'amende.

const TOUS_LES_METIERS = Object.values(METIERS).flat();

describe("la table des qualifications", () => {
  // Une entrée qui ne correspond à aucun métier du catalogue n'exige rien de
  // personne : elle donne l'illusion d'une règle appliquée.
  it("ne vise que des métiers qui existent", () => {
    const inconnus = Object.keys(QUALIFICATIONS_OBLIGATOIRES).filter(m => !TOUS_LES_METIERS.includes(m));
    expect(inconnus, `libellés sans métier correspondant : ${inconnus.join(", ")}`).toEqual([]);
  });

  // « Fournissez un diplôme » fait envoyer n'importe quoi ; « fournissez votre
  // carte professionnelle CNAPS » fait envoyer la carte.
  it("nomme le titre attendu et le texte qui l'impose", () => {
    for (const [metier, q] of Object.entries(QUALIFICATIONS_OBLIGATOIRES)) {
      expect(q.titre, metier).toBeTruthy();
      expect(q.texte, metier).toBeTruthy();
    }
  });

  it("couvre la sécurité privée, où l'exercice sans carte est un délit", () => {
    for (const m of ["Agent de sécurité", "Agent de sûreté", "Agent cynophile de sécurité",
                     "Agent de sécurité incendie SSIAP 1", "Agent de sécurité incendie SSIAP 2",
                     "Agent de prévention des pertes (magasin)"]) {
      expect(qualificationRequise(m), m).toBeTruthy();
      expect(qualificationRequise(m).titre, m).toMatch(/CNAPS|SSIAP/);
    }
  });

  // Servir, vendre ou réchauffer n'est pas préparer : le décret vise la
  // PRÉPARATION de produits frais. Étendre l'exigence aux vendeurs écarterait
  // des prestataires sans fondement — et une exigence sans fondement finit par
  // être contournée, ce qui décrédibilise les autres.
  it("ne vise pas ceux qui vendent sans préparer", () => {
    for (const m of ["Vendeur en boulangerie-pâtisserie", "Employé de rayon", "Employé libre-service",
                     "Fromager en GMS", "Serveur(se)", "Plongeur", "Runner", "Commis de cuisine"]) {
      expect(qualificationRequise(m), m).toBeNull();
    }
  });

  // Le CACES est une recommandation de la CNAM, pas une obligation légale :
  // c'est l'autorisation de conduite de l'employeur qui est obligatoire, et un
  // indépendant n'en a pas.
  it("n'invente pas d'obligation pour les caristes", () => {
    for (const m of TOUS_LES_METIERS.filter(x => x.startsWith("Cariste"))) {
      expect(qualificationRequise(m), m).toBeNull();
    }
  });
});

// Question d'un traiteur, 29/09/2026 : aucun permis n'était demandé, même à un
// chauffeur livreur. Décision d'Alexandre : exigé de ceux qui conduisent
// forcément, facultatif pour les coursiers, qui peuvent livrer à vélo.
describe("le permis de conduire", () => {
  it("est exigé du chauffeur livreur et du voiturier", () => {
    for (const m of ["Chauffeur livreur", "Voiturier"]) {
      expect(qualificationRequise(m)?.titre, m).toMatch(/Permis de conduire B/);
    }
    const docs = docsRequisPour("Française", [{ metier: "Chauffeur livreur" }]);
    expect(docs.find(d => d.id === "diplomes")).toMatchObject({ required: true, label: "Permis de conduire B en cours de validité" });
  });

  it("n'est pas exigé du coursier, qui peut livrer à vélo, mais lui est signalé", async () => {
    const { noteMetier } = await import("../../../api/_qualifications.js");
    for (const m of ["Coursier / Livreur", "Livreur courses à domicile"]) {
      expect(qualificationRequise(m), m).toBeNull();
      expect(noteMetier(m), m).toMatch(/permis/);
    }
  });
});

describe("qualificationsPour()", () => {
  it("dédoublonne par titre", () => {
    const q = qualificationsPour(["Pâtissier", "Chef pâtissier", "Commis pâtissier"]);
    expect(q).toHaveLength(1);
    expect(q[0].metiers).toHaveLength(3);
  });

  it("accepte aussi bien des libellés que des entrées de metiers_list", () => {
    expect(qualificationsPour([{ metier: "Chauffeur VTC" }])).toHaveLength(1);
    expect(qualificationsPour(["Chauffeur VTC"])).toHaveLength(1);
  });

  it("ne s'effondre pas sur une entrée vide ou absente", () => {
    for (const v of [undefined, null, [], [null], [{}], "pas un tableau"]) {
      expect(qualificationsPour(v)).toEqual([]);
    }
  });
});

describe("les documents réclamés au prestataire", () => {
  it("laissent le justificatif facultatif pour un métier non réglementé", () => {
    const d = docsRequisPour("Française", ["Agent de propreté"]).find(x => x.id === "diplomes");
    expect(d.required).toBe(false);
  });

  it("le rendent obligatoire dès qu'un métier réglementé est déclaré", () => {
    const d = docsRequisPour("Française", ["Agent de propreté", "Agent de sécurité"]).find(x => x.id === "diplomes");
    expect(d.required).toBe(true);
    expect(d.label).toBe("Carte professionnelle CNAPS");
    expect(d.info).toMatch(/L612-20/);
  });

  it("nomment tous les titres quand il y en a plusieurs", () => {
    const d = docsRequisPour("Française", ["Coiffeur(se) à domicile", "Chauffeur VTC"]).find(x => x.id === "diplomes");
    expect(d.label).toBe("Titres professionnels");
    expect(d.info).toMatch(/CAP coiffure/);
    expect(d.info).toMatch(/Carte professionnelle VTC/);
  });

  // La règle ajoutée ne doit pas déranger celle qui existait.
  it("n'abîment pas la règle du titre de séjour", () => {
    const horsUE = docsRequisPour("Hors UE", ["Agent de sécurité"]);
    expect(horsUE.find(d => d.id === "titre_sejour")?.required).toBe(true);
    expect(docsRequisPour("Française", ["Agent de sécurité"]).find(d => d.id === "titre_sejour")).toBeUndefined();
  });
});

// La règle ne vaut que si elle est appliquée LÀ OÙ ELLE ENGAGE : à l'ouverture
// de l'accès aux prestations. Un contrôle qui ne vit que dans le navigateur ne
// protège personne.
describe("l'application côté serveur", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");

  it("refuse d'ouvrir l'accès sans justificatif vérifié", () => {
    expect(bo).toContain("qualificationsPour");
    expect(bo).toContain("type=eq.diplomes");
    expect(bo).toContain("justificatif.verified !== true");
  });

  it("n'ouvre pas l'accès au bénéfice du doute si la vérification échoue", () => {
    const bloc = bo.slice(bo.indexOf("qualificationsPour(metiersDeclares(uqData"));
    expect(bloc.slice(0, bloc.indexOf("majProfil"))).toContain("503");
  });
});

// Ajouté le 11/09/2026. Le numéro de déclaration d'activité DREETS n'est
// nécessaire que pour facturer au titre de la FORMATION PROFESSIONNELLE
// CONTINUE — celle financée par un OPCO, un employeur ou le CPF. Un formateur
// qui donne un cours à un particulier n'en a pas besoin.
describe("les notes d'information", () => {
  it("informent sans exiger", async () => {
    const { noteMetier } = await import("../../../api/_qualifications.js");
    expect(noteMetier("Formateur professionnel")).toMatch(/DREETS/);
    // Et surtout : aucune de ces mentions ne rend un document obligatoire.
    const d = docsRequisPour("Française", ["Formateur professionnel"]).find(x => x.id === "diplomes");
    expect(d.required).toBe(false);
  });

  it("ne visent que des métiers qui existent", async () => {
    const { NOTES_METIERS } = await import("../../../api/_qualifications.js");
    const inconnus = Object.keys(NOTES_METIERS).filter(m => !TOUS_LES_METIERS.includes(m));
    expect(inconnus, `libellés sans métier correspondant : ${inconnus.join(", ")}`).toEqual([]);
  });

  // Un métier ne doit pas être à la fois « exigé » et « bon à savoir » : le
  // prestataire ne saurait plus lequel des deux l'engage.
  it("ne se superposent pas aux obligations", async () => {
    const { NOTES_METIERS } = await import("../../../api/_qualifications.js");
    const doublons = Object.keys(NOTES_METIERS).filter(m => QUALIFICATIONS_OBLIGATOIRES[m]);
    expect(doublons).toEqual([]);
  });
});

// Le courriel de validation disait « déposez vos documents justificatifs » sans
// dire lesquels, ni que rien ne se passerait tant qu'ils manqueraient. Le
// prestataire lisait « compte activé », se connectait, ne trouvait aucune
// prestation et écrivait au support.
describe("le courriel de validation du compte", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const mail = bo.slice(bo.indexOf("Bienvenue sur ALANE"), bo.indexOf("Votre demande de compte ALANE"));

  it("dit que l'accès aux prestations n'est PAS encore ouvert", () => {
    expect(mail).toMatch(/ne vous donne pas encore accès aux prestations/);
    expect(mail).toMatch(/vous ne recevrez aucune proposition/);
  });

  it("énumère les pièces de CE prestataire, pas une liste générique", () => {
    expect(bo).toContain("docsRequisPour(userData.user_metadata?.nationalite, metiersDeclares(userData.user_metadata))");
    expect(mail).toContain("docsAttendusPresta.map");
  });

  it("distingue l'obligatoire du facultatif", () => {
    expect(mail).toContain("docsFacultatifsPresta");
    expect(mail).toMatch(/Facultatif/);
  });

  // Les mandats conditionnent l'ouverture de l'accès au même titre que les
  // documents : les taire renvoie le prestataire au support une seconde fois.
  it("rappelle les mandats", () => {
    expect(mail).toMatch(/mandats de facturation et d'encaissement/);
  });

  it("ne s'adresse qu'aux prestataires", () => {
    expect(mail).toContain('role === "prestataire"');
  });
});

// Les libellés des pièces existaient en double — dans DOCS_REQUIS et dans
// VALIDITE_DOCUMENTS. Deux listes de libellés finissent par diverger.
describe("une seule définition des pièces d'un dossier", () => {
  it("les libellés ne vivent qu'à un endroit", async () => {
    const { VALIDITE_DOCUMENTS, libelleDoc } = await import("../../../api/_documents.js");
    for (const regle of Object.values(VALIDITE_DOCUMENTS)) {
      expect(regle).not.toHaveProperty("libelle");
    }
    expect(libelleDoc("urssaf")).toBe("Attestation URSSAF");
    expect(libelleDoc("inconnu")).toBe("inconnu");
  });

  it("le catalogue est servi par le module partagé", async () => {
    const data = readFileSync(new URL("../../constants/data.js", import.meta.url), "utf8");
    expect(data).toContain('export { DOCS_REQUIS, docsRequisPour } from "../../api/_documents.js"');
  });
});

// Métier réglementé ajouté après l'activation (décision d'Alexandre, 29/09/2026).
describe("peutExercer() et titresNonCouverts()", async () => {
  const { peutExercer, titresNonCouverts } = await import("../../../api/_qualifications.js");
  const cnaps = { verified: true, titres_couverts: ["Carte professionnelle CNAPS"] };

  it("un métier libre s'exerce sans justificatif", () => {
    expect(peutExercer("Femme/Valet de chambre", null)).toBe(true);
  });

  it("un métier réglementé exige que la vérification ait constaté SON titre", () => {
    expect(peutExercer("Agent de sécurité", null)).toBe(false);
    expect(peutExercer("Agent de sécurité", cnaps)).toBe(true);
    // Justificatif vérifié pour un autre titre (CAP pâtisserie) : ne couvre pas la carte CNAPS.
    expect(peutExercer("Agent de sécurité", { verified: true, titres_couverts: ["CAP pâtisserie, ou 3 ans de pratique"] })).toBe(false);
    // Ancienne ligne sans titres constatés : rien n'est couvert.
    expect(peutExercer("Agent de sécurité", { verified: true, titres_couverts: null })).toBe(false);
  });

  it("une pièce remplacée, en attente, garde les titres déjà constatés", () => {
    expect(peutExercer("Agent de sécurité", { verified: false, titres_couverts: ["Carte professionnelle CNAPS"] })).toBe(true);
  });

  it("liste ce qui reste à fournir", () => {
    const manque = titresNonCouverts([{ metier: "Agent de sécurité" }, { metier: "Chauffeur livreur" }, { metier: "Serveur(se)" }], cnaps);
    expect(manque.map(q => q.titre)).toEqual(["Permis de conduire B en cours de validité"]);
  });

  it("la migration reprend la table au 29/09/2026, métier par métier", () => {
    const sqlMig = readFileSync(new URL("../../../migrations/2026-09-29_titres_couverts_par_justificatif.sql", import.meta.url), "utf8");
    // Titres ajoutés APRÈS cette reprise unique : aucun justificatif déjà vérifié
    // ne les couvrait (aucun prestataire validé ne déclarait ces métiers le
    // 02/11/2026, vérifié en production en lecture seule) — rien à reprendre.
    const ajoutesApres = ["Intervenant sportif en milieu scolaire", "Agent commercial", "Chargé de recouvrement", "Agent de désinfection",
      // Métiers nouveaux au catalogue le 02/11/2026 : personne ne pouvait les déclarer.
      "Praticien(ne) en modelage bien-être", "Prothésiste ongulaire / Manucure",
      "Professeur de danse classique, jazz ou contemporaine", "Professeur de Pilates",
      // Et le 09/11/2026.
      "Maquilleur(se) (mariage, événement)", "Garde d'enfants de moins de 3 ans (agrément)"];
    for (const [metier, q] of Object.entries(QUALIFICATIONS_OBLIGATOIRES)) {
      if (ajoutesApres.includes(metier)) continue;
      expect(sqlMig, metier).toContain(`('${metier.replace(/'/g, "''")}', '${q.titre.replace(/'/g, "''")}')`);
    }
  });
});

// Alerte « dossier complet » (29/09/2026) : la dernière pièce obligatoire déposée.
describe("piecesManquantes()", async () => {
  const { piecesManquantes, docsRequisPour } = await import("../../../api/_documents.js");
  const requis = docsRequisPour("Française", [{ metier: "Femme/Valet de chambre" }]).filter(d => d.required);

  it("liste ce qui manque ; la photo ne compte que déposée comme pièce (30/09/2026)", () => {
    const sauf = requis.map(d => d.id).filter(id => id !== "rc_pro" && id !== "photo");
    expect(piecesManquantes(requis, sauf).map(d => d.id).sort()).toEqual(["photo", "rc_pro"]);
    expect(piecesManquantes(requis, [...sauf, "photo"]).map(d => d.id)).toEqual(["rc_pro"]);
  });

  it("vide quand tout est là : c'est ce passage à vide qui déclenche l'alerte, une fois", () => {
    expect(piecesManquantes(requis, requis.map(d => d.id))).toEqual([]);
  });

  it("la route n'alerte que si CE dépôt complète le dossier", () => {
    const src = readFileSync(new URL("../../../api/notify-doc.js", import.meta.url), "utf8");
    expect(src).toContain("manquaient.length > 0 && manquent.length === 0");
    expect(src).toContain('profil.status === "approved" && profil.missions_enabled !== true');
  });
});

describe("courriels de dépôt de pièce", () => {
  it("rien par pièce pendant l'inscription ; seulement pour un prestataire déjà activé", () => {
    const src = readFileSync(new URL("../../../api/notify-doc.js", import.meta.url), "utf8");
    const garde = src.indexOf("if (profil && profil.missions_enabled !== true) {");
    const envoiParPiece = src.indexOf("[Document] ${fullName}");
    expect(garde, "garde présente").toBeGreaterThan(0);
    expect(garde, "la garde précède le courriel par pièce").toBeLessThan(envoiParPiece);
    expect(src.indexOf("Dossier complet"), "l'alerte « dossier complet » passe avant la garde").toBeLessThan(garde);
  });
});

describe("alerte « dossier complet » — deux dépôts simultanés", () => {
  it("relit les pièces après l'enregistrement au lieu de se fier à la lecture d'avant", () => {
    const src = readFileSync(new URL("../../../api/notify-doc.js", import.meta.url), "utf8");
    expect(src).toContain("const manquent   = piecesManquantes(requis, apres);");
    expect(src.indexOf("let apres = [...avantDepot, docType];")).toBeGreaterThan(src.indexOf("enregistrerDocument(caller.id"));
  });
});

// Relecture du 30/09/2026 : tous les identifiants dans un seul `in.(…)`.
describe("justificatifsDe() — par lots", async () => {
  const { vi } = await import("vitest");
  const { justificatifsDe } = await import("../../../api/_habilitations.js");
  it("250 prestataires : trois lectures courtes, pas une adresse géante", async () => {
    const urls = [];
    vi.stubGlobal("fetch", vi.fn(async (u) => { urls.push(String(u)); return new Response("[]", { status: 200 }); }));
    const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const carte = await justificatifsDe(ids, "https://b", {});
    vi.unstubAllGlobals();
    expect(carte).toBeInstanceOf(Map);
    expect(urls).toHaveLength(3);
    expect(Math.max(...urls.map(u => u.length))).toBeLessThan(4500);
  });
  it("verify_doc compte le métier principal ET la liste", () => {
    const src = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(src).toContain("const metiersT = metiersDeclares(uTData.user_metadata);");
  });
});

// Relecture du 01/10/2026 : l'ouverture de l'accès lisait `metiers_list` seul.
// Un métier principal réglementé absent de la liste n'était pas contrôlé.
describe("metiersDeclares()", () => {
  it("réunit le métier principal et la liste, sans doublon dans les titres exigés", async () => {
    const { metiersDeclares, qualificationsPour } = await import("../../../api/_qualifications.js");
    const meta = { metier: "Agent de sécurité", metiers_list: [{ sector: "hotellerie", metier: "Femme/Valet de chambre" }] };
    const q = qualificationsPour(meta.metiers_list);
    expect(q, "la liste seule oublie le principal").toEqual([]);
    const tous = qualificationsPour(metiersDeclares(meta));
    expect(tous.map(x => x.metiers)).toEqual([["Agent de sécurité"]]);
    const doublon = qualificationsPour(metiersDeclares({ metier: "Agent de sécurité", metiers_list: [{ metier: "Agent de sécurité" }] }));
    expect(doublon[0].metiers).toEqual(["Agent de sécurité"]);
  });
  it("l'ouverture de l'accès, la liste et les pièces exigées regardent l'union", () => {
    const src = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/(qualificationsPour|docsRequisPour)\([^)]*metiers_list\)/);
  });
});

// Demande d'Alexandre du 02/11/2026 : distinguer les métiers, et que chacun porte
// le titre que la loi exige.
describe("métiers distingués et titres ajoutés (02/11/2026)", async () => {
  const { correspondRecherche, METIERS } = await import("../../constants/data.js");
  it("le sport en deux métiers : l'école d'un côté, le coach de l'autre", () => {
    expect(METIERS.divers).toContain("Intervenant sportif en milieu scolaire");
    expect(correspondRecherche("Intervenant sportif en milieu scolaire", "prof de sport")).toBe(true);
    expect(correspondRecherche("Intervenant sportif en milieu scolaire", "professeur d'EPS")).toBe(true);
    expect(correspondRecherche("Éducateur sportif / Coach", "coach sportif")).toBe(true);
    expect(correspondRecherche("Éducateur sportif / Coach", "prof de sport")).toBe(false);
  });
  it("la carte vérifiée du coach couvre l'intervenant scolaire : même titre (relecture du 03/11/2026)", async () => {
    const { peutExercer } = await import("../../../api/_qualifications.js");
    const carte = { titres_couverts: [qualificationRequise("Éducateur sportif / Coach").titre] };
    expect(peutExercer("Intervenant sportif en milieu scolaire", carte)).toBe(true);
  });
  it("chaque nouveau titre nomme son texte", () => {
    for (const m of ["Intervenant sportif en milieu scolaire", "Agent commercial", "Chargé de recouvrement", "Agent de désinfection"]) {
      expect(qualificationRequise(m)?.texte, m).toBeTruthy();
    }
    expect(qualificationRequise("Agent commercial").texte).toContain("R134-6");
    expect(qualificationRequise("Chargé de recouvrement").texte).toContain("R124-2");
  });
  it("le Certiphyto est une information, pas une exigence : seuls ceux qui utilisent ces produits en ont besoin", async () => {
    const { noteMetier } = await import("../../../api/_qualifications.js");
    expect(qualificationRequise("Jardinier / Paysagiste")).toBeNull();
    expect(noteMetier("Jardinier / Paysagiste")).toContain("Certiphyto");
  });
});

// Bien-être, danse et ongles (02/11/2026) : un métier séparé là où la règle change.
describe("bien-être, danse et ongles : chacun son titre", async () => {
  const { correspondRecherche, METIERS } = await import("../../constants/data.js");
  const { noteMetier } = await import("../../../api/_qualifications.js");
  const tous = Object.values(METIERS).flat();
  const trouve = (q) => tous.filter(m => correspondRecherche(m, q));

  it("la danse classique, jazz, contemporaine exige le diplôme d'État ; les autres styles non", () => {
    expect(qualificationRequise("Professeur de danse classique, jazz ou contemporaine").texte).toContain("L362-1");
    expect(qualificationRequise("Professeur de danse (autres styles)")).toBeNull();
    expect(noteMetier("Professeur de danse (autres styles)")).toContain("diplôme d'État");
    expect(trouve("salsa")).toEqual(["Professeur de danse (autres styles)"]);
    expect(trouve("prof de danse")).toHaveLength(2);
  });
  it("le Pilates exige la carte d'éducateur sportif ; le yoga, non tranché, porte une note", () => {
    expect(qualificationRequise("Professeur de Pilates").texte).toContain("L212-1");
    expect(qualificationRequise("Professeur de yoga")).toBeNull();
    expect(noteMetier("Professeur de yoga")).toContain("carte professionnelle");
  });
  it("modelage et ongles sont des soins esthétiques : CAP ou 3 ans de pratique", () => {
    for (const m of ["Praticien(ne) en modelage bien-être", "Prothésiste ongulaire / Manucure"]) {
      expect(qualificationRequise(m)?.texte, m).toContain("art. 16");
    }
    expect(qualificationRequise("Praticien(ne) en modelage bien-être").detail).toContain("kinésithérapeutes");
  });
  it("« masseur », « massage », « ongles » trouvent le bon métier, et rien d'autre", () => {
    for (const q of ["masseur", "masseuse", "massage"]) expect(trouve(q), q).toEqual(["Praticien(ne) en modelage bien-être"]);
    expect(trouve("ongles")).toEqual(["Prothésiste ongulaire / Manucure"]);
    expect(trouve("kinésithérapeute")).toHaveLength(0);
  });
});

// Garde d'animaux (06/11/2026) : chez le propriétaire seulement, sans titre exigé.
describe("garde d'animaux : chez le propriétaire, sans diplôme, pension exclue", async () => {
  const { correspondRecherche, METIERS } = await import("../../constants/data.js");
  const { noteMetier } = await import("../../../api/_qualifications.js");
  const M = "Garde d'animaux / Promeneur de chiens (chez le propriétaire)";
  const tous = Object.values(METIERS).flat();
  const trouve = (q) => tous.filter(m => correspondRecherche(m, q));

  it("aucun titre exigé ; la note exclut l'hébergement et borne le crédit d'impôt", () => {
    expect(qualificationRequise(M)).toBeNull();
    expect(noteMetier(M)).toContain("ACACED");
    expect(noteMetier(M)).toContain("n'est pas proposée sur ALANE");
    expect(noteMetier(M)).toContain("personnes âgées ou dépendantes");
  });
  it("« dog sitter », « pet sitter », « garde de chat », « promeneur » le trouvent", () => {
    for (const q of ["dog sitter", "pet sitter", "garde de chat", "promeneur", "garde de chien"]) expect(trouve(q), q).toEqual([M]);
  });
  it("on rapproche, on n'élargit pas : ni toiletteur, ni pension, ni vétérinaire", () => {
    for (const q of ["toiletteur", "pension canine", "vétérinaire"]) expect(trouve(q), q).toHaveLength(0);
  });
});

// Garde d'enfants, petits travaux, informatique, maquillage (09/11/2026).
describe("les métiers du 09/11/2026 : chacun sa règle", async () => {
  const { correspondRecherche, METIERS } = await import("../../constants/data.js");
  const { noteMetier } = await import("../../../api/_qualifications.js");
  const tous = Object.values(METIERS).flat();
  const trouve = (q) => tous.filter(m => correspondRecherche(m, q));
  const G3 = "Garde d'enfants de 3 ans et plus / Baby-sitting (chez les parents)";
  const G0 = "Garde d'enfants de moins de 3 ans (agrément)";
  const BR = "Petits travaux de bricolage (montage de meubles, fixations)";
  it("la garde d'enfants : sans agrément dès 3 ans, avec agrément avant ; jamais chez le prestataire", () => {
    expect(qualificationRequise(G3)).toBeNull();
    expect(noteMetier(G3)).toContain("assistante maternelle");
    expect(qualificationRequise(G0).texte).toContain("L7232-1");
    expect(trouve("nounou")).toEqual(expect.arrayContaining([G3, G0]));
    expect(trouve("baby-sitter")).toContain(G3);
  });
  it("les petits travaux excluent le bâtiment ; le plombier reste introuvable", () => {
    expect(qualificationRequise(BR)).toBeNull();
    expect(noteMetier(BR)).toContain("plomberie");
    expect(trouve("homme toutes mains")).toEqual([BR]);
    expect(trouve("plombier")).toHaveLength(0);
  });
  it("le maquillage est un soin esthétique : même titre que l'esthéticienne", () => {
    expect(qualificationRequise("Maquilleur(se) (mariage, événement)").titre).toBe(qualificationRequise("Spa praticien / Esthéticien").titre);
    expect(qualificationRequise("Assistance informatique à domicile")).toBeNull();
  });
});

// L'extrait de casier judiciaire (09/11/2026) : il ouvre le MÉTIER, pas le compte.
describe("l'extrait de casier judiciaire, pour les métiers au contact d'enfants", async () => {
  const { casierExige, casierValide, peutExercer: peut } = await import("../../../api/_qualifications.js");
  const { docsRequisPour, VALIDITE_DOCUMENTS } = await import("../../../api/_documents.js");
  const { habiliteDans } = await import("../../../api/_habilitations.js");
  const G3 = "Garde d'enfants de 3 ans et plus / Baby-sitting (chez les parents)";
  const G0 = "Garde d'enfants de moins de 3 ans (agrément)";
  const casierOk = { verified: true, expires_at: "2099-01-01" };
  it("exigé pour la garde d'enfants, l'animation et le soutien scolaire — pas pour le ménage", () => {
    for (const m of [G3, G0, "Animateur club enfants", "Animateur périscolaire (BAFA)", "Professeur particulier / Soutien scolaire"]) expect(casierExige(m), m).toBe(true);
    expect(casierExige("Agent de propreté")).toBe(false);
  });
  it("sans extrait vérifié et valable, le métier reste fermé ; le ménage, lui, reste ouvert", () => {
    expect(peut(G3, null)).toBe(false);
    expect(peut(G3, { casier: { verified: false } })).toBe(false);
    expect(peut(G3, { casier: { verified: true, expires_at: "2020-01-01" } })).toBe(false);
    expect(peut(G3, { casier: casierOk })).toBe(true);
    expect(habiliteDans(new Map(), "p1", G3)).toBe(false);
    expect(habiliteDans(new Map(), "p1", "Agent de propreté")).toBe(true);
  });
  it("avant 3 ans : l'agrément ET l'extrait", () => {
    const titre = qualificationRequise(G0).titre;
    expect(peut(G0, { casier: casierOk })).toBe(false);
    expect(peut(G0, { titres_couverts: [titre] })).toBe(false);
    expect(peut(G0, { titres_couverts: [titre], casier: casierOk })).toBe(true);
    expect(casierValide({ casier: { verified: true, expires_at: "2026-11-09" } }, new Date("2026-11-09T12:00:00Z"))).toBe(true);
  });
  it("la pièce n'est demandée qu'à qui déclare un tel métier, et vaut un an", () => {
    expect(docsRequisPour("France", ["Agent de propreté"]).some(d => d.id === "casier")).toBe(false);
    const c = docsRequisPour("France", [G3, "Agent de propreté"]).find(d => d.id === "casier");
    expect(c.required).toBe(true);
    expect(c.info).toContain(G3);
    expect(VALIDITE_DOCUMENTS.casier.mois).toBe(12);
  });
  it("le type est connu de la contrainte, du dépôt et de l'enregistrement", () => {
    const lire = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
    expect(lire("migrations/2026-11-09_documents_casier_judiciaire.sql")).toContain("'titre_sejour', 'casier'");
    expect(lire("api/notify-doc.js")).toMatch(/TYPES_ENREGISTRABLES = \[[^\]]*"casier"/);
    expect(lire("api/upload-document.js")).toMatch(/TYPES_PIECES = \[[^\]]*"casier"/);
    expect(lire("api/_habilitations.js")).toContain("type=in.(diplomes,casier)");
  });
});

// Relecture du 09/11/2026 : l'échéance de l'extrait, la référence d'un titre remplacé, le bandeau.
describe("casier et référence : ce qui ne doit pas durer plus que la pièce", () => {
  const lire = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
  it("un extrait validé sans date reçoit une échéance d'un an", () => {
    expect(lire("api/bo-action.js")).toMatch(/if \(!expiresAt && docTrouve\.type === "casier"\) \{[\s\S]{0,120}getUTCFullYear\(\) \+ 1\)/);
  });
  it("un fichier redéposé perd la référence de l'ancien", () => {
    expect(lire("api/notify-doc.js")).toMatch(/expires_at: null, relance_expiration_at: null,[\s\S]{0,300}reference_verification: null/);
  });
  it("le bandeau du prestataire dit qu'un métier est fermé faute d'extrait", () => {
    const ecran = lire("src/components/presta-screens.jsx");
    expect(ecran).toContain('.in("type", ["diplomes", "casier"])');
    expect(ecran).toContain("extrait de casier judiciaire (bulletin n° 3)");
  });
});
