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
      `${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${encodeURIComponent(userId)}&select=type,verified,storage_path`,
      { headers }
    );
    if (!r.ok) {
      const err = await r.text();
      console.error("[get-documents] fetch error:", r.status, err);
      return res.status(500).json({ error: "Erreur lecture documents" });
    }
    const rows = await r.json();
    return res.status(200).json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    console.error("[get-documents] error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
