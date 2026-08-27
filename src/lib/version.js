// Détection d'une nouvelle version déployée.
//
// POURQUOI
//
// Une application installée sur l'écran d'accueil n'est presque jamais fermée.
// Le service worker récupère bien les nouveaux fichiers, mais l'onglet ouvert
// continue d'exécuter le JavaScript chargé le premier jour, indéfiniment.
//
// Le 27/08/2026, le back-office affichait encore un bouton « Seed démo
// prestataire — destructif », supprimé du dépôt le 14/08 avec la fonction
// serverless qu'il appelait. Deux semaines de retard, sur un écran qui gère des
// comptes. Le même écart avait fait conclure qu'un correctif ne marchait pas,
// alors qu'il n'était simplement pas chargé.
//
// Sur une application qui manipule de l'argent, personne ne doit rester des
// semaines sur du code que l'on croit remplacé.
//
// COMMENT
//
// Le build écrit `dist/version.json` et injecte la même valeur dans le bundle
// (`__BUILD_ID__`). Si les deux diffèrent, le code exécuté n'est plus celui qui
// est déployé. On ne recharge JAMAIS d'autorité : un rechargement au milieu
// d'une réservation ou d'un dépôt de document ferait perdre la saisie en cours.
// On prévient, l'utilisateur choisit.

// `__BUILD_ID__` est remplacé à la compilation. En développement et sous
// vitest, il n'existe pas : la vérification est alors sans objet.
const BUILD_LOCAL = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : null;

/**
 * La version déployée diffère-t-elle de celle qui s'exécute ?
 *
 * Ne lève jamais et répond `false` au moindre doute : réseau coupé, réponse
 * illisible, fichier absent d'un ancien déploiement. Annoncer une mise à jour
 * qui n'existe pas serait pire que de n'en annoncer aucune.
 */
export async function nouvelleVersionDisponible() {
  if (!BUILD_LOCAL) return false;
  try {
    const r = await fetch(`/version.json?t=${BUILD_LOCAL}`, { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json();
    return typeof d?.build === "string" && d.build !== BUILD_LOCAL;
  } catch {
    // Hors ligne, ou déploiement en cours de bascule. On réessaiera.
    return false;
  }
}

/**
 * Recharge en contournant le cache du navigateur ET celui du service worker.
 *
 * Le simple `location.reload()` ne suffit pas : les fichiers `/assets/` sont
 * servis en cache-first par le service worker, qui rendrait à nouveau
 * l'ancienne version.
 */
export async function rechargerVersion() {
  try {
    if ("caches" in window) {
      const noms = await caches.keys();
      await Promise.all(noms.map(n => caches.delete(n)));
    }
  } catch (e) {
    console.error("[version] purge du cache impossible :", e.message);
  }
  window.location.reload();
}
