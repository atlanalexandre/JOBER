export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Token requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Vérifier le JWT pour obtenir le vrai userId (ne pas faire confiance au body)
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Token invalide" });
    const u = await userRes.json();
    userId = u.id;
  } catch (e) {
    return res.status(401).json({ error: "Erreur vérification token" });
  }

  const { type, storagePath } = req.body || {};
  if (!type || !storagePath) return res.status(400).json({ error: "type + storagePath requis" });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ prestataire_id: userId, type, storage_path: storagePath, verified: false }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("[save-document] insert error:", r.status, err);
      return res.status(500).json({ error: "Erreur insertion document" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[save-document] error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
