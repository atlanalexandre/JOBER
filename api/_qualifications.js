// ═══════════════════════════════════════════════════════════════════════════
// Les métiers dont l'exercice suppose un titre — et lesquels exactement
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Le document « Diplômes & certifications » était facultatif pour TOUT LE
// MONDE. Un agent de sécurité pouvait donc être mis en relation avec un client
// sans jamais avoir produit sa carte professionnelle, alors que l'exercice sans
// carte est un délit — et que la plateforme, qui organise la mise en relation,
// se trouverait en difficulté pour expliquer qu'elle n'avait rien demandé.
//
// Ce tableau nomme, métier par métier, LE titre attendu. Il ne dit pas « un
// diplôme est requis » : il dit lequel, et au titre de quel texte. Un
// prestataire à qui l'on réclame « un diplôme » envoie n'importe quoi ; à qui
// l'on réclame « sa carte professionnelle CNAPS », envoie sa carte.
//
// CE QUE ÇA NE FAIT PAS
//
// La plateforme ne VÉRIFIE pas la validité du titre : elle exige qu'il soit
// produit, et le back-office le regarde comme les autres pièces. Contrôler une
// carte CNAPS auprès du CNAPS, un permis auprès de l'ANTS ou un diplôme auprès
// de son école suppose des accès qu'elle n'a pas. C'est une exigence de
// production, pas une certification — et les écrans le disent.
//
// POURQUOI LE PRESTATAIRE EST CONCERNÉ, ET PAS SON DONNEUR D'ORDRE
//
// Les prestataires d'ALANE sont des INDÉPENDANTS : ils exercent en leur nom
// propre. La qualification professionnelle exigée des activités artisanales
// (loi n° 96-603 du 5 juillet 1996, art. 16) pèse sur celui qui exerce ou qui
// contrôle l'exécution — donc sur eux, et non sur un employeur qu'ils n'ont
// pas.
//
// AVANT D'AJOUTER UNE ENTRÉE
//
// Vérifier que le titre est exigé par un TEXTE, et pas seulement recommandé par
// l'usage. Le CACES, par exemple, n'est pas une obligation légale mais une
// recommandation de la CNAM : c'est l'autorisation de conduite délivrée par
// l'employeur qui est obligatoire, et un indépendant n'en a pas. Exiger un
// CACES écarterait des prestataires sans fondement — et une exigence sans
// fondement finit par être contournée, ce qui décrédibilise les autres.
export const QUALIFICATIONS_OBLIGATOIRES = {
  // ── Sécurité privée : carte professionnelle CNAPS ────────────────────────
  // Livre VI du code de la sécurité intérieure, art. L612-20. Exercer sans
  // carte est puni de trois ans d'emprisonnement et 45 000 € d'amende
  // (art. L617-1). La carte suppose déjà une aptitude professionnelle (CQP APS
  // ou TFP) et une enquête de moralité : la réclamer, c'est réclamer les deux.
  "Agent de sécurité":                  { titre: "Carte professionnelle CNAPS", detail: "délivrée après CQP APS ou TFP et enquête de moralité", texte: "code de la sécurité intérieure, art. L612-20" },
  "Agent de sûreté":                    { titre: "Carte professionnelle CNAPS", detail: "mention sûreté aéroportuaire le cas échéant", texte: "code de la sécurité intérieure, art. L612-20" },
  "Agent cynophile de sécurité":        { titre: "Carte professionnelle CNAPS mention cynophile", detail: "et certificat du chien", texte: "code de la sécurité intérieure, art. L612-20" },
  "Agent de sécurité incendie SSIAP 1": { titre: "Diplôme SSIAP 1 à jour", detail: "avec carte professionnelle CNAPS et recyclage triennal", texte: "arrêté du 2 mai 2005" },
  "Agent de sécurité incendie SSIAP 2": { titre: "Diplôme SSIAP 2 à jour", detail: "avec carte professionnelle CNAPS et recyclage triennal", texte: "arrêté du 2 mai 2005" },
  "Agent de prévention des pertes (magasin)": { titre: "Carte professionnelle CNAPS", detail: "la surveillance en magasin relève de la sécurité privée", texte: "code de la sécurité intérieure, art. L612-20" },

  // ── Sport et baignade : carte professionnelle d'éducateur sportif ────────
  // Code du sport, art. L212-1 : enseigner contre rémunération suppose un
  // diplôme inscrit au RNCP et une déclaration d'activité.
  "Éducateur sportif / Coach":          { titre: "Carte professionnelle d'éducateur sportif", detail: "diplôme inscrit au RNCP et déclaration à la DRAJES", texte: "code du sport, art. L212-1" },
  "Maître-nageur sauveteur (BNSSA)":    { titre: "BNSSA ou BPJEPS AAN à jour", detail: "révision annuelle du BNSSA, carte professionnelle pour l'enseignement", texte: "code du sport, art. L212-1 et A322-8" },

  // ── Animation ────────────────────────────────────────────────────────────
  "Animateur périscolaire (BAFA)":      { titre: "BAFA (ou équivalent)", detail: "exigé pour l'encadrement en accueil collectif de mineurs", texte: "code de l'action sociale et des familles, art. R227-12" },
  "Animateur club enfants":             { titre: "BAFA (ou équivalent)", detail: "exigé dès lors que l'accueil relève des ACM", texte: "code de l'action sociale et des familles, art. R227-12" },

  // ── Conduite professionnelle ─────────────────────────────────────────────
  "Chauffeur VTC":                      { titre: "Carte professionnelle VTC", detail: "et inscription au registre des exploitants VTC", texte: "code des transports, art. L3120-2-1" },
  "Chauffeur poids lourd (permis C)":   { titre: "Permis C, FIMO et FCO à jour", detail: "carte de qualification de conducteur", texte: "code des transports, art. R3314-1" },
  "Chauffeur de bus / autocar":         { titre: "Permis D, FIMO et FCO à jour", detail: "carte de qualification de conducteur", texte: "code des transports, art. R3314-1" },

  // ── Coiffure et esthétique ───────────────────────────────────────────────
  "Coiffeur(se) à domicile":            { titre: "CAP coiffure, BP, ou 3 ans de pratique", detail: "la qualification peut être détenue par le prestataire ou par celui qui contrôle l'exécution", texte: "loi n° 46-1173 du 23 mai 1946" },
  "Spa praticien / Esthéticien":        { titre: "CAP esthétique-cosmétique, ou 3 ans de pratique", detail: "les soins esthétiques sont une activité artisanale réglementée", texte: "loi n° 96-603 du 5 juillet 1996, art. 16" },

  // ── Métiers de bouche artisanaux ─────────────────────────────────────────
  // La préparation de produits frais de boulangerie, pâtisserie, boucherie,
  // charcuterie, poissonnerie et des glaces artisanales figure nommément dans
  // le décret n° 98-246. Servir, vendre ou réchauffer n'est pas préparer : les
  // vendeurs et les employés de rayon ne sont donc PAS concernés.
  "Boulanger":                          { titre: "CAP boulangerie, ou 3 ans de pratique", detail: "préparation de produits frais de boulangerie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Boulanger en GMS":                   { titre: "CAP boulangerie, ou 3 ans de pratique", detail: "préparation de produits frais de boulangerie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Pâtissier":                          { titre: "CAP pâtisserie, ou 3 ans de pratique", detail: "préparation de produits frais de pâtisserie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Commis pâtissier":                   { titre: "CAP pâtisserie, ou 3 ans de pratique", detail: "préparation de produits frais de pâtisserie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Chef pâtissier":                     { titre: "CAP pâtisserie, ou 3 ans de pratique", detail: "préparation de produits frais de pâtisserie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Chocolatier":                        { titre: "CAP chocolatier-confiseur, ou 3 ans de pratique", detail: "préparation de produits frais de confiserie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Glacier":                            { titre: "CAP glacier-fabricant, ou 3 ans de pratique", detail: "fabrication de glaces alimentaires artisanales", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Charcutier-traiteur":                { titre: "CAP charcutier-traiteur, ou 3 ans de pratique", detail: "préparation de produits frais de charcuterie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Boucher en GMS":                     { titre: "CAP boucher, ou 3 ans de pratique", detail: "préparation de produits frais de boucherie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Poissonnier-écailler":               { titre: "CAP poissonnier-écailler, ou 3 ans de pratique", detail: "préparation de produits frais de poissonnerie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Poissonnier en GMS":                 { titre: "CAP poissonnier-écailler, ou 3 ans de pratique", detail: "préparation de produits frais de poissonnerie", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Traiteur":                           { titre: "CAP cuisine ou charcutier-traiteur, ou 3 ans de pratique", detail: "préparation de produits frais destinés à la vente", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },
  "Rôtisseur":                          { titre: "CAP cuisine ou boucher, ou 3 ans de pratique", detail: "préparation de produits frais carnés", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },

  // ── Bâtiment ─────────────────────────────────────────────────────────────
  // L'entretien et la réparation de bâtiments figurent au décret n° 98-246. Le
  // catalogue écarte déjà l'électricité, la plomberie et la couverture, qui
  // relèvent de la garantie décennale ; celui-ci reste, et suppose donc une
  // qualification.
  "Agent d'entretien du bâtiment":      { titre: "CAP du second œuvre, ou 3 ans de pratique", detail: "l'entretien de bâtiments est une activité artisanale réglementée", texte: "loi n° 96-603, art. 16 et décret n° 98-246" },

  // ── Travaux en hauteur ───────────────────────────────────────────────────
  "Laveur de vitres en hauteur (cordiste)": { titre: "CQP cordiste ou CATSC / IRATA", detail: "les travaux sur cordes exigent une formation certifiée", texte: "code du travail, art. R4323-89" },
};

/**
 * Le métier suppose-t-il un titre ? Renvoie la qualification attendue, ou null.
 */
export function qualificationRequise(metier) {
  return QUALIFICATIONS_OBLIGATOIRES[metier] || null;
}

/**
 * Les qualifications attendues d'un prestataire, au vu des métiers qu'il
 * déclare. Dédoublonnées par titre : un pâtissier qui déclare aussi
 * « chef pâtissier » n'a pas à produire deux fois le même CAP.
 *
 * @param {Array<string|{metier:string}>} metiers  `metiers_list` ou une liste de libellés
 */
export function qualificationsPour(metiers) {
  const libelles = (Array.isArray(metiers) ? metiers : [])
    .map(m => (typeof m === "string" ? m : m?.metier))
    .filter(Boolean);
  const parTitre = new Map();
  for (const libelle of libelles) {
    const q = QUALIFICATIONS_OBLIGATOIRES[libelle];
    if (!q) continue;
    if (!parTitre.has(q.titre)) parTitre.set(q.titre, { ...q, metiers: [libelle] });
    else parTitre.get(q.titre).metiers.push(libelle);
  }
  return [...parTitre.values()];
}


// ═══════════════════════════════════════════════════════════════════════════
// Ce qu'il faut SAVOIR sans que ce soit exigible
// ═══════════════════════════════════════════════════════════════════════════
//
// À distinguer soigneusement du tableau ci-dessus. Là, un texte impose un titre
// et la plateforme le réclame. Ici, une condition existe mais ne s'applique
// qu'à une partie des situations : l'exiger de tous écarterait des
// prestataires parfaitement en règle.
//
// Le cas qui a motivé cette distinction : le numéro de déclaration d'activité
// (DREETS) des formateurs. Il n'est nécessaire que pour facturer au titre de la
// FORMATION PROFESSIONNELLE CONTINUE — celle financée par un OPCO, un employeur
// ou le CPF. Un formateur qui donne un cours à un particulier n'en a pas
// besoin. Le réclamer à tous aurait écarté la majorité des inscrits.
//
// Une exigence sans fondement finit par être contournée, et décrédibilise
// celles qui en ont un. On informe, et on laisse le prestataire se conformer.
export const NOTES_METIERS = {
  "Formateur professionnel":              { texte: "Pour facturer au titre de la formation professionnelle continue (OPCO, employeur, CPF), un numéro de déclaration d'activité auprès de la DREETS est nécessaire. Il ne l'est pas pour un cours donné à un particulier." },
  "Formateur bureautique / informatique": { texte: "Pour facturer au titre de la formation professionnelle continue (OPCO, employeur, CPF), un numéro de déclaration d'activité auprès de la DREETS est nécessaire. Il ne l'est pas pour un cours donné à un particulier." },
  "Professeur particulier / Soutien scolaire": { texte: "Les cours à domicile chez un particulier peuvent ouvrir droit au crédit d'impôt services à la personne, sous réserve d'une déclaration d'activité SAP. Ce n'est pas une condition d'exercice." },
  "Aide à domicile":                      { texte: "L'aide à domicile chez un particulier peut ouvrir droit au crédit d'impôt services à la personne, sous réserve d'une déclaration d'activité SAP. Ce n'est pas une condition d'exercice." },
  "Auxiliaire de vie":                    { texte: "L'intervention auprès de personnes vulnérables peut relever d'un agrément ou d'une autorisation départementale selon le public accompagné. À vérifier avant d'accepter ce type de prestation." },
};

/** Ce qu'il faut savoir sur ce métier, sans que ce soit exigible. */
export function noteMetier(metier) {
  return NOTES_METIERS[metier]?.texte || null;
}
