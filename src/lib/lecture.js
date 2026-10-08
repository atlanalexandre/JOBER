// Lecture d'une ressource JSON avec reprise (07/10/2026).
//
// Une réponse en erreur ne doit jamais être lue comme un résultat vide : le
// catalogue des prestataires mettait en mémoire le corps d'une erreur 500,
// lu comme « aucun prestataire », pour toute la durée de vie de la page.

/**
 * Lit `url` et rend le JSON d'une réponse réussie. Réessaie `reprises` fois,
 * après `attenteMs` × numéro de l'essai ; lève une erreur si tout échoue.
 * Seules une coupure réseau et une erreur du serveur (5xx) sont réessayées :
 * un 4xx ne changera pas au second essai, et faisait attendre 4,5 s pour rien.
 */
export async function lireJsonAvecReprise(url, { reprises = 2, attenteMs = 1500, fetchImpl = fetch } = {}) {
  for (let essai = 0; ; essai++) {
    let r = null;
    let motif;
    try {
      r = await fetchImpl(url);
    } catch (e) {
      motif = e.message;
    }
    if (r?.ok) return r.json();
    if (r && r.status < 500) throw new Error(`${url} refusé (${r.status})`);
    if (r) motif = r.status;
    if (essai >= reprises) throw new Error(`${url} illisible (${motif})`);
    await new Promise(ok => setTimeout(ok, attenteMs * (essai + 1)));
  }
}
