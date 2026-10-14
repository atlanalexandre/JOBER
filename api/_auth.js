// Vérifie le Bearer token et retourne l'utilisateur Supabase, ou null si invalide.
export async function verifyUser(req, supabaseUrl, serviceRoleKey) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Le compte dont l'adresse est EXACTEMENT `email`, ou null s'il n'existe pas.
 *
 * `/auth/v1/admin/users?email=…` ne filtre PAS : le paramètre est ignoré, et la
 * réponse commence par le compte le plus récent. Trois endroits prenaient ce
 * premier résultat pour le compte demandé (constaté en recette le 01/10/2026) :
 * la réinitialisation du mot de passe changeait celui du DERNIER INSCRIT, et non
 * celui du demandeur. On parcourt donc la liste, et l'adresse est comparée.
 *
 * Lève une erreur si une page est illisible : « introuvable » ne doit jamais
 * vouloir dire « on n'a pas pu lire ».
 */
export async function utilisateurParEmail(email, supabaseUrl, serviceRoleKey, { pagesMax = 100 } = {}) {
  const cible = String(email || "").trim().toLowerCase();
  if (!cible) return null;
  const headers = { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` };
  for (let page = 1; page <= pagesMax; page++) {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers });
    if (!r.ok) throw new Error(`comptes illisibles (${r.status}) page ${page}`);
    const d = await r.json().catch(() => null);
    const users = Array.isArray(d?.users) ? d.users : null;
    if (!users) throw new Error(`réponse illisible page ${page}`);
    const trouve = users.find(u => String(u?.email || "").trim().toLowerCase() === cible);
    if (trouve) return trouve;
    if (users.length < 1000) return null;
  }
  throw new Error(`plus de ${pagesMax * 1000} comptes parcourus sans conclure`);
}

// Statuts de compte qui ferment l'accès à ce qui engage de l'argent.
export const STATUTS_BLOQUES = ["suspended", "rejected"];

/**
 * Refuse la requête si le compte de `caller` est suspendu ou refusé ; rend
 * true quand la réponse est déjà envoyée.
 *
 * `verifyUser` ne regarde que le jeton. Un compte suspendu est déconnecté par
 * l'application, mais son jeton se rafraîchit indéfiniment auprès de Supabase :
 * par un appel direct, il pouvait encore enregistrer une carte, payer une
 * réservation ou souscrire un abonnement (étude du 13/10/2026). `missions`,
 * lui, exigeait déjà un compte approuvé.
 *
 * Ne pas l'appeler partout : un compte suspendu doit pouvoir retirer sa carte,
 * résilier son abonnement, régler des heures déjà faites, écrire au support
 * (CGPS 16.2 : il présente ses observations) et supprimer son compte.
 *
 * Profil illisible → 503 : on ne laisse pas passer faute d'avoir pu lire.
 */
export async function refuserCompteBloque(res, caller, supabaseUrl, serviceRoleKey) {
  let statut;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=status`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
    });
    if (!r.ok) throw new Error(`profil illisible (${r.status})`);
    const lignes = await r.json();
    statut = Array.isArray(lignes) ? lignes[0]?.status : undefined;
  } catch (e) {
    console.error(`[compte-bloque] statut de ${caller.id} illisible :`, e.message);
    res.status(503).json({ error: "Vérification du compte impossible. Réessayez dans un instant." });
    return true;
  }
  if (!STATUTS_BLOQUES.includes(statut)) return false;
  res.status(403).json({
    error: statut === "suspended"
      ? "Votre compte est suspendu. Contactez support@alane.fr."
      : "Votre compte a été refusé. Contactez support@alane.fr.",
    code: "compte_bloque",
  });
  return true;
}
