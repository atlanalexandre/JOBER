// ═══════════════════════════════════════════════════════════════════════════
// L'identité de l'éditeur — une seule source
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// L'article 6-III de la loi pour la confiance dans l'économie numérique impose
// à tout éditeur de service en ligne de se faire connaître : dénomination,
// forme, capital, siège, immatriculation, directeur de la publication. Ces
// mêmes données doivent aussi figurer sur les factures (art. 242 nonies A ann.
// II du CGI), dans les CGPS et dans les CGU.
//
// Recopiées d'un écran à l'autre, elles auraient divergé — c'est exactement ce
// qui est arrivé aux CGPS, présentées à l'inscription en quatre versions dont
// deux fausses sur l'argent. L'identité de l'éditeur vit donc ICI, et nulle
// part ailleurs.
//
// ÉTAT AU 07/09/2026 : la société n'est pas immatriculée. Le drapeau
// `IMMATRICULEE` vaut donc `false`, et les écrans affichent une mention
// d'attente explicite au lieu de champs vides ou de marqueurs « [À REMPLIR] »
// — un utilisateur qui lit « [À REMPLIR] » sur une plateforme qui encaisse son
// argent en tire, à juste titre, une conclusion sévère.
//
// LE JOUR DE L'IMMATRICULATION : remplir les champs ci-dessous depuis l'extrait
// Kbis, passer `IMMATRICULEE` à `true`, porter la date dans `MAJ_MENTIONS`.
// Rien d'autre à modifier dans les écrans. Voir IMMATRICULATION.md pour les
// points qui ne se trouvent pas dans ce fichier (médiateur, TVA, Stripe).
// ═══════════════════════════════════════════════════════════════════════════

/** La société est-elle immatriculée ? Tant que non, les écrans le disent. */
export const IMMATRICULEE = false;

/** Date de dernière mise à jour des mentions légales, affichée à l'utilisateur. */
export const MAJ_MENTIONS = "7 septembre 2026";

/**
 * L'éditeur, tel qu'il figure sur l'extrait d'immatriculation. Tous les champs
 * restent vides tant que `IMMATRICULEE` vaut `false` : une valeur inventée,
 * même provisoire, finit toujours par être publiée.
 */
export const EDITEUR = {
  denomination:  "",   // ex. « ALANE »
  formeJuridique:"",   // ex. « SAS »
  capital:       "",   // ex. « 1 000 € »
  siren:         "",   // 9 chiffres
  siret:         "",   // 14 chiffres, siège
  rcs:           "",   // ex. « 000 000 000 R.C.S. Paris »
  ape:           "",   // ex. « 78.10Z »
  tvaIntra:      "",   // ex. « FR00000000000 »
  siege:         "",   // adresse postale complète
  directeurPublication: "",
  responsableTraitement: "",
  dpo:           "",   // « non désigné » si aucun n'est requis
};

/** Le contact permanent, lui, existe et ne dépend d'aucune immatriculation. */
export const CONTACT = {
  email:    "direction@alane.fr",
  rgpd:     "rgpd@alane.fr",
  site:     "https://www.alane.fr",
};

/**
 * Les hébergeurs, également imposés par l'article 6-III. Ils sont connus et
 * n'attendent rien : ils sont affichés en toutes circonstances.
 */
export const HEBERGEURS = [
  { role: "Hébergeur du site",  nom: "Vercel Inc.",   adresse: "340 Pine Street, Suite 200, San Francisco, CA 94104, États-Unis", site: "https://vercel.com" },
  { role: "Base de données",    nom: "Supabase Inc.", adresse: "970 Toa Payoh N, Singapour", site: "https://supabase.com" },
];

/**
 * Le bloc « Éditeur du site » des mentions légales, rendu en texte.
 *
 * Deux états, et deux seulement. Il n'y a pas d'état intermédiaire où l'on
 * afficherait la moitié des champs : une identification partielle ne vaut pas
 * mieux qu'une absence, et elle a l'inconvénient d'avoir l'air complète.
 */
export function blocEditeur() {
  if (!IMMATRICULEE) {
    return "La société éditrice de la plateforme ALANE est en cours de constitution. "
      + "Ses mentions d'identification — dénomination sociale, forme juridique, capital, "
      + "numéro d'immatriculation, siège social et directeur de la publication — seront "
      + "publiées ici dès son immatriculation au registre du commerce et des sociétés, "
      + "conformément à l'article 6-III de la loi n° 2004-575 du 21 juin 2004.\n\n"
      + `Dans l'intervalle, l'éditeur est joignable à tout moment à l'adresse ${CONTACT.email}, `
      + "et répond de la plateforme et de son contenu.";
  }
  return [
    `Dénomination sociale : ${EDITEUR.denomination}`,
    `Forme juridique : ${EDITEUR.formeJuridique}`,
    `Capital social : ${EDITEUR.capital}`,
    `SIREN : ${EDITEUR.siren}`,
    `SIRET (siège) : ${EDITEUR.siret}`,
    `RCS : ${EDITEUR.rcs}`,
    `Code APE : ${EDITEUR.ape}`,
    EDITEUR.tvaIntra ? `TVA intracommunautaire : ${EDITEUR.tvaIntra}` : null,
    `Siège social : ${EDITEUR.siege}`,
    `Directeur de la publication : ${EDITEUR.directeurPublication}`,
    `Contact : ${CONTACT.email}`,
  ].filter(Boolean).join("\n");
}

/** Le bloc « Hébergement », toujours complet. */
export function blocHebergeurs() {
  return HEBERGEURS
    .map(h => `${h.role} : ${h.nom}\n${h.adresse}\n${h.site}`)
    .join("\n\n");
}

/** Le responsable de traitement RGPD, qui suit le même sort que l'éditeur. */
export function blocResponsableTraitement() {
  if (!IMMATRICULEE) {
    return `Responsable de traitement : la société éditrice en cours de constitution, `
      + `joignable à ${CONTACT.rgpd}.\n`
      + "Délégué à la protection des données : non désigné — la plateforme n'entre dans "
      + "aucun des cas où l'article 37 du RGPD l'impose.";
  }
  return `Responsable de traitement : ${EDITEUR.responsableTraitement || EDITEUR.denomination}\n`
    + `Délégué à la protection des données : ${EDITEUR.dpo || "non désigné"}\n`
    + `Contact : ${CONTACT.rgpd}`;
}
