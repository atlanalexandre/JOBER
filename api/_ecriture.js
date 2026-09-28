// Écriture qui SUIT un mouvement d'argent (remboursement, virement, recrédit)
// ou qui fixe un statut dont dépend le paiement : son résultat est vérifié.
//
// Un `.catch()` n'attrape que les coupures réseau ; un refus de PostgREST
// (colonne inconnue, valeur hors contrainte, droit manquant) résout
// normalement, et passait donc inaperçu : prestation remboursée restée
// ouverte, virement émis mais jamais inscrit, portefeuille jamais recrédité
// (CLAUDE.md, « Écriture après un paiement »).
//
// Retourne true si au moins une ligne a été écrite, false sinon — l'échec est
// journalisé avec le contexte, jamais avalé. C'est à l'appelant de décider s'il
// interrompt (réponse d'erreur) ou s'il poursuit (tâche planifiée).
export async function ecrireVerifie(url, corps, headers, contexte, { method = "PATCH" } = {}) {
  try {
    const r = await fetch(url, {
      method, headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify(corps),
    });
    const lignes = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(lignes) || lignes.length === 0) {
      console.error(`[${contexte}] écriture NON enregistrée (${r.status}) ${JSON.stringify(corps)} — `
        + `${JSON.stringify(lignes || {}).slice(0, 200)}. À reprendre à la main.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[${contexte}] écriture NON enregistrée ${JSON.stringify(corps)} :`, e.message, "— à reprendre à la main.");
    return false;
  }
}
