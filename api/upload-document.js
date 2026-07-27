export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req, res) {
  try { return await _handler(req, res); }
  catch (e) {
    console.error("[upload-document] unhandled:", e?.message);
    if (!res.headersSent) res.status(500).json({ error: "Erreur inattendue: " + (e?.message || "inconnue") });
  }
}

async function _handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Token requis", expired: true });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

  // Décoder le JWT localement — aucun appel réseau
  let userId;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString());
    if (payload?.sub && payload?.exp * 1000 > Date.now() + 5000) {
      userId = payload.sub;
    }
  } catch { /* continue */ }

  if (!userId) return res.status(401).json({ error: "Token expiré — reconnectez-vous.", expired: true });

  const { docType, fileName, mimeType } = req.body || {};
  if (!docType) return res.status(400).json({ error: "docType requis" });

  const ext = fileName ? fileName.split(".").pop().toLowerCase() : (mimeType === "application/pdf" ? "pdf" : "jpg");
  const storagePath = `${userId}/${docType}_${Date.now()}.${ext}`;

  const svcHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Générer une URL d'upload signée — timeout 6s
  let signedUrl;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/Documents/${storagePath}`,
      { method: "POST", headers: svcHeaders, body: JSON.stringify({ expiresIn: 300, upsert: true }), signal: ctrl.signal }
    );
    clearTimeout(timer);

    if (!signRes.ok) {
      const err = await signRes.text().catch(() => "?");
      console.error("[upload-document] sign error:", signRes.status, err);
      return res.status(500).json({ error: "Erreur génération URL upload (" + signRes.status + ")" });
    }

    const sd = await signRes.json();
    signedUrl = sd.signedURL || sd.url || "";
    if (signedUrl && !signedUrl.startsWith("http")) signedUrl = `${SUPABASE_URL}${signedUrl}`;
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Timeout Supabase Storage (>6s)" : (e?.message || "erreur réseau");
    console.error("[upload-document] sign fetch error:", msg);
    return res.status(500).json({ error: "Impossible de contacter Supabase Storage: " + msg });
  }

  if (!signedUrl) return res.status(500).json({ error: "URL signée vide — réponse inattendue de Supabase" });

  // Pré-enregistrer le document en base (non bloquant)
  fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: { ...svcHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ prestataire_id: userId, type: docType, storage_path: storagePath, verified: false }),
  }).catch(e => console.error("[upload-document] db insert error:", e));

  return res.status(200).json({ signedUrl, storagePath });
}
