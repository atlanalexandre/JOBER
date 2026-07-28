import { verifyUser } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });
  if (STRIPE_SECRET_KEY.startsWith("pk_")) return res.status(500).json({ error: "STRIPE_SECRET_KEY incorrecte" });

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });

  const { amount } = req.body || {};
  if (!amount || typeof amount !== "number" || amount < 10 || amount > 1000) {
    return res.status(400).json({ error: "Montant invalide (10 € – 1 000 €)" });
  }

  try {
    const params = new URLSearchParams({
      "amount":                 String(Math.round(amount * 100)),
      "currency":               "eur",
      "payment_method_types[]": "card",
      "metadata[type]":         "wallet_topup",
      "metadata[user_id]":      caller.id,
      "metadata[amount_euros]": String(amount),
    });

    const r = await fetch("https://api.stripe.com/v1/payment_intents", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const intent = await r.json();
    if (intent.error) return res.status(400).json({ error: intent.error.message });
    return res.status(200).json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (e) {
    console.error("stripe-wallet-topup error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
