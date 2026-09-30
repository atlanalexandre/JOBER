// ═══════════════════════════════════════════════════════════════════════════
// Suppression d'un compte — ce que les deux chemins doivent faire pareil
// ═══════════════════════════════════════════════════════════════════════════
//
// Un compte se supprime par l'utilisateur (api/support.js, `delete_account`) ou
// par le back-office (api/bo-action.js, `delete`). Les deux chemins avaient
// divergé, et chacun avait ses trous (audit du 30/09/2026, constaté en recette) :
//
//   - la suppression du compte d'authentification n'était jamais vérifiée :
//     refusée par la base, elle répondait quand même « supprimé » ;
//   - l'utilisateur qui supprimait son compte gardait son abonnement Stripe, et
//     continuait d'être prélevé chaque mois sur un compte qui n'existait plus ;
//   - le back-office effaçait les fiches, mais laissait les fichiers — pièces
//     d'identité comprises — dans le stockage ;
//   - le back-office EFFAÇAIT les prestations au lieu de les anonymiser :
//     factures, virements et historique DAC7 partaient avec.
//
// Ces fonctions ne décident de rien : elles exécutent, et disent si ça a marché.
// ═══════════════════════════════════════════════════════════════════════════

/** Une prestation dans l'un de ces états n'est pas terminée. */
export const STATUTS_EN_COURS = ["open", "pending_acceptance", "assigned", "needs_replacement", "disputed"];

/**
 * Un versement dans l'un de ces états est encore dû au prestataire. `held`
 * (retenu) et `failed` (à relancer) l'étaient aussi, et n'étaient pas vus : un
 * prestataire pouvait supprimer son compte avec un virement bloqué, et le perdre.
 */
export const VERSEMENTS_DUS = ["pending", "processing", "held", "failed"];

