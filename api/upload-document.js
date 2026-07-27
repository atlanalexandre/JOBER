export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
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

  // Décoder le JWT localement (pas d'appel réseau) pour extraire userId + vérifier expiry
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

  const { fileBase64, fileName, mimeType, docType } = req.body || {};
  if (!fileBase64 || !docType) return res.status(400).json({ error: "fileBase64 + docType requis" });

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileBase64, "base64");
  } catch {
    return res.status(400).json({ error: "fileBase64 invalide" });
  }

  const ext = fileName ? fileName.split(".").pop().toLowerCase() : (mimeType === "application/pdf" ? "pdf" : "jpg");
  const storagePath = `${userId}/${docType}_${Date.now()}.${ext}`;
  const contentType = mimeType || "application/octet-stream";

  // Upload to Supabase Storage via service role (bypass RLS)
  try {
    const storageRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/Documents/${storagePath}`,
      {
        method: "POST",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: fileBuffer,
      }
    );
    if (!storageRes.ok) {
      const err = await storageRes.text();
      console.error("[upload-document] storage error:", storageRes.status, err);
      return res.status(500).json({ error: "Erreur upload fichier" });
    }
  } catch (e) {
    console.error("[upload-document] storage exception:", e);
    return res.status(500).json({ error: "Erreur upload fichier" });
  }

  // Save document record in DB
  try {
    const svcHeaders = {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
      method: "POST",
      headers: { ...svcHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ prestataire_id: userId, type: docType, storage_path: storagePath, verified: false }),
    });
    if (!dbRes.ok) {
      const err = await dbRes.text();
      console.error("[upload-document] db error:", dbRes.status, err);
      return res.status(500).json({ error: "Erreur enregistrement document" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[upload-document] db exception:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
