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
