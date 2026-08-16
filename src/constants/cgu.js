// ═══════════════════════════════════════════════════════════════════════════
// Conditions Générales d'Utilisation — source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Même histoire que `cgps.js`, et découverte plus tard : les CGU existaient en
// DEUX exemplaires divergents. Un texte de sept sections dans `LegalScreen`
// (client-screens.jsx), et un résumé de six sections écrit en dur dans la
// fenêtre « CGU » de l'écran de choix de rôle (App.jsx) — celle-là même qui
// s'affiche derrière « En continuant, vous acceptez nos CGU ».
//
// Les deux étaient faux, et faux sur l'argent :
//
//   • « Les fonds sont libérés après validation mutuelle » — depuis août 2026
//     le virement part à l'expiration du délai de réclamation de 48 heures
//     (CGPS 7.2, `api/_temps.js` → `echeanceVersementMs`), sans validation ;
//   • « frais de service fixes : 4,90 € / 2,90 €/j / 9,90 € » — les frais
//     comportent depuis la même date une part proportionnelle de 2 %
//     (CGPS 6.2, `api/_montant.js` → `calculerFrais`).
//
// D'où ce fichier : un seul texte, importé par `LegalScreen` et par la fenêtre
// d'acceptation. On ne recopie plus.
//
// MODIFIER LES CGU
//
//   1. éditer CGU ci-dessous ;
//   2. mettre à jour `maj` s'il s'agit d'une évolution de fond.
//
// Les CGU régissent l'accès technique à la Plateforme. Elles occupent le
// dernier rang de la hiérarchie de l'article 1.1 des CGPS : en cas de
// contradiction, ce sont les CGPS qui s'appliquent. Toute règle de fond —
// argent, délais, annulation, responsabilité — s'écrit donc d'abord dans
// `cgps.js`, et n'est ici que rappelée.
// ═══════════════════════════════════════════════════════════════════════════

