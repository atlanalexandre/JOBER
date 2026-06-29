export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { plan, billing = "monthly" } = req.body || {};
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });
  if (!["premium","elite"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  // Verify JWT to get user
  let userId = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && SUPABASE_URL && SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": auth },
      });
      if (r.ok) { const u = await r.json(); userId = u.id || null; }
    } catch {}
  }

  const priceEnvKey = plan === "premium"
    ? (billing === "yearly" ? "STRIPE_PRICE_PREMIUM_YEARLY" : "STRIPE_PRICE_PREMIUM_MONTHLY")
    : (billing === "yearly" ? "STRIPE_PRICE_ELITE_YEARLY"   : "STRIPE_PRICE_ELITE_MONTHLY");
  const priceId = process.env[priceEnvKey];
  if (!priceId) return res.status(500).json({ error: `Variable ${priceEnvKey} manquante dans l'environnement Vercel` });

  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || process.env.APP_URL || "https://www.alane.fr";

  // Reuse existing Stripe Customer to avoid duplicates
  let existingCustomerId = null;
  if (userId && SUPABASE_URL && SERVICE_ROLE_KEY) {
    try {
      const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` };
      const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`, { headers: hdrs });
      if (profR.ok) {
        const profData = await profR.json();
        existingCustomerId = Array.isArray(profData) && profData[0]?.stripe_customer_id || null;
      }
    } catch {}
  }

  try {
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/?sub_success=1&plan=${plan}`,
      cancel_url:  `${origin}/?sub_cancel=1`,
      "metadata[plan]":    plan,
      "metadata[billing]": billing,
      "metadata[user_id]": userId || "",
      // Pass plan in subscription metadata so lifecycle webhooks can read it
      "subscription_data[metadata][plan]":    plan,
      "subscription_data[metadata][user_id]": userId || "",
    });
    if (userId) params.set("client_reference_id", userId);
    if (existingCustomerId) {
      params.set("customer", existingCustomerId);
    }

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await r.json();
    if (session.error) return res.status(400).json({ error: session.error.message });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("stripe-subscription error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
