// Lecture d'une ressource JSON avec reprise (07/10/2026).
//
// Une réponse en erreur ne doit jamais être lue comme un résultat vide : le
// catalogue des prestataires mettait en mémoire le corps d'une erreur 500,
// lu comme « aucun prestataire », pour toute la durée de vie de la page.

/**
 * Lit `url` et rend le JSON d'une réponse réussie. Réessaie `reprises` fois,
 * après `attenteMs` × numéro de l'essai ; lève une erreur si tout échoue.
 */
export async function lireJsonAvecReprise(url, { reprises = 2, attenteMs = 1500, fetchImpl = fetch } = {}) {
  for (let essai = 0; ; essai++) {
    let statut;
    try {
      const r = await fetchImpl(url);
      if (r.ok) return await r.json();
      statut = r.status;
    } catch (e) {
      statut = e.message;
    }
    if (essai >= reprises) throw new Error(`${url} illisible (${statut})`);
    await new Promise(ok => setTimeout(ok, attenteMs * (essai + 1)));
  }
}
