export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL           = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).end();

  const rawBody = await getRawBody(req);
  const sig     = req.headers["stripe-signature"];

  // Vérification signature si webhook secret configuré
  if (STRIPE_WEBHOOK_SECRET && sig) {
    try {
      const crypto = await import("crypto");
      const [, tsStr, v1] = sig.match(/t=(\d+),v1=([a-f0-9]+)/) || [];
      if (!tsStr || !v1) return res.status(400).json({ error: "Signature invalide" });
      const payload  = `${tsStr}.${rawBody.toString()}`;
      const expected = crypto.default.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
      if (expected !== v1) return res.status(400).json({ error: "Signature invalide" });
    } catch { return res.status(400).json({ error: "Erreur signature" }); }
  }

  let event;
  try { event = JSON.parse(rawBody.toString()); }
  catch { return res.status(400).json({ error: "JSON invalide" }); }

  if (event.type === "payment_intent.succeeded") {
    const intent   = event.data.object;
    const missionId = intent.metadata?.mission;
    if (missionId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const headers = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
      };
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ stripe_payment_intent: intent.id, status: "assigned" }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ received: true });
}
