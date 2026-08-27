// ═══════════════════════════════════════════════════════════════════════════
// Vérification du montant d'une prestation
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Une ligne `missions` est INSÉRÉE PAR LE NAVIGATEUR du client. Le déclencheur
// `missions_field_tamper_guard` ne couvre que les UPDATE, et
// `missions_creation_guard` ne pose qu'une BORNE BASSE : il refuse un
// `montant_total` inférieur à la part horaire, c'est-à-dire des frais de service
// négatifs. Rien n'empêche donc un client de créer sa prestation avec
//
//     montant_total = tarif_horaire × hours
//
// soit exactement zéro frais de service — l'intégralité de la rémunération
// d'ALANE sur cette réservation.
//
// Le tunnel carte l'a toujours refusé. Le paiement par portefeuille prépayé,
// lui, encaissait le montant tel quel : deux chemins d'encaissement, un seul
// contrôlé. D'où ce module, appelé par les deux.
//
// COMMENT
//
// On ne reproduit pas la grille tarifaire du tunnel de réservation — elle
// finirait par diverger. On vérifie la DÉCOMPOSITION : ce qui reste une fois la
// part horaire retirée doit être l'un des frais de service légitimes. Toute
// autre valeur signifie que le total a été fabriqué.
// ═══════════════════════════════════════════════════════════════════════════

// Repli utilisé si `platform_settings.frais_service` est illisible. Les mêmes
// valeurs que le tunnel de réservation.
export const FRAIS_PAR_DEFAUT = {
  single: 4.90,   // part fixe, prestation ponctuelle
  range:  2.90,   // part fixe, PAR JOUR, prestation multi-dates
  urgent: 9.90,   // part fixe, prestation urgente
  // Part variable, en pourcentage du prix de la prestation.
  //
  // Elle couvre les frais du prestataire de services de paiement, qui sont
  // proportionnels au montant encaissé. Sans elle, une part fixe seule suffit
  // sur une petite prestation et devient déficitaire au-delà de quelques
  // centaines d'euros : sur une prestation à 1 000 €, Stripe prélève plus que
  // la totalité des frais fixes.
  //
  // Modifiable depuis platform_settings.frais_service, sans redéploiement,
  // pour suivre le barème réel constaté sur les relevés.
  pourcentage: 2,

  // Plancher des frais de service sur une PROLONGATION uniquement.
  //
  // Une prolongation ne rappelle pas la part fixe — la mise en relation est
  // déjà payée — et ne laisse donc que les 2 %. Sur une prolongation d'une
  // heure à 17 €, cela fait 0,34 € encaissés, quand Stripe prélève environ
  // 1,5 % + 0,25 € de commission fixe, soit 0,51 € : chaque petite
  // prolongation coûtait de l'argent à ALANE. Le point de bascule se situait
  // autour de 50 €.
  //
  // La commission fixe de Stripe étant la même sur 17 € que sur 1 000 €, c'est
  // un plancher qu'il faut, pas un taux plus élevé. Au-delà de 45 €, les 2 %
  // repassent devant et le plancher ne joue plus.
  //
  // Modifiable depuis platform_settings.frais_service, sans redéploiement.
  minimum_prolongation: 0.90,
};

/**
 * Lit le barème des frais de service, avec repli sur les valeurs par défaut.
 * Ne lève jamais : un réglage illisible ne doit pas bloquer un encaissement.
 */
