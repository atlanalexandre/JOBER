// ═══════════════════════════════════════════════════════════════════════════
// Vigilance sur la dépendance économique et l'intégration durable
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Un conseil juridique a relevé que le risque résiduel d'ALANE ne tient plus à
// la rédaction des CGPS mais aux comportements réels. Le cas qui inquiète :
//
//     un auto-entrepreneur qui travaille cinq jours par semaine, pendant
//     plusieurs mois, pour un seul et même client.
//
// Ce schéma ne devient pas illicite à un seuil précis — aucun texte n'en fixe.
// Mais il est le premier motif de requalification devant l'URSSAF et les
// prud'hommes, parce qu'il réunit les deux indices les plus lourds : la
// dépendance économique et l'intégration durable dans une organisation.
//
// L'article 10D des CGPS réserve à ALANE le droit de demander des justificatifs
// dans cette situation. Ce module la détecte — sans quoi la clause serait un
// droit écrit et jamais exercé, exactement le défaut qu'on vient de corriger sur
// le droit de remplacement.
//
// CE QUE CE MODULE N'EST PAS
//
// Ni un verdict, ni une sanction. Il produit une liste de couples
// (client, prestataire) à regarder, avec les chiffres qui ont déclenché
// l'alerte. La décision reste humaine, et l'article 10D ne prévoit qu'une
// demande d'explications.
// ═══════════════════════════════════════════════════════════════════════════

// Seuils par défaut, surchargeables par platform_settings.seuils_dependance.
//
// Ils sont volontairement placés au niveau où un inspecteur commencerait à
// poser des questions, pas au niveau où la situation devient indéfendable :
// l'objet est de déclencher une vérification tôt, pas de constater trop tard.
export const SEUILS_PAR_DEFAUT = {
  // Part du chiffre d'affaires du prestataire réalisée avec un seul client.
  // C'est l'indice de dépendance économique le plus regardé.
  part_ca_pct: 60,

  // En deçà, la part de chiffre d'affaires n'a pas de sens statistique :
  // un prestataire qui débute a mécaniquement 100 % avec son premier client.
  min_prestations_client: 8,

  // Régularité : jours distincts travaillés pour ce client, et étalement.
  // Cinq jours par semaine pendant deux mois, c'est l'ordre de grandeur visé.
  min_jours_distincts: 24,
  min_semaines_ecart: 8,

  // Fenêtre d'observation, en jours.
  fenetre_jours: 180,
};

/** Nombre de semaines entre la première et la dernière prestation. */
export function etalementSemaines(dates) {
  const valides = dates.map(d => new Date(d).getTime()).filter(t => !isNaN(t));
  if (valides.length < 2) return 0;
  return Math.round((Math.max(...valides) - Math.min(...valides)) / (7 * 86400000));
}

/**
 * Analyse les prestations d'un prestataire et rend les couples à examiner.
 *
 * @param {Array<{client_id:string, prestataire_id:string, date:string, montant:number}>} prestations
 *        Prestations réellement exécutées, déjà restreintes à la fenêtre d'observation.
 * @param {object} seuils
 * @returns {Array<object>} un élément par couple (prestataire, client) dépassant un seuil
 *
 * On raisonne par prestataire : c'est lui dont l'indépendance est en cause, et
 * c'est son chiffre d'affaires qui sert de dénominateur. Un client qui commande
 * beaucoup à beaucoup de professionnels différents ne pose pas ce problème.
 */
export function couplesADependance(prestations, seuils = SEUILS_PAR_DEFAUT) {
  const s = { ...SEUILS_PAR_DEFAUT, ...(seuils || {}) };
  const valides = (Array.isArray(prestations) ? prestations : [])
    .filter(p => p && p.prestataire_id && p.client_id);

  // Chiffre d'affaires total par prestataire — le dénominateur.
  const totalParPresta = {};
  for (const p of valides) {
    totalParPresta[p.prestataire_id] = (totalParPresta[p.prestataire_id] || 0) + (Number(p.montant) || 0);
  }

  // Regroupement par couple.
  const couples = {};
  for (const p of valides) {
    const cle = `${p.prestataire_id}|${p.client_id}`;
    if (!couples[cle]) {
      couples[cle] = {
        prestataire_id: p.prestataire_id,
        client_id: p.client_id,
        prestations: 0,
        montant: 0,
        jours: new Set(),
        dates: [],
      };
    }
    const c = couples[cle];
    c.prestations += 1;
    c.montant += Number(p.montant) || 0;
    if (p.date) { c.jours.add(String(p.date).slice(0, 10)); c.dates.push(p.date); }
  }

  const signaux = [];
  for (const c of Object.values(couples)) {
    if (c.prestations < s.min_prestations_client) continue;

    const totalPresta = totalParPresta[c.prestataire_id] || 0;
    const partCa = totalPresta > 0 ? Math.round((c.montant / totalPresta) * 1000) / 10 : 0;
    const joursDistincts = c.jours.size;
    const semaines = etalementSemaines(c.dates);

    const motifs = [];
    if (partCa >= s.part_ca_pct) motifs.push("part_ca");
    // La régularité ne compte que si elle s'inscrit dans la durée : vingt-quatre
    // jours en trois semaines, c'est un chantier ; en trois mois, c'est un poste.
    if (joursDistincts >= s.min_jours_distincts && semaines >= s.min_semaines_ecart) motifs.push("regularite");
    if (!motifs.length) continue;

    signaux.push({
      prestataire_id: c.prestataire_id,
      client_id: c.client_id,
      prestations: c.prestations,
      jours_distincts: joursDistincts,
      semaines_ecart: semaines,
      montant: Math.round(c.montant * 100) / 100,
      montant_total_prestataire: Math.round(totalPresta * 100) / 100,
      part_ca_pct: partCa,
      motifs,
      // Ordre de lecture : d'abord ceux qui cumulent les deux indices.
      gravite: motifs.length * 100 + Math.min(partCa, 100),
    });
  }

  signaux.sort((a, b) => b.gravite - a.gravite);
  return signaux;
}
