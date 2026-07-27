export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const refreshToken = (req.headers["x-refresh-token"] || "").trim();

  if (!token && !refreshToken) return res.status(401).json({ error: "Token requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

  const svcHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  let userId, currentMeta, newAt, newRt;

  // 1. Vérifier le JWT courant
  if (token) {
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${token}` },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        userId = u.id;
        currentMeta = u.user_metadata || {};
      }
    } catch { /* continue vers refresh */ }
  }

  // 2. Si JWT expiré/invalide, rafraîchir via Supabase REST (sans SDK, sans side-effects)
  if (!userId && refreshToken) {
    try {
      const refreshRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshRes.ok) {
        const rd = await refreshRes.json();
        userId = rd.user?.id;
        currentMeta = rd.user?.user_metadata || {};
        newAt = rd.access_token;
        newRt = rd.refresh_token;
      }
    } catch { /* continue */ }
  }

  if (!userId) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });

  // Retourner les nouveaux tokens au client si on a rafraîchi
  if (newAt) {
    res.setHeader("x-new-access-token", newAt);
    res.setHeader("x-new-refresh-token", newRt);
  }

  // Action "get" : retourner user_metadata directement
  if (req.body?.action === "get") {
    return res.status(200).json({ user_metadata: currentMeta });
  }

  const { profileData } = req.body || {};
  if (!profileData || typeof profileData !== "object") {
    return res.status(400).json({ error: "profileData requis" });
  }

  // Merge : conserver les champs existants, exclure photo_url sauf si explicitement fournie
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
