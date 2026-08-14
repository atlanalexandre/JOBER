// ═══════════════════════════════════════════════════════════════════════════
// Compensation d'une créance sur les rémunérations à venir — CGPS art. 8B.3
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// L'article 8B.3 laisse ALANE récupérer, sur les versements à venir, une somme
// remboursée au client alors qu'elle avait déjà été versée au prestataire. Il
// pose trois limites, et ce sont elles qui font tout l'intérêt du calcul :
//
//   • « dans la limite de la MOITIÉ de chaque versement » — un prestataire ne
//     peut pas se retrouver à zéro du jour au lendemain ;
//   • « jusqu'à extinction de la créance » — on ne prélève pas au-delà du dû ;
//   • « le Prestataire en est informé PAR ÉCRIT, avec le détail du calcul,
//     AVANT la première retenue » — une créance non notifiée ne se compense pas.
//
// Une contestation suspend la compensation jusqu'à examen contradictoire.
//
// Le calcul vit ici, seul, parce qu'il touche à l'argent de quelqu'un et qu'il
// doit être vérifiable sans base de données ni Stripe.
// ═══════════════════════════════════════════════════════════════════════════

/** Part maximale d'un versement pouvant être retenue (CGPS art. 8B.3). */
export const PART_MAX_COMPENSABLE = 0.5;

/** Délai au terme duquel la somme non compensée devient exigible. */
export const DELAI_EXIGIBILITE_JOURS = 60;

const centimes = (v) => Math.round(Number(v || 0) * 100);
const euros    = (c) => Math.round(c) / 100;

/**
 * Une créance est-elle compensable à cet instant ?
 *
 * Séparé du calcul pour que la raison d'écarter une créance soit lisible dans
 * les journaux : une créance ignorée en silence, c'est un prestataire qui ne
 * comprend pas pourquoi on ne lui prend rien — ou pourquoi on lui prend.
 *
 * @returns {{ ok: boolean, motif?: string }}
 */
export function creanceCompensable(c) {
  if (!c) return { ok: false, motif: "créance absente" };
  if (c.statut === "contestee")            return { ok: false, motif: "contestée — compensation suspendue jusqu'à examen contradictoire" };
  if (c.statut !== "active")               return { ok: false, motif: `statut ${c.statut}` };
  if (!c.notifiee_at)                      return { ok: false, motif: "non notifiée au prestataire — l'article impose l'information préalable" };
  if (centimes(c.montant_restant) <= 0)    return { ok: false, motif: "déjà éteinte" };
  return { ok: true };
}

/**
 * Répartit la retenue d'un versement entre les créances actives du prestataire.
 *
 * Les créances les plus anciennes sont servies en premier : c'est l'ordre
 * d'imputation le plus simple à expliquer, et celui qui rapproche le plus vite
 * une créance de son extinction.
 *
 * Tout est calculé en CENTIMES ENTIERS. Le calcul en flottants avait déjà
 * produit un écart d'un centime sur la vérification des montants — sur une
 * retenue, cet écart se traduirait par une créance qui ne s'éteint jamais
 * tout à fait.
 *
 * @param {number} montantVersement  le montant dû au prestataire, en euros
 * @param {Array}  creances          créances du prestataire, ordre indifférent
 * @returns {{
 *   compensationTotale:number,
 *   montantVerse:number,
 *   imputations:Array<{creance_id:string, montant:number, restantApres:number}>,
 *   ecartees:Array<{creance_id:string, motif:string}>
 * }}
 */
export function repartirCompensation(montantVersement, creances) {
  const versementC = Math.max(0, centimes(montantVersement));
  const imputations = [];
  const ecartees = [];

  // Le plafond se calcule sur le versement ENTIER, une seule fois : appliquer
  // « la moitié » créance par créance reviendrait à retenir 75 % avec deux
  // créances, et 87,5 % avec trois.
  let disponibleC = Math.floor(versementC * PART_MAX_COMPENSABLE);

  const eligibles = [];
  for (const c of (Array.isArray(creances) ? creances : [])) {
    const verdict = creanceCompensable(c);
    if (verdict.ok) eligibles.push(c);
    else ecartees.push({ creance_id: c?.id, motif: verdict.motif });
  }

  eligibles.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  for (const c of eligibles) {
    if (disponibleC <= 0) break;
    const dûC = centimes(c.montant_restant);
    const priseC = Math.min(disponibleC, dûC);
    if (priseC <= 0) continue;
    disponibleC -= priseC;
    imputations.push({
      creance_id: c.id,
      montant: euros(priseC),
      restantApres: euros(dûC - priseC),
    });
  }

  const compensationC = imputations.reduce((t, i) => t + centimes(i.montant), 0);
  return {
    compensationTotale: euros(compensationC),
    montantVerse: euros(versementC - compensationC),
    imputations,
    ecartees,
  };
}

/**
 * Date à laquelle une créance notifiée aujourd'hui deviendra exigible.
 */
export function dateExigibilite(notifieeAtMs) {
  return new Date(notifieeAtMs + DELAI_EXIGIBILITE_JOURS * 86400000).toISOString();
}
