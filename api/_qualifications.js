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
  // L'intervenant extérieur à l'école primaire doit être agréé par
  // l'IA-DASEN ; la carte professionnelle vaut agrément. Sans carte, l'agrément
  // suit une vérification d'honorabilité. Dans le second degré et le privé,
  // c'est la carte (code du sport, art. L212-1) qui est exigée (02/11/2026).
  //
  // Le titre est le MÊME que celui du coach : `peutExercer()` compare les
  // titres à l'identique, et une carte déjà vérifiée pour le coach ne couvrait
  // pas l'intervenant — il fallait la faire revalider (relecture du 03/11/2026).
  // L'agrément seul, à l'école primaire, est dit dans le détail : le
  // back-office le vérifie à l'œil sous ce titre.
  "Intervenant sportif en milieu scolaire": { titre: "Carte professionnelle d'éducateur sportif", detail: "ou, à l'école primaire, l'agrément de l'Éducation nationale — la carte vaut agrément ; le directeur d'école autorise ensuite chaque intervention", texte: "code du sport, art. L212-1 ; décret n° 2017-766 du 4 mai 2017" },
  // Le Pilates est une activité physique : son enseignement rémunéré relève
  // du même article (02/11/2026). Le yoga, non tranché, est en NOTES_METIERS.
  "Professeur de Pilates":              { titre: "Carte professionnelle d'éducateur sportif", detail: "diplôme des métiers de la forme (BPJEPS, CQP instructeur fitness…) et déclaration à la DRAJES", texte: "code du sport, art. L212-1" },
  "Maître-nageur sauveteur (BNSSA)":    { titre: "BNSSA ou BPJEPS AAN à jour", detail: "révision annuelle du BNSSA, carte professionnelle pour l'enseignement", texte: "code du sport, art. L212-1 et A322-8" },

  // ── Animation ────────────────────────────────────────────────────────────
  "Animateur périscolaire (BAFA)":      { titre: "BAFA (ou équivalent)", detail: "exigé pour l'encadrement en accueil collectif de mineurs", texte: "code de l'action sociale et des familles, art. R227-12" },
  "Animateur club enfants":             { titre: "BAFA (ou équivalent)", detail: "exigé dès lors que l'accueil relève des ACM", texte: "code de l'action sociale et des familles, art. R227-12" },

  // ── Conduite professionnelle ─────────────────────────────────────────────
  "Chauffeur VTC":                      { titre: "Carte professionnelle VTC", detail: "et inscription au registre des exploitants VTC", texte: "code des transports, art. L3120-2-1" },
  "Chauffeur poids lourd (permis C)":   { titre: "Permis C, FIMO et FCO à jour", detail: "carte de qualification de conducteur", texte: "code des transports, art. R3314-1" },
  "Chauffeur de bus / autocar":         { titre: "Permis D, FIMO et FCO à jour", detail: "carte de qualification de conducteur", texte: "code des transports, art. R3314-1" },
  // Ces deux métiers conduisent forcément : un véhicule de livraison, ou celui
  // du client. Aucun permis n'était demandé (relevé le 29/09/2026, sur la
  // question d'un traiteur). Les coursiers, qui peuvent livrer à vélo ou à
  // pied, ne sont PAS ici : voir NOTES_METIERS (décision d'Alexandre).
  "Chauffeur livreur":                  { titre: "Permis de conduire B en cours de validité", detail: "le métier suppose la conduite d'un véhicule", texte: "code de la route, art. L221-2" },
  "Voiturier":                          { titre: "Permis de conduire B en cours de validité", detail: "le voiturier conduit les véhicules des clients", texte: "code de la route, art. L221-2" },

  // ── Coiffure et esthétique ───────────────────────────────────────────────
  "Coiffeur(se) à domicile":            { titre: "CAP coiffure, BP, ou 3 ans de pratique", detail: "la qualification peut être détenue par le prestataire ou par celui qui contrôle l'exécution", texte: "loi n° 46-1173 du 23 mai 1946" },
  "Spa praticien / Esthéticien":        { titre: "CAP esthétique-cosmétique, ou 3 ans de pratique", detail: "les soins esthétiques sont une activité artisanale réglementée", texte: "loi n° 96-603 du 5 juillet 1996, art. 16" },
  // Modelage et ongles : soins esthétiques eux aussi (art. 16 ; les
  // « modelages esthétiques de confort sans finalité médicale » y figurent
  // depuis la loi du 2 août 2005). Ajoutés le 02/11/2026.
  "Praticien(ne) en modelage bien-être": { titre: "CAP esthétique-cosmétique, ou 3 ans de pratique", detail: "le modelage de confort est un soin esthétique réglementé ; le massage à visée thérapeutique reste réservé aux masseurs-kinésithérapeutes ; prestation de bien-être exclusivement, sans aucun caractère sexuel", texte: "loi n° 96-603 du 5 juillet 1996, art. 16" },
  // Maquillage (09/11/2026) : soin esthétique, même titre que l'esthéticienne
  // — un justificatif vérifié pour l'un couvre l'autre.
  "Maquilleur(se) (mariage, événement)": { titre: "CAP esthétique-cosmétique, ou 3 ans de pratique", detail: "le maquillage est un soin esthétique réglementé", texte: "loi n° 96-603 du 5 juillet 1996, art. 16" },
  // Garde d'enfants de moins de 3 ans (09/11/2026) : l'agrément est
  // obligatoire, y compris pour un micro-entrepreneur.
  "Garde d'enfants de moins de 3 ans (agrément)": { titre: "Agrément « services à la personne » pour la garde d'enfants de moins de 3 ans", detail: "délivré par la DDETS de votre département (démarche sur NOVA), valable 5 ans", texte: "code du travail, art. L7232-1" },
  "Prothésiste ongulaire / Manucure":   { titre: "CAP esthétique-cosmétique, ou 3 ans de pratique", detail: "la manucure et la pose d'ongles sont des soins esthétiques réglementés", texte: "loi n° 96-603 du 5 juillet 1996, art. 16" },

  // ── Danse (02/11/2026) ───────────────────────────────────────────────────
  // Enseigner contre rémunération la danse classique, jazz ou contemporaine
  // suppose le diplôme d'État de professeur de danse, le certificat
  // d'aptitude, un titre reconnu équivalent ou une dispense. Les autres styles
  // ne sont pas visés : « Professeur de danse (autres styles) » n'est pas ici.
  "Professeur de danse classique, jazz ou contemporaine": { titre: "Diplôme d'État de professeur de danse", detail: "ou certificat d'aptitude, équivalence reconnue ou dispense du ministère de la Culture", texte: "code de l'éducation, art. L362-1" },

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

  // ── Commerce et recouvrement (02/11/2026) ────────────────────────────────
  // L'agent commercial doit être immatriculé au registre spécial des agents
  // commerciaux AVANT d'exercer (amende prévue à l'art. R134-9).
  "Agent commercial":                   { titre: "Immatriculation au registre spécial des agents commerciaux (RSAC)", detail: "extrait d'immatriculation ; formalité en ligne sur le guichet unique de l'INPI", texte: "code de commerce, art. R134-6" },
  // Recouvrer des créances POUR LE COMPTE D'AUTRUI — ce que fait un
  // prestataire missionné par un client — suppose une assurance de
  // responsabilité civile propre à cette activité et un compte bancaire
  // exclusivement affecté aux fonds encaissés pour les créanciers.
  "Chargé de recouvrement":             { titre: "Assurance RC recouvrement et compte bancaire dédié aux fonds des créanciers", detail: "attestation d'assurance et justificatif du compte", texte: "code des procédures civiles d'exécution, art. R124-2" },

  // ── Désinfection (02/11/2026) ────────────────────────────────────────────
  // Depuis le 1er janvier 2024, les désinfectants (types de produits 2, 3, 4)
  // entrent dans le champ du certificat individuel : la désinfection est le
  // métier même de ce prestataire.
  "Agent de désinfection":              { titre: "Certibiocide « désinfectants »", detail: "certificat individuel d'utilisateur professionnel de produits biocides", texte: "arrêté du 9 octobre 2013 modifié" },

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
  // Dédoublonnés : le métier principal figure souvent AUSSI dans la liste, et
  // `metiersDeclares()` les réunit — « exigé pour « X », « X » » se lirait mal.
  const libelles = [...new Set((Array.isArray(metiers) ? metiers : [])
    .map(m => (typeof m === "string" ? m : m?.metier))
    .filter(Boolean))];
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
  "Coursier / Livreur":                   { texte: "Si vous livrez en voiture, en scooter ou en moto, déposez votre permis de conduire dans « Diplômes & certifications ». Il n'est pas exigé pour une livraison à vélo ou à pied." },
  "Livreur courses à domicile":           { texte: "Si vous livrez en voiture, en scooter ou en moto, déposez votre permis de conduire dans « Diplômes & certifications ». Il n'est pas exigé pour une livraison à vélo ou à pied." },
  "Formateur professionnel":              { texte: "Pour facturer au titre de la formation professionnelle continue (OPCO, employeur, CPF), un numéro de déclaration d'activité auprès de la DREETS est nécessaire. Il ne l'est pas pour un cours donné à un particulier." },
  "Formateur bureautique / informatique": { texte: "Pour facturer au titre de la formation professionnelle continue (OPCO, employeur, CPF), un numéro de déclaration d'activité auprès de la DREETS est nécessaire. Il ne l'est pas pour un cours donné à un particulier." },
  "Professeur particulier / Soutien scolaire": { texte: "Les cours à domicile chez un particulier peuvent ouvrir droit au crédit d'impôt services à la personne, sous réserve d'une déclaration d'activité SAP. Ce n'est pas une condition d'exercice." },
  "Aide à domicile":                      { texte: "L'aide à domicile chez un particulier peut ouvrir droit au crédit d'impôt services à la personne, sous réserve d'une déclaration d'activité SAP. Ce n'est pas une condition d'exercice." },
  // Certiphyto : obligatoire pour qui achète ou applique des produits
  // phytopharmaceutiques, pas pour qui entretient sans en utiliser — et la loi
  // Labbé les interdit déjà sur la plupart des espaces ouverts au public
  // (02/11/2026).
  "Jardinier / Paysagiste":               { texte: "Si vous achetez ou appliquez des produits phytopharmaceutiques (désherbants, traitements), le certificat individuel Certiphyto est obligatoire : déposez-le dans « Diplômes & certifications ». Il ne l'est pas pour un entretien sans ces produits." },
  "Agent d'entretien d'espaces verts":    { texte: "Si vous achetez ou appliquez des produits phytopharmaceutiques (désherbants, traitements), le certificat individuel Certiphyto est obligatoire : déposez-le dans « Diplômes & certifications ». Il ne l'est pas pour un entretien sans ces produits." },
  "Agent de bionettoyage (milieu de santé)": { texte: "L'utilisation professionnelle de certains désinfectants suppose le Certibiocide « désinfectants » (arrêté du 9 octobre 2013). Si vous en détenez un, déposez-le dans « Diplômes & certifications »." },
  // Yoga : aucun texte ne l'impose clairement, et l'administration ne l'a pas
  // tranché. Exiger la carte écarterait la plupart des professeurs ; ne rien
  // dire les exposerait (02/11/2026).
  "Professeur de yoga":                   { texte: "Aucun diplôme n'est exigé par un texte pour enseigner le yoga. Si votre cours est présenté comme une activité physique ou sportive (yoga dynamique, en salle de sport), la carte professionnelle d'éducateur sportif peut vous être demandée : déposez-la dans « Diplômes & certifications » si vous l'avez." },
  "Professeur de danse (autres styles)":  { texte: "Seules la danse classique, jazz et contemporaine exigent le diplôme d'État. Si votre cours est présenté comme une activité de forme (fitness dansé, zumba), la carte professionnelle d'éducateur sportif peut être exigée." },
  // 09/11/2026 — garde d'enfants dès 3 ans, petits travaux, informatique.
  "Garde d'enfants de 3 ans et plus / Baby-sitting (chez les parents)": { texte: "Aucun diplôme n'est exigé pour garder un enfant de 3 ans ou plus chez ses parents. Pour un enfant de moins de 3 ans, l'agrément « services à la personne » est obligatoire : c'est l'autre métier, « Garde d'enfants de moins de 3 ans ». Garder un enfant chez vous est le métier d'assistante maternelle (agrément de la PMI) : il n'est pas proposé sur ALANE. Une assurance responsabilité civile professionnelle est vivement conseillée." },
  "Petits travaux de bricolage (montage de meubles, fixations)": { texte: "Aucun diplôme n'est exigé pour le petit bricolage. Sont exclus : l'électricité, la plomberie, le gaz, le chauffage et tous les travaux du bâtiment, qui demandent une qualification et une garantie décennale. Le crédit d'impôt des services à la personne ne vaut que pour des interventions de 2 heures au plus." },
  "Assistance informatique à domicile": { texte: "Aucun diplôme n'est exigé. N'accédez qu'aux données dont la prestation a besoin, et ne conservez rien après." },
  // Garde d'animaux (06/11/2026) : aucun titre pour garder ou promener chez le
  // propriétaire ; l'hébergement chez soi est réglementé et exclu.
  "Garde d'animaux / Promeneur de chiens (chez le propriétaire)": { texte: "Aucun diplôme n'est exigé pour garder ou promener un animal chez son propriétaire. Héberger l'animal chez vous est une autre activité, réglementée (déclaration en préfecture, certificat ACACED, locaux conformes) : elle n'est pas proposée sur ALANE. Le crédit d'impôt des services à la personne ne s'applique à la garde d'animaux que pour les personnes âgées ou dépendantes. Une assurance responsabilité civile professionnelle est vivement conseillée." },
  "Auxiliaire de vie":                    { texte: "L'intervention auprès de personnes vulnérables peut relever d'un agrément ou d'une autorisation départementale selon le public accompagné. À vérifier avant d'accepter ce type de prestation." },
};

