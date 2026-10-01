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
