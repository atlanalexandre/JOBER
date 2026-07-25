import crypto from "crypto";

function genToken(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${nonce}`).digest("hex");
  return `${ts}.${nonce}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const xfwd = req.headers["x-forwarded-for"] || "";
  const ip = (xfwd ? xfwd.split(",").at(-1).trim() : null) || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  // Sanitize : supprime espaces/sauts de ligne (copier-coller iPad/mobile)
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const BO_PASSWORD      = (process.env.BO_PASSWORD || "").replace(/\s/g, "") || undefined;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Configuration Supabase manquante" });
  }

  // BO_SESSION_SECRET optionnel : dérivé de SERVICE_ROLE_KEY si absent
  const BO_SECRET = process.env.BO_SESSION_SECRET ||
    crypto.createHmac("sha256", SERVICE_ROLE_KEY).update("bo-session-fallback").digest("hex");

  // Si BO_PASSWORD non configuré → mot de passe temporaire affiché à l'admin
  const tempPassword = crypto.createHmac("sha256", SERVICE_ROLE_KEY).update("bo-temp-access").digest("hex").slice(0, 16);
  const effectivePassword = BO_PASSWORD || tempPassword;
  const usingTempPassword = !BO_PASSWORD;

  const rlHeaders = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // Rate-limit persistant : 10 tentatives / 5 min par IP
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
  if (!pin || typeof pin !== "string") {
    if (usingTempPassword) return res.status(400).json({ ok: false, needsSetup: true, tempPassword });
    return res.status(400).json({ ok: false });
  }

  await new Promise(r => setTimeout(r, Math.min(attempts * 400, 3000)));

  const sanitize = s => s.replace(/[﻿  ⁠]/g, "").trim();
  const expected = sanitize(effectivePassword);
  const received = sanitize(pin);
  let pinOk = false;
  try {
    const bufE = Buffer.from(expected, "utf8");
    const bufR = Buffer.from(received, "utf8");
    if (bufE.length === bufR.length) {
      pinOk = crypto.timingSafeEqual(bufE, bufR);
    }
  } catch { pinOk = false; }

  if (!pinOk) {
    // Diagnostic: list env var names containing "BO" or "PASSWORD" (names only, no values)
    const boEnvKeys = Object.keys(process.env).filter(k =>
      k.toUpperCase().includes("BO") || k.toUpperCase().includes("PASSWORD")
    );
    const extra = usingTempPassword
      ? { needsSetup: true, tempPassword, _debug_boPwdLen: process.env.BO_PASSWORD?.length ?? -1, _debug_vercelEnv: process.env.VERCEL_ENV || "non-vercel", _debug_boKeys: boEnvKeys }
      : { _debug_boPwdLen: process.env.BO_PASSWORD?.length ?? -1, _debug_vercelEnv: process.env.VERCEL_ENV || "non-vercel", _debug_boKeys: boEnvKeys };
    return res.status(401).json({ ok: false, ...extra });
  }

  // Succès : réinitialiser le compteur
  fetch(`${SUPABASE_URL}/rest/v1/bo_rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: { ...rlHeaders, "Prefer": "return=minimal" },
  }).catch(() => {});

  const token = genToken(BO_SECRET);
  return res.status(200).json({ ok: true, token, ...(usingTempPassword && { needsSetup: true }) });
}
