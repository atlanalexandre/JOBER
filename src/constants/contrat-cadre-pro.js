// Contrat-cadre Client Professionnel — document distinct des CGPS.
//
// Les CGPS sont acceptées par tous. Elles ne peuvent pas porter les engagements
// propres au client professionnel qui fait intervenir un prestataire chez son propre
// client : garantie de vendre un résultat, conservation de la direction du travail,
// coopération aux audits, indemnisation. C'est l'objet de ce document.
//
// La version est inscrite dans l'acceptation stockée en base. Toute modification de
// fond doit incrémenter VERSION_CONTRAT_CADRE : les clients devront réaccepter, et on
// saura toujours quelle rédaction liait un client à la date d'une prestation.
export const VERSION_CONTRAT_CADRE = "1.0";

export const CONTRAT_CADRE_PRO = [
  {
    titre: "Article 1 — Objet et champ d'application",
    texte: "Le présent contrat-cadre régit les conditions dans lesquelles un Client professionnel peut, via la Plateforme ALANE, faire exécuter une Prestation au bénéfice, pour le compte ou dans les locaux d'un tiers, dénommé le Bénéficiaire final.\n\nIl complète les Conditions Générales de Prestation de Services, notamment leurs articles 5.2 et 10B, sans s'y substituer. En cas de contradiction, la stipulation la plus protectrice du Prestataire prévaut.\n\nSon acceptation est un préalable obligatoire à toute réservation déclarée comme exécutée au bénéfice d'un tiers.",
  },
  {
    titre: "Article 2 — Déclaration de vente d'une prestation de résultat",
    texte: "Le Client déclare et garantit qu'il commercialise auprès du Bénéficiaire final un service identifié par son objet, son périmètre et son résultat attendu.\n\nIl reconnaît que cette qualification ne dépend ni de la dénomination retenue dans ses propres contrats, ni du mode de calcul de son prix, mais des conditions réelles d'exécution.\n\nLe recours à une base horaire pour déterminer le prix n'est pas en soi prohibé, dès lors que l'objet du contrat conclu avec le Bénéficiaire final demeure un service déterminé et non la mise à disposition d'une personne.",
  },
  {
    titre: "Article 3 — Interdiction de la fourniture de personnel",
    texte: "Le Client s'interdit d'utiliser la Plateforme pour fournir au Bénéficiaire final un volume d'heures de travail, ou la présence d'un intervenant, indépendamment de tout résultat déterminé.\n\nIl s'interdit de céder, revendre ou refacturer la seule capacité de travail d'un Prestataire.\n\nIl reconnaît que la Plateforme n'est ni une entreprise de travail temporaire au sens des articles L.1251-1 et suivants du Code du travail, ni une entreprise de mise à disposition de personnel au sens de l'article L.8241-1, et s'interdit tout usage qui conduirait à le lui faire exercer de fait.",
  },
  {
    titre: "Article 4 — Maintien du pouvoir d'organisation",
    texte: "Le Client garantit conserver la maîtrise organisationnelle de la prestation vendue au Bénéficiaire final.\n\nIl garantit qu'aucun Bénéficiaire final n'exerce directement sur le Prestataire un pouvoir de direction, de contrôle ou de sanction, notamment en lui attribuant ses tâches au quotidien, en fixant son rythme de travail, en lui adressant des consignes opérationnelles, en contrôlant sa ponctualité ou en traitant ses absences.\n\nLe Client s'engage à informer immédiatement ALANE de toute évolution de son organisation susceptible d'affecter ces garanties.",
  },
  {
    titre: "Article 5 — Déclaration du Bénéficiaire final",
    texte: "Pour chaque Prestation exécutée au bénéfice d'un tiers, le Client déclare sur la Plateforme, avant confirmation de la commande : l'identité du Bénéficiaire final, le lieu réel d'intervention, la nature du service qu'il lui a vendu, le périmètre et les critères de qualité retenus, le livrable attendu du Prestataire, ainsi que l'identité et la qualité de la personne qui organise le travail sur place.\n\nToute déclaration inexacte ou incomplète constitue un manquement grave au présent contrat.",
  },
  {
    titre: "Article 6 — Audit et communication de documents",
    texte: "Le Client s'engage à communiquer à ALANE, sur simple demande et dans un délai de quinze jours : le contrat conclu avec le Bénéficiaire final, le cahier des charges, les bons de commande, les instructions opérationnelles remises au Bénéficiaire final, et tout document permettant d'apprécier la nature exacte du service vendu.\n\nALANE ne conserve ces documents que le temps nécessaire à la vérification et au traitement d'une éventuelle procédure, et n'en fait aucun autre usage.\n\nLe refus de communication, ou la communication incomplète d'informations essentielles, autorise la suspension immédiate des services.",
  },
  {
    titre: "Article 7 — Garantie et indemnisation",
    texte: "Le Client est seul responsable des conséquences résultant d'informations inexactes, de la dissimulation d'un Bénéficiaire final, d'une organisation plaçant le Prestataire sous l'autorité du Bénéficiaire final, ou de tout usage de la Plateforme contraire au présent contrat ou aux CGPS.\n\nIl indemnisera ALANE de l'ensemble des préjudices directs en résultant, incluant les frais de défense, les condamnations civiles, les frais de procédure et les frais d'expertise.\n\nLa présente clause ne s'applique pas aux sanctions pénales, lesquelles demeurent personnelles à leur auteur et ne peuvent faire l'objet d'aucune garantie.",
  },
  {
    titre: "Article 8 — Suspension, résiliation et conservation des preuves",
    texte: "En présence d'indices sérieux d'un prêt illicite de main-d'œuvre, d'une opération de marchandage, d'une situation de faux travail indépendant ou de travail dissimulé, ALANE peut demander des explications, exiger des justificatifs, suspendre les mises en relation, refuser de nouvelles réservations, puis résilier l'accès du Client.\n\nCes mesures sont proportionnées, notifiées et motivées. Le Client dispose de quinze jours pour présenter ses observations, sauf urgence caractérisée.\n\nChaque Partie conserve pendant cinq ans les déclarations, échanges et documents relatifs aux Prestations exécutées au bénéfice d'un tiers, afin de pouvoir justifier des conditions réelles d'exécution.",
  },
];
