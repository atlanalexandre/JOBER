import crypto from "crypto";

function genToken(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${nonce}`).digest("hex");
  return `${ts}.${nonce}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Take the LAST value in x-forwarded-for: Vercel's edge appends the real client IP at the end,
  // so the first value can be spoofed by the client to bypass the rate limit.
  const xfwd = req.headers["x-forwarded-for"] || "";
  const ip = (xfwd ? xfwd.split(",").at(-1).trim() : null) || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BO_PASSWORD      = process.env.BO_PASSWORD;
  const BO_SECRET        = process.env.BO_SESSION_SECRET;
  if (!BO_PASSWORD || !BO_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Configuration BO manquante" });
  }

  const rlHeaders = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // Rate-limit persistant : 10 tentatives / 5 min par IP (survit aux cold starts)
  let attempts = 1;
  try {
    const rlRes  = await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}&select=attempts,reset_at`, { headers: rlHeaders });
    const rlData = rlRes.ok ? await rlRes.json().catch(() => []) : [];
    const rec    = Array.isArray(rlData) && rlData[0];

    if (rec && new Date(rec.reset_at) > new Date()) {
      attempts = (rec.attempts || 0) + 1;
      await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: "PATCH",
        headers: { ...rlHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ attempts }),
      }).catch(() => {});
    } else {
      // Expiré ou nouveau : (ré)initialiser
      await fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits`, {
        method: "POST",
        headers: { ...rlHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ ip, attempts: 1, reset_at: new Date(now + 300_000).toISOString() }),
      }).catch(() => {});
      attempts = 1;
    }
  } catch { /* DB indisponible — on continue sans bloquer */ }

  if (attempts > 10) {
    return res.status(429).json({ ok: false, error: "Trop de tentatives — réessayez dans 5 minutes" });
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== "string") return res.status(400).json({ ok: false });

  // Délai croissant sur TOUTES les réponses (masque le timing, pénalise la force brute)
  await new Promise(r => setTimeout(r, Math.min(attempts * 400, 3000)));

  let pinOk = false;
  try {
    if (pin.length === BO_PASSWORD.length) {
      pinOk = crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(BO_PASSWORD));
    }
  } catch { pinOk = false; }

  if (!pinOk) return res.status(401).json({ ok: false });

  // Succès : réinitialiser le compteur
  fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: { ...rlHeaders, "Prefer": "return=minimal" },
  }).catch(() => {});

  const token = genToken(BO_SECRET);
  return res.status(200).json({ ok: true, token });
}
