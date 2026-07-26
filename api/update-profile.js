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

  // Verify JWT → get userId
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });
    const u = await userRes.json();
    userId = u.id;
  } catch {
    return res.status(401).json({ error: "Erreur vérification session" });
  }

  const { profileData } = req.body || {};
  if (!profileData || typeof profileData !== "object") {
    return res.status(400).json({ error: "profileData requis" });
  }

  // Fetch current user_metadata via Admin API (service role → no JWT size issue)
  let currentMeta = {};
  try {
    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svcHeaders });
    if (adminRes.ok) {
      const adminUser = await adminRes.json();
      currentMeta = adminUser.user_metadata || {};
    }
  } catch { /* keep currentMeta empty, don't block */ }

  // Merge: keep existing fields (secteur, metier, bio, kbis, etc.) + apply new profileData
  // photo_url kept from existing unless explicitly provided in this request
  const { photo_url: newPhoto, ...restNew } = profileData;
  const merged = { ...currentMeta, ...restNew };
  if (newPhoto !== undefined) merged.photo_url = newPhoto;

  // Persist via Admin API
  try {
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: svcHeaders,
      body: JSON.stringify({ user_metadata: merged }),
    });
    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[update-profile] admin error:", updateRes.status, err);
      return res.status(500).json({ error: "Erreur mise à jour profil" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[update-profile] exception:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