/** Ce qu'il faut savoir sur ce métier, sans que ce soit exigible. */
export function noteMetier(metier) {
  return NOTES_METIERS[metier]?.texte || null;
}


// ═══════════════════════════════════════════════════════════════════════════
// Le justificatif couvre-t-il CE métier ? (29/09/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le titre n'était exigé qu'à l'ouverture de l'accès aux prestations. Un
// prestataire déjà activé pouvait ensuite ajouter lui-même « Agent de
// sécurité » à ses métiers et être proposé, sans jamais avoir produit de carte
// CNAPS. Décision d'Alexandre : ne pas bloquer le compte, mais imposer le
// justificatif du métier ajouté. Ses autres métiers restent ouverts ; celui-là
// ne l'est qu'une fois son titre déposé ET vérifié.
//
// Un seul document « diplomes » par prestataire porte tous ses titres. Pour
// savoir s'il couvre le nouveau métier, `documents.titres_couverts` note, À LA
// VÉRIFICATION, les titres qu'il couvrait alors (verify_doc). Un titre ajouté
// ensuite n'y figure pas : le justificatif est à compléter, puis à revérifier.
//
// La règle lit `titres_couverts` seul, pas `verified`. Quand le prestataire
// remplace sa pièce pour y ajouter le nouveau titre, `verified` repasse à false
// (notify-doc) — mais les titres déjà constatés le restent : ses métiers
// validés ne se ferment pas pendant l'attente. Un refus supprime la ligne, et
// avec elle tous les titres. Seul verify_doc écrit cette colonne ; le
// navigateur n'a aucun droit d'écriture sur `documents`.

