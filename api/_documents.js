import { qualificationsPour } from "./_qualifications.js";

// ═══════════════════════════════════════════════════════════════════════════
// Les pièces d'un dossier : combien de temps elles valent, et où les vérifier
// ═══════════════════════════════════════════════════════════════════════════
//
// DEUX MANQUES, LE MÊME JOUR (11/09/2026)
//
// 1. LA PÉREMPTION. Une attestation URSSAF vaut six mois. Une RC Pro s'arrête
//    à une date. Une carte CNAPS dure cinq ans. Rien ne surveillait ces dates :
//    un prestataire validé en janvier avec une assurance expirant en mars
//    restait actif indéfiniment. C'était le risque le plus concret de la
//    plateforme — mettre en relation un client avec quelqu'un qui n'est plus
//    assuré.
//
// 2. LA VÉRIFICATION. Le back-office ouvrait le PDF et le regardait. Or trois
//    services OFFICIELS et GRATUITS permettent de vérifier vraiment : le code
//    de sécurité d'une attestation URSSAF, la validité d'une carte
//    professionnelle CNAPS, et le QR code des diplômes de l'Éducation
//    nationale. Personne ne s'en servait, faute de savoir qu'ils existaient.
//
// Ces deux manques sont exactement ce que vendent les plateformes de
// conformité — pour un abonnement calibré sur de grands donneurs d'ordre. Ils
// se comblent ici avec une colonne et trois liens.
// ═══════════════════════════════════════════════════════════════════════════

export const DOCS_REQUIS = [
  // C'est la SEULE pièce que le client verra. L'intitulé dit donc à quoi elle
  // sert : un prestataire qui croit remplir une formalité envoie une vignette
  // de profil, celui qui sait que son client la regardera sur son palier
  // envoie une photo exploitable.
  { id:"photo",    label:"Photo de profil",            icon:"📸", required:true,  info:"Visage de face, bien éclairé, fond neutre, sans lunettes de soleil ni couvre-chef. Au moins 400×400 pixels. C'est cette photo que vos clients verront pour vous reconnaître à leur porte — elle est comparée à votre pièce d'identité." },
  { id:"kbis",     label:"Extrait KBIS / INSEE",       icon:"🏢", required:true,  info:"Attestation existence légale de votre auto-entreprise" },
  { id:"urssaf",   label:"Attestation URSSAF",         icon:"📋", required:true,  info:"Prouve que vous êtes à jour de vos cotisations" },
  { id:"cni",      label:"Pièce d'identité",           icon:"🪪", required:true,  info:"CNI ou passeport en cours de validité" },
  { id:"domicile", label:"Justificatif de domicile",   icon:"🏠", required:true,  info:"Facture EDF ou quittance de loyer -3 mois" },
  { id:"rib",      label:"RIB / IBAN",                 icon:"🏦", required:true,  info:"Pour le virement de vos paiements" },
  { id:"rc_pro",   label:"Attestation RC Pro",         icon:"🛡️", required:true,  info:"Assurance RC Professionnelle en cours de validité (obligatoire)" },
  { id:"diplomes", label:"Diplômes & Certifications",  icon:"🎓", required:false, info:"CACES, habilitations, diplômes pro…" },
  // Exigé des seuls ressortissants hors Union européenne. Un indépendant
  // étranger doit disposer d'un titre l'autorisant à exercer une activité NON
  // SALARIÉE en France : la nationalité était déclarée à l'inscription, aucun
  // justificatif n'était demandé. Voir `docsRequisPour()`.
  { id:"titre_sejour", label:"Titre de séjour",         icon:"🛂", required:false, info:"Autorisant l'exercice d'une activité non salariée en France (hors UE uniquement)" },
];

