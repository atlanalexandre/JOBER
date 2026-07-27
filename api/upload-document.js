export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } }, // plus besoin de gros corps : plus de base64
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const refreshToken = (req.headers["x-refresh-token"] || "").trim();
  if (!token && !refreshToken) return res.status(401).json({ error: "Token requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

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

  // Si token expiré ou absent, rafraîchir via Supabase
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
        if (rd.access_token) {
          res.setHeader("x-new-access-token", rd.access_token);
          res.setHeader("x-new-refresh-token", rd.refresh_token);
        }
      }
    } catch { /* continue */ }
  }
  if (!userId) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });

  const { docType, fileName, mimeType } = req.body || {};
  if (!docType) return res.status(400).json({ error: "docType requis" });

  const ext = fileName ? fileName.split(".").pop().toLowerCase() : (mimeType === "application/pdf" ? "pdf" : "jpg");
  const storagePath = `${userId}/${docType}_${Date.now()}.${ext}`;

  const svcHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Générer une URL d'upload signée — le navigateur uploadera le fichier directement
  const signRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/Documents/${storagePath}`,
    { method: "POST", headers: svcHeaders, body: JSON.stringify({ expiresIn: 300 }) }
  );

  if (!signRes.ok) {
    const err = await signRes.text();
    console.error("[upload-document] sign error:", signRes.status, err);
    return res.status(500).json({ error: "Erreur génération URL upload" });
  }

  const sd = await signRes.json();
  // sd.signedURL est un chemin relatif comme "/storage/v1/object/upload/sign/..."
  const signedUrl = `${SUPABASE_URL}${sd.signedURL}`;

  // Pré-enregistrer le document en base (avant upload, le fichier arrivera juste après)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
      method: "POST",
      headers: { ...svcHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ prestataire_id: userId, type: docType, storage_path: storagePath, verified: false }),
    });
  } catch (e) {
    console.error("[upload-document] db pre-insert error:", e);
  }

  return res.status(200).json({ signedUrl, storagePath });
}
