export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Token requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

  const svcHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Un seul appel : vérification JWT + récupération user_metadata courante
  let userId, currentMeta;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });
    const u = await userRes.json();
    userId = u.id;
    currentMeta = u.user_metadata || {};
  } catch (e) {
    console.error("[update-profile] JWT verification error:", e?.message);
    return res.status(401).json({ error: "Erreur vérification session" });
  }

  // Action "get" : retourner user_metadata directement (pas de 2e appel Supabase)
  if (req.body?.action === "get") {
    return res.status(200).json({ user_metadata: currentMeta });
  }

  const { profileData } = req.body || {};
  if (!profileData || typeof profileData !== "object") {
    return res.status(400).json({ error: "profileData requis" });
  }

  // Merge léger : conserver les champs existants SAUF photo_url (déjà en Supabase, inutile de le renvoyer).
  // L'Admin API Supabase fait un merge de user_metadata → les champs absents du body sont préservés.
  const { photo_url: newPhoto, ...restNew } = profileData;
  const { photo_url: _oldPhoto, ...restCurrent } = currentMeta;
  const merged = { ...restCurrent, ...restNew };
  if (newPhoto !== undefined) merged.photo_url = newPhoto;

  // Écriture via Admin API
  try {
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: svcHeaders,
      body: JSON.stringify({ user_metadata: merged }),
    });
    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[update-profile] admin PUT error:", updateRes.status, err);
      return res.status(500).json({ error: "Erreur mise à jour profil (" + updateRes.status + ")" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[update-profile] PUT exception:", e?.message);
    return res.status(500).json({ error: "Erreur serveur: " + (e?.message || "inconnue") });
  }
}