// Documents exigés d'un prestataire donné.
//
// La liste n'est pas la même pour tout le monde : le titre de séjour ne concerne
// que les ressortissants hors UE. L'afficher à tous ferait renoncer des candidats
// français qui n'ont rien à fournir ; ne l'exiger de personne laisse ALANE mettre
// en relation des professionnels sans droit d'exercer.
export function docsRequisPour(nationalite, metiers) {
  const horsUE = String(nationalite || "").toLowerCase().includes("hors");

  // Le document « Diplômes & certifications » devient OBLIGATOIRE dès qu'un
  // métier déclaré suppose un titre, et son intitulé nomme alors ce qui est
  // attendu. « Fournissez un diplôme » fait envoyer n'importe quoi ;
  // « Fournissez votre carte professionnelle CNAPS » fait envoyer la carte.
  const qualifications = qualificationsPour(metiers);

  return DOCS_REQUIS
    .filter(d => d.id !== "titre_sejour" || horsUE)
    .map(d => {
      if (d.id === "titre_sejour") return { ...d, required: true };
      if (d.id === "diplomes" && qualifications.length > 0) {
        return {
          ...d,
          required: true,
          label: qualifications.length === 1 ? qualifications[0].titre : "Titres professionnels",
          // Quand le libellé porte déjà le titre, l'information ne le répète
          // pas : « Carte professionnelle CNAPS — Carte professionnelle CNAPS
          // — exigé pour… » se lit mal et donne l'air d'un texte engendré.
          info: qualifications.length === 1
            ? `${qualifications[0].detail ? `${qualifications[0].detail}. ` : ""}`
              + `Exigé pour « ${qualifications[0].metiers.join(" », « ")} » (${qualifications[0].texte}).`
            : qualifications
                .map(q => `${q.titre} — exigé pour « ${q.metiers.join(" », « ")} » (${q.texte})`)
                .join("\n"),
        };
      }
      return d;
    });
}

/**
 * Durée de validité par type de document, en MOIS.
 *
 * `null` = ne périme pas (un RIB, une photo).
 * `0`    = la date doit être saisie à la main : elle est portée par le document
 *          lui-même et ne se déduit pas de sa date de dépôt.
 *
 * La distinction compte. Une attestation URSSAF vaut six mois À COMPTER DE SON
 * ÉMISSION, qu'on peut donc calculer. Une RC Pro couvre une période écrite sur
 * l'attestation, qui n'a aucun rapport avec le jour du dépôt : la déduire
 * donnerait une fausse date, et une fausse date rassure à tort.
 */
export const VALIDITE_DOCUMENTS = {
  photo:        { mois: null },
  kbis:         { mois: 3,
                  note: "Un KBIS de plus de trois mois n'est plus accepté par la plupart des donneurs d'ordre." },
  urssaf:       { mois: 6,
                  note: "Validité légale de six mois. Au-delà, elle ne prouve plus rien." },
  cni:          { mois: 0,
                  note: "Saisir la date de fin de validité portée sur la pièce." },
  domicile:     { mois: 3 },
  rib:          { mois: null },
  rc_pro:       { mois: 0,
                  note: "Saisir la date de fin de la période de garantie écrite sur l'attestation — elle n'a aucun rapport avec la date de dépôt." },
  diplomes:     { mois: 0,
                  note: "Un diplôme ne périme pas, mais une carte professionnelle ou un recyclage, si. Laisser vide pour un diplôme, saisir la date pour une carte." },
  titre_sejour: { mois: 0,
                  note: "Saisir la date de fin de validité portée sur le titre." },
};

/**
 * Les documents dont l'expiration retire l'accès aux prestations.
 *
 * Tous ne se valent pas. Une RC Pro périmée, c'est un client mis en relation
 * avec quelqu'un qui n'est plus assuré — on arrête. Un justificatif de domicile
 * de quatre mois ne met personne en danger : on relance, on n'exclut pas.
 *
 * Suspendre pour un motif disproportionné pousse à désactiver la règle entière,
 * et c'est alors la RC Pro qui n'est plus surveillée.
 */
export const EXPIRATION_BLOQUANTE = new Set(["urssaf", "rc_pro", "cni", "titre_sejour", "diplomes"]);

/**
 * Les services OFFICIELS et GRATUITS de vérification.
 *
 * Aucune plateforme payante ne fait mieux : la plupart se contentent d'appeler
 * ces mêmes services. Les liens pointent vers les sites officiels, jamais vers
 * un intermédiaire — et surtout jamais vers un lien fourni par le prestataire
 * lui-même, qui est le vecteur classique de la fausse attestation.
 */
