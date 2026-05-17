import crypto from "crypto";

function verifyBoToken(token, secret) {
  if (!token) return false;
  const [tsStr, sig] = token.split(".");
  if (!tsStr || !sig) return false;
  const ts = parseInt(tsStr, 10);
  if (Date.now() / 1000 - ts > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(tsStr).digest("hex");
  return expected === sig;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const BO_SECRET        = process.env.BO_SESSION_SECRET || "alane-bo-secret-change-me-in-vercel";
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const token = (req.headers["authorization"] || "").replace("Bearer ", "");
  if (!verifyBoToken(token, BO_SECRET)) return res.status(401).json({ error: "Non autorisé" });

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });

  const { paymentIntentId, missionId, reason } = req.body || {};
  if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId requis" });

  try {
    // Create refund via Stripe API
    const stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        payment_intent: paymentIntentId,
        reason: reason || "requested_by_customer",
      }).toString(),
    });

    const refundData = await stripeRes.json();
    if (!stripeRes.ok) {
      return res.status(400).json({ error: refundData.error?.message || "Erreur Stripe" });
    }

    // Update mission status to "refunded" if missionId provided
    if (missionId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
        method: "PATCH",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ status: "closed" }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, refundId: refundData.id, amount: refundData.amount });
  } catch (e) {
    console.error("stripe-refund error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