/** @param {{titres_couverts?:string[]|null}|null} justificatif  la ligne `documents` de type diplomes */
export function peutExercer(metier, justificatif) {
  const q = QUALIFICATIONS_OBLIGATOIRES[metier];
  if (!q) return true;
  return Array.isArray(justificatif?.titres_couverts) && justificatif.titres_couverts.includes(q.titre);
}

/** Les titres exigés par les métiers déclarés que le justificatif vérifié ne couvre pas. */
export function titresNonCouverts(metiers, justificatif) {
  return qualificationsPour(metiers).filter(q =>
    !(Array.isArray(justificatif?.titres_couverts) && justificatif.titres_couverts.includes(q.titre)));
}

/**
 * Les métiers déclarés par un prestataire : le principal ET la liste.
 *
 * `metiers_list` seul oubliait le métier principal quand il n'y était pas
 * repris (comptes anciens) : un agent de sécurité dont c'était le métier
 * principal voyait l'accès aux prestations s'ouvrir sans que sa carte
 * professionnelle soit contrôlée (relecture du 01/10/2026). Le catalogue, la
 * reprise et la validation des justificatifs regardent déjà cette union.
 *
 * @param {object} meta  user_metadata du prestataire
 */
export function metiersDeclares(meta) {
  return [meta?.metier, ...(Array.isArray(meta?.metiers_list) ? meta.metiers_list : [])].filter(Boolean);
}