export async function lireFraisService(supabaseUrl, headers) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.frais_service&select=value`, { headers });
    const d = await r.json();
    if (Array.isArray(d) && d[0]?.value) return { ...FRAIS_PAR_DEFAUT, ...d[0].value };
  } catch (e) {
    console.error("[montant] frais_service illisible, valeurs par défaut :", e.message);
  }
  return { ...FRAIS_PAR_DEFAUT };
}

/**
 * Nombre de jours couverts par une prestation récurrente. 1 par défaut.
 */
export function nombreDeJours(mission) {
  if (!mission?.date_debut || !mission?.date_fin) return 1;
  const d = (new Date(mission.date_fin) - new Date(mission.date_debut)) / 86400000;
  if (!Number.isFinite(d)) return 1;
  return Math.max(1, Math.round(d) + 1);
}

/**
 * Frais de service dus pour une prestation.
 *
 * Une part fixe, qui dépend du type de prestation, plus une part variable
 * proportionnelle au prix. Le tout forme UNE SEULE ligne « Frais de service » :
 * le client n'a pas à connaître la répartition, et une ligne « frais bancaires »
 * séparée n'apporterait rien qu'une question de plus.
 *
 * Cette fonction est la SEULE source du calcul. Le tunnel de réservation et le
 * contrôle serveur l'appellent tous les deux — une grille recopiée des deux
 * côtés finit toujours par diverger, et c'est alors le client qui paie l'écart.
 *
 * @param {"single"|"range"|"urgent"} type
 * @param {number} prixPrestation  tarif × heures × jours, hors frais
 * @param {number} nbJours         pour la part fixe des prestations multi-dates
 * @param {object} frais           barème en vigueur
 */
export function calculerFrais(type, prixPrestation, nbJours = 1, frais = FRAIS_PAR_DEFAUT) {
  const b = { ...FRAIS_PAR_DEFAUT, ...(frais || {}) };
  const fixe = type === "urgent" ? Number(b.urgent) || 0
             : type === "range"  ? (Number(b.range) || 0) * Math.max(1, nbJours)
             : Number(b.single) || 0;
  const variable = Math.max(0, Number(prixPrestation) || 0) * (Number(b.pourcentage) || 0) / 100;
  return Math.round((fixe + variable) * 100) / 100;
}

/**
 * Le montant à encaisser est-il cohérent avec le tarif de la prestation ?
 *
 * @param {{tarif_horaire?:number, hours?:number, date_debut?:string, date_fin?:string}} mission
 * @param {number} total    montant que l'on s'apprête à encaisser
 * @param {{single:number, range:number, urgent:number}} frais barème en vigueur
 * @returns {{ok:boolean, partHoraire:number, nbJours:number, fraisConstates:number, fraisAdmis:number[]}}
 *
 * Une prestation sans part horaire (tarif ou durée à zéro) n'est pas
 * vérifiable par décomposition : on la laisse passer plutôt que de bloquer un
 * encaissement légitime sur un cas que la grille ne décrit pas.
 */
export function verifierMontant(mission, total, frais = FRAIS_PAR_DEFAUT) {
  const partHoraire = Number(mission?.tarif_horaire || 0) * Number(mission?.hours || 0);
  const nbJours = nombreDeJours(mission);

  if (!(partHoraire > 0)) {
    return { ok: true, partHoraire: 0, nbJours, fraisConstates: 0, fraisAdmis: [] };
  }

  // Les trois frais légitimes, part variable comprise. On ne devine pas le type
  // de la prestation : on accepte celui des trois qui correspond.
  const prixPrestation = partHoraire * nbJours;
  const fraisAdmis = ["single", "range", "urgent"]
    .map(t => calculerFrais(t, prixPrestation, nbJours, frais));
  const fraisConstates = Math.round((Number(total) - partHoraire * nbJours) * 100) / 100;

  // La comparaison se fait en centimes entiers. En euros flottants, un écart
  // d'exactement un centime valait 0.010000000000000231 et sortait de la
  // tolérance : un montant juste à un centime près était refusé, et le client
  // renvoyé refaire sa réservation sans comprendre pourquoi.
  const enCentimes = (x) => Math.round(x * 100);
  const constatesC = enCentimes(fraisConstates);
  const ok = fraisAdmis.some(f => Math.abs(enCentimes(f) - constatesC) <= 1);

  return { ok, partHoraire, nbJours, fraisConstates, fraisAdmis };
}

/** Message journalisé, identique quel que soit le moyen de paiement. */
export function messageIncoherence(missionId, total, v) {
  return `montant incohérent sur ${missionId} : total ${total} €, `
       + `part horaire ${v.partHoraire} € × ${v.nbJours} j, frais déduits ${v.fraisConstates} € — `
       + `attendus ${v.fraisAdmis.join(" / ")} €. Paiement refusé.`;
}

/** Message rendu à l'utilisateur. */
export const ERREUR_MONTANT =
  "Le montant de cette prestation ne correspond pas à son tarif. "
  + "Revenez à l'écran de réservation et recommencez.";