export const CGU = {
  title:"Conditions Générales d'Utilisation",
  maj:"16 août 2026",
  icon:"📋",
  sections:[
    {
      title:"1. Objet et articulation avec les CGPS",
      text:"Les présentes Conditions Générales d'Utilisation (« CGU ») régissent l'accès et l'utilisation de la plateforme ALANE, service de mise en relation entre des clients et des prestataires indépendants. En créant un compte, vous les acceptez.\n\nLes CGU portent sur l'usage technique de la Plateforme. Les droits et obligations attachés à une Prestation — prix, frais, paiement, annulation, réclamation, responsabilité — sont définis par les Conditions Générales de Prestation de Services (« CGPS »).\n\nConformément à l'article 1.1 des CGPS, en cas de contradiction entre les deux documents, les CGPS prévalent sur les présentes CGU. Les dispositions impératives protégeant le consommateur prévalent en toute hypothèse."
    },
    {
      title:"2. Inscription et compte",
      text:"L'inscription est gratuite et réservée aux personnes majeures ayant la capacité de contracter. Vous devez fournir des informations exactes et les tenir à jour.\n\nLes prestataires interviennent en qualité d'indépendants : ils doivent être immatriculés et en règle avec l'URSSAF, et déposer les documents demandés (SIRET, pièce d'identité, justificatif d'immatriculation, IBAN, attestation de responsabilité civile professionnelle).\n\nVous êtes responsable de la confidentialité de vos identifiants et des actions effectuées depuis votre compte. Toute restriction ou suspension d'un compte prestataire est notifiée et motivée dans les conditions de l'article 3 des CGPS."
    },
    {
      title:"3. Rôle d'ALANE",
      text:"ALANE agit exclusivement en qualité d'intermédiaire de mise en relation et n'est pas partie au contrat de prestation conclu entre le client et le prestataire. L'exécution de la Prestation, sa qualité et sa conformité relèvent du prestataire, qui l'accomplit sous sa propre responsabilité professionnelle et avec ses propres assurances.\n\nALANE ne dirige pas le travail du prestataire, ne fixe pas ses tarifs et ne lui impose ni horaires ni méthodes."
    },
    {
      title:"4. Prix, frais de service et paiement",
      text:"Le tarif de la Prestation est fixé par le prestataire. ALANE ne prélève aucune commission sur ce tarif : elle se rémunère par les abonnements et par des frais de service, à la charge du client et ajoutés au prix lors du paiement.\n\nLes frais de service se composent d'une part fixe et d'une part proportionnelle au prix de la Prestation (article 6.2 des CGPS) :\n• Prestation ponctuelle : 4,90 € + 2 % du prix\n• Prestation multi-jours : 2,90 € par jour + 2 % du prix\n• Prestation urgente (moins de 24h) : 9,90 € + 2 % du prix\n\nLa part proportionnelle couvre notamment les frais du prestataire de services de paiement, eux-mêmes proportionnels au montant encaissé. Aucun autre frais ne s'ajoute : le montant exact est affiché avant tout paiement, sur le récapitulatif de commande.\n\nLes paiements sont traités et sécurisés par Stripe. Les fonds destinés au prestataire ne deviennent à aucun moment la propriété d'ALANE : ils sont détenus par Stripe et reversés au prestataire à l'expiration du délai de réclamation de 48 heures courant depuis la fin de la Prestation, sous réserve qu'aucune réclamation ni retenue ne soit en cours (articles 7.2 et 7.4 des CGPS). Aucune validation du client n'est nécessaire pour déclencher ce versement.\n\nTout paiement en dehors de la Plateforme est interdit et prive les parties des garanties associées."
    },
    {
      title:"5. Annulations",
      text:"En cas d'annulation par le client, les frais de service restent dus : ils couvrent des coûts déjà engagés. Le montant de la Prestation est remboursé, dans les conditions et les limites de l'article 8 des CGPS — notamment la facturation des heures entamées lorsque l'exécution a commencé.\n\nEn cas d'annulation par le prestataire, le client est informé immédiatement, un remplacement lui est proposé, et il est intégralement remboursé — frais de service compris — si aucun remplaçant n'intervient."
    },
    {
      title:"6. Droit de rétractation",
      text:"Lorsque le client a la qualité de consommateur, il dispose d'un délai de quatorze jours pour se rétracter d'une commande conclue à distance (article L.221-18 du Code de la consommation).\n\nLorsque la Prestation doit commencer avant l'expiration de ce délai, son exécution suppose une demande expresse du client et sa renonciation au droit de rétractation pour la part exécutée. Cette demande et cette renonciation sont recueillies au moment du paiement, et leur date est conservée. Les modalités complètes, ainsi que le formulaire type de rétractation, figurent aux articles 8.3 et 8.4 des CGPS."
    },
    {
      title:"7. Comportement et contenus",
      text:"Vous vous engagez à utiliser la Plateforme de bonne foi : pas de fausse déclaration, pas d'usurpation d'identité, pas de contournement des mécanismes de paiement, pas de contenu illicite, injurieux ou discriminatoire dans la messagerie et les avis.\n\nLes avis publiés doivent correspondre à une Prestation réellement commandée. Les critères de classement des prestataires dans les résultats de recherche sont publiés sur la Plateforme.\n\nALANE peut retirer un contenu manifestement illicite et restreindre l'accès au service en cas de manquement, dans les conditions de l'article 16 des CGPS."
    },
    {
      title:"8. Réclamations et litiges",
      text:"Toute réclamation portant sur une Prestation se signale depuis l'historique des prestations, dans les 48 heures suivant sa fin. ALANE recueille les observations des deux parties et formule une proposition de résolution sous 72 heures ouvrées.\n\nCette procédure est interne : ALANE est partie à la relation et n'est pas un tiers indépendant. La proposition n'a aucun caractère contraignant. Le recours à un médiateur de la consommation, à la plateforme européenne de règlement en ligne des litiges et à la juridiction compétente reste ouvert à tout moment — voir les mentions légales.\n\nLe consommateur peut saisir la juridiction de son domicile."
    },
    {
      title:"9. Données personnelles",
      text:"Vos données sont traitées conformément au RGPD. Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, de portabilité et d'opposition, exerçables à rgpd@alane.fr, ainsi que du droit d'introduire une réclamation auprès de la CNIL.\n\nLe détail des traitements, des destinataires et des durées de conservation figure dans la Politique de confidentialité et à l'article 14 des CGPS."
    },
    {
      title:"10. Modification des CGU",
      text:"Les présentes CGU peuvent être modifiées. Toute modification substantielle est notifiée par email avec un préavis d'au moins 30 jours, et la date de mise à jour est indiquée en tête du document. La poursuite de l'utilisation de la Plateforme après l'entrée en vigueur vaut acceptation ; à défaut, vous pouvez clôturer votre compte sans frais."
    },
  ]
};
