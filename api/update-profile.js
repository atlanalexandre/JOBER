export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
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

  // Décoder le JWT localement — pas d'appel réseau sur le chemin normal
  let userId;
  if (token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
      if (payload?.sub && payload?.exp * 1000 > Date.now() + 10000) {
        userId = payload.sub;
      }
    } catch { /* continue */ }
  }

  // Si token expiré/invalide → rafraîchir via Supabase
  if (!userId && refreshToken) {
    try {
      const rr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (rr.ok) {
        const rd = await rr.json();
        userId = rd.user?.id;
        if (rd.access_token) {
          res.setHeader("x-new-access-token", rd.access_token);
          res.setHeader("x-new-refresh-token", rd.refresh_token);
        }
      }
    } catch { /* continue */ }
  }

  if (!userId) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });

  const { profileData } = req.body || {};
  if (!profileData || typeof profileData !== "object") {
    return res.status(400).json({ error: "profileData requis" });
  }

  // Récupérer le metadata actuel pour merge côté serveur
  // (le frontend n'envoie pas la photo_url sauf si elle a changé — évite les gros corps de requête)
  let currentMeta = {};
  try {
    const cur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svcHeaders });
    if (cur.ok) currentMeta = (await cur.json())?.user_metadata || {};
  } catch { /* continuer avec currentMeta vide */ }

  // Merge : données existantes + nouvelles (les nouvelles ont priorité)
  const merged = { ...currentMeta, ...profileData };

  // Mise à jour via Admin API
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
    console.error("[update-profile] exception:", e?.message);
    return res.status(500).json({ error: "Erreur serveur: " + (e?.message || "inconnue") });
  }
}
