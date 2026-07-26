export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,status&limit=1`,
      { headers }
    );
    if (!r.ok) {
      const err = await r.text();
      console.error("[get-profile] fetch error:", r.status, err);
      return res.status(500).json({ error: "Erreur lecture profil" });
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: "Profil introuvable" });
    }
    return res.status(200).json(rows[0]);
  } catch (e) {
    console.error("[get-profile] error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
