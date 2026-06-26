import crypto from "crypto";

// In-memory rate limit (reset on cold start — suffisant pour Vercel)
const rl = new Map();

function genToken(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  return `${ts}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limiting par IP — 10 tentatives / 5 min
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const rec = rl.get(ip) || { count: 0, reset: now + 300_000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 300_000; }
  rec.count++;
  rl.set(ip, rec);
  if (rec.count > 10) return res.status(429).json({ ok: false, error: "Trop de tentatives — réessayez dans 5 minutes" });

  const { pin } = req.body || {};
  if (!pin || typeof pin !== "string") return res.status(400).json({ ok: false });

  const BO_PASSWORD = process.env.BO_PASSWORD;
  const BO_SECRET   = process.env.BO_SESSION_SECRET;
  if (!BO_PASSWORD || !BO_SECRET) return res.status(500).json({ ok: false, error: "Configuration BO manquante" });

  // Comparaison timing-safe pour éviter les attaques par mesure de temps
  // On ajoute un délai fixe sur TOUTES les réponses (succès inclus) pour masquer le timing
  await new Promise(r => setTimeout(r, Math.min(rec.count * 400, 3000)));
  let pinOk = false;
  try {
    if (pin.length === BO_PASSWORD.length) {
      pinOk = crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(BO_PASSWORD));
    }
  } catch { pinOk = false; }
  if (!pinOk) {
    return res.status(401).json({ ok: false });
  }

  const token = genToken(BO_SECRET);
  return res.status(200).json({ ok: true, token });
}