export const VERIFICATIONS_OFFICIELLES = {
  urssaf: {
    nom: "Vérifier le code de sécurité",
    url: "https://www.urssaf.fr/accueil/attestation-vigilance.html",
    mode: "Chaque attestation porte un code de sécurité. Saisissez-le : le service répond « valide », « expirée » ou « non trouvée ». C'est le seul moyen de distinguer une vraie attestation d'une reconstitution graphique.",
  },
  kbis: {
    nom: "Consulter l'entreprise",
    url: "https://annuaire-entreprises.data.gouv.fr/",
    mode: "Le SIRET est déjà contrôlé automatiquement à l'inscription. Ce lien sert à vérifier l'activité déclarée et l'absence de radiation.",
  },
  diplomes: {
    nom: "Vérifier un diplôme (QR code)",
    url: "https://siec.education.fr/candidats/demarches/nouveau/verification-diplome",
    mode: "Depuis 2025, les diplômes de l'Éducation nationale — CAP, BTS, bac, examens professionnels — portent un QR code. L'application CycladesVerif en confirme l'authenticité en quelques secondes.",
  },
};

/**
 * Le service de vérification d'un document, éventuellement précisé par le
 * métier : une carte CNAPS ne se vérifie pas au même endroit qu'un CAP.
 */
export function verificationPour(type, qualification) {
  if (type === "diplomes" && qualification && /CNAPS|SSIAP/.test(qualification.titre || "")) {
    return {
      nom: "Vérifier la carte CNAPS",
      url: "https://www.justice.fr/fiche/teleservices-cnaps-verification-validite-carte-professionnelle-agents-securite",
      mode: "Le téléservice du CNAPS dit si la carte professionnelle est toujours active. Exercer sans carte valide est un délit : cette vérification n'est pas une formalité.",
    };
  }
  return VERIFICATIONS_OFFICIELLES[type] || null;
}

/**
 * Date d'expiration déduite de la date de dépôt, quand elle se déduit.
 * Renvoie null quand la date doit être saisie à la main, ou que le document ne
 * périme pas.
 */
export function expirationDeduite(type, deposeLe) {
  const regle = VALIDITE_DOCUMENTS[type];
  if (!regle || !regle.mois) return null;
  const base = deposeLe ? new Date(deposeLe) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  const d = new Date(base);
  d.setMonth(d.getMonth() + regle.mois);
  return d.toISOString().slice(0, 10);
}

/**
 * Tolérance après expiration, en jours, avant de retirer l'accès.
 *
 * Trente jours pour la RC Pro : c'est l'article 19.1 des CGPS, et c'est ce que
 * le traitement appliquait déjà avant que cette surveillance soit étendue aux
 * autres pièces. On ne change pas une règle annoncée aux prestataires.
 *
 * Trente jours pour les autres aussi, par cohérence : un délai plus court
 * suspendrait quelqu'un avant qu'il ait pu recevoir la relance et réagir. Une
 * suspension qui tombe sans préavis se solde par un départ, pas par un
 * renouvellement.
 */
export const TOLERANCE_JOURS = 30;

/** Préavis avant échéance, en jours : à partir de quand on prévient. */
export const PREAVIS_JOURS = 30;

/**
 * Où en est ce document ? `null` s'il ne périme pas ou si la date est inconnue.
 *
 * Les quatre états reprennent exactement ceux de `etatRcPro` — c'est le même
 * cycle, généralisé : valide → bientôt → expirée → suspendable.
 *
 * @returns {{etat:"valide"|"bientot"|"expire"|"suspendable", jours:number}|null}
 */
/** Le libellé d'un type de pièce — une seule source, `DOCS_REQUIS`. */
export function libelleDoc(type) {
  return DOCS_REQUIS.find(d => d.id === type)?.label || type;
}

export function etatExpiration(expiresAt, maintenant = Date.now()) {
  if (!expiresAt) return null;
  const fin = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59Z`).getTime();
  if (!Number.isFinite(fin)) return null;
  const jours = Math.floor((fin - maintenant) / 86400000);
  if (maintenant > fin + TOLERANCE_JOURS * 86400000) return { etat: "suspendable", jours };
  if (maintenant > fin) return { etat: "expire", jours };
  if (jours <= PREAVIS_JOURS) return { etat: "bientot", jours };
  return { etat: "valide", jours };
}
