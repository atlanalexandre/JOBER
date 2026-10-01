// ═══════════════════════════════════════════════════════════════════════════
// Lire TOUTES les lignes d'une requête, page par page
// ═══════════════════════════════════════════════════════════════════════════
//
// PostgREST ne rend jamais plus de 1 000 lignes par requête (réglage `max_rows`
// de Supabase), quel que soit le `limit` demandé : `limit=5000` rend 1 000
// lignes, sans erreur ni avertissement. Une requête qui croit tout lire n'en lit
// qu'une partie, et ce qui manque se comporte comme « absent ».
//
// Constaté en recette le 30/09/2026, avec 1 017 prestataires actifs :
//   - le traitement des documents lisait 1 000 attestations URSSAF sur 1 076 et
//     SUSPENDAIT des prestataires dont l'attestation était vérifiée ;
//   - le catalogue n'en montrait que 995 : au-delà de mille, les plus récents
//     étaient invisibles des clients, et absents des candidats d'une prestation.
//
// Le même défaut avait déjà tronqué la liste des comptes du back-office (#895).
// ═══════════════════════════════════════════════════════════════════════════

/** Taille d'une page : celle que PostgREST accepte. */
export const PAGE = 1000;

/**
 * Toutes les lignes d'une requête PostgREST (GET), quelle qu'en soit la taille.
 *
 * @param {string} url      requête complète, SANS `limit` ni `offset`. Un `order`
 *                          est ajouté (`id.asc`) s'il manque : sans ordre stable,
 *                          deux pages peuvent se chevaucher ou laisser un trou.
 * @param {object} headers
 * @param {{ max?: number }} options  garde-fou contre une boucle sans fin : atteint,
 *                          il LÈVE une erreur, jamais une lecture tronquée
 * @returns {Promise<Array>} lève une erreur si une page est refusée : une lecture
 *          partielle ne doit JAMAIS passer pour une lecture complète.
 */
export async function lireTout(url, headers, { max = 50000 } = {}) {
  if (/[?&](limit|offset)=/.test(url)) {
    throw new Error("lireTout : l'URL ne doit porter ni limit ni offset");
  }
  const base = /[?&]order=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}order=id.asc`;
  const lignes = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const r = await fetch(`${base}&limit=${PAGE}&offset=${offset}`, { headers });
    const page = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(page)) {
      throw new Error(`lecture refusée (${r.status}) à partir de la ligne ${offset}`);
    }
    lignes.push(...page);
    if (page.length < PAGE) return lignes;
  }
  // Le garde-fou est atteint : ce qui suit n'a pas été lu. Le RENDRE comme une
  // lecture complète, c'était refaire à plus grande échelle la panne du
  // 30/09/2026 — des lignes non lues traitées comme absentes, des prestataires
  // en règle suspendus. On lève, comme pour une page refusée (relecture du
  // 01/10/2026).
  throw new Error(`plus de ${max} lignes — lecture arrêtée par sécurité, résultat incomplet : ${base.split("?")[0]}`);
}