const cleStripe = () => (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");

/**
 * Résilie immédiatement l'abonnement Stripe du compte, s'il en a un.
 * @returns {Promise<boolean>} true si plus rien ne sera prélevé
 */
export async function resilierAbonnement(userId, supabaseUrl, headers, contexte) {
  let abonnement;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=stripe_subscription_id`, { headers });
    const lignes = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(lignes)) {
      console.error(`[${contexte}] abonnement illisible (${r.status}) pour ${userId}`);
      return false;
    }
    abonnement = lignes[0]?.stripe_subscription_id || null;
  } catch (e) {
    console.error(`[${contexte}] lecture de l'abonnement impossible pour ${userId} :`, e.message);
    return false;
  }
  if (!abonnement) return true;

  const cle = cleStripe();
  if (!cle) {
    console.error(`[${contexte}] Stripe non configuré : abonnement ${abonnement} NON résilié`);
    return false;
  }
  try {
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(abonnement)}`, {
      method: "DELETE", headers: { "Authorization": `Bearer ${cle}` },
    });
    const d = await r.json().catch(() => ({}));
    // Déjà résilié ou introuvable : rien ne sera prélevé, l'état voulu est atteint.
    if (r.ok || d?.error?.code === "resource_missing") {
      console.log(`[${contexte}] abonnement ${abonnement} résilié`);
      return true;
    }
    console.error(`[${contexte}] abonnement ${abonnement} NON résilié (${r.status}) :`, d?.error?.message || "");
    return false;
  } catch (e) {
    console.error(`[${contexte}] abonnement ${abonnement} NON résilié :`, e.message);
    return false;
  }
}

/**
 * Efface les fichiers du compte dans le stockage, puis leurs fiches.
 *
 * Les fichiers sont cherchés dans le dossier du compte (`{user_id}/…`) ET dans
 * les fiches `documents` : un fichier déposé sans fiche — dépôt interrompu —
 * restait sinon en ligne.
 * @returns {Promise<boolean>}
 */
export async function effacerPieces(userId, supabaseUrl, headers, contexte) {
  const chemins = new Set();
  let ok = true;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/documents?prestataire_id=eq.${userId}&select=storage_path`, { headers });
    const lignes = await r.json().catch(() => null);
    if (r.ok && Array.isArray(lignes)) lignes.forEach(d => d.storage_path && chemins.add(d.storage_path));
    else { ok = false; console.error(`[${contexte}] fiches documents illisibles (${r.status}) pour ${userId}`); }
  } catch (e) {
    ok = false; console.error(`[${contexte}] fiches documents illisibles pour ${userId} :`, e.message);
  }
  try {
    // Bucket « Documents » : la casse compte (CLAUDE.md 3.4).
    const r = await fetch(`${supabaseUrl}/storage/v1/object/list/Documents`, {
      method: "POST", headers, body: JSON.stringify({ prefix: userId, limit: 1000 }),
    });
    const fichiers = await r.json().catch(() => null);
    if (r.ok && Array.isArray(fichiers)) fichiers.forEach(f => f?.name && f.id && chemins.add(`${userId}/${f.name}`));
    else { ok = false; console.error(`[${contexte}] dossier de stockage illisible (${r.status}) pour ${userId}`); }
  } catch (e) {
    ok = false; console.error(`[${contexte}] dossier de stockage illisible pour ${userId} :`, e.message);
  }

  if (chemins.size > 0) {
    try {
      const r = await fetch(`${supabaseUrl}/storage/v1/object/Documents`, {
        method: "DELETE", headers, body: JSON.stringify({ prefixes: [...chemins] }),
      });
      if (!r.ok) { ok = false; console.error(`[${contexte}] ${chemins.size} fichier(s) NON effacé(s) (${r.status}) pour ${userId}`); }
    } catch (e) {
      ok = false; console.error(`[${contexte}] ${chemins.size} fichier(s) NON effacé(s) pour ${userId} :`, e.message);
    }
  }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/documents?prestataire_id=eq.${userId}`, {
      method: "DELETE", headers: { ...headers, "Prefer": "return=minimal" },
    });
    if (!r.ok) { ok = false; console.error(`[${contexte}] fiches documents NON effacées (${r.status}) pour ${userId}`); }
  } catch (e) {
    ok = false; console.error(`[${contexte}] fiches documents NON effacées pour ${userId} :`, e.message);
  }
  return ok;
}

/**
 * Efface des prestations ce qui désigne la personne (adresse, description). La
 * prestation elle-même reste : montant, virement, facture, déclaration DAC7.
 * @returns {Promise<boolean>}
 */
export async function anonymiserPrestations(userId, supabaseUrl, headers, contexte) {
  let ok = true;
  for (const filtre of [`client_id=eq.${userId}`, `prestataire_id=eq.${userId}`]) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/missions?${filtre}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ description: null, adresse: null, ville: null }),
      });
      if (!r.ok) { ok = false; console.error(`[${contexte}] prestations NON anonymisées (${r.status}) : ${filtre}`); }
    } catch (e) {
      ok = false; console.error(`[${contexte}] prestations NON anonymisées (${filtre}) :`, e.message);
    }
  }
  return ok;
}

/**
 * Supprime le compte d'authentification — et donc le profil, par cascade.
 *
 * La réponse est LUE : la base refuse la suppression tant qu'une clé étrangère
 * la bloque (migration 2026-09-30_comptes_supprimes_prestations_conservees non
 * appliquée, par exemple), et ce refus passait pour un succès.
 * @returns {Promise<boolean>}
 */
export async function supprimerCompteAuth(userId, supabaseUrl, headers, contexte) {
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers });
    if (r.ok) return true;
    const texte = await r.text().catch(() => "");
    console.error(`[${contexte}] compte ${userId} NON supprimé (${r.status}) : ${texte.slice(0, 300)}`);
    return false;
  } catch (e) {
    console.error(`[${contexte}] compte ${userId} NON supprimé :`, e.message);
    return false;
  }
}
