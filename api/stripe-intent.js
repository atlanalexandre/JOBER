export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });

  const { amount, currency = "eur", description, metadata = {} } = req.body || {};
  if (!amount || typeof amount !== "number" || amount <= 0) return res.status(400).json({ error: "Montant invalide — doit être un nombre positif" });
  if (amount < 1) return res.status(400).json({ error: "Montant invalide (min 1€)" });
  if (amount > 50000) return res.status(400).json({ error: "Montant invalide (max 50 000€)" });
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) return res.status(400).json({ error: "La description ne doit pas dépasser 500 caractères" });

  try {
    const r = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(Math.round(amount * 100)), // centimes
        currency,
        "automatic_payment_methods[enabled]": "true",
        "metadata[mission]":    metadata.mission    || "",
        "metadata[client]":     metadata.client     || "",
        "metadata[prestataire]":metadata.prestataire|| "",
      }),
    });
    const intent = await r.json();
    if (intent.error) return res.status(400).json({ error: intent.error.message });
    return res.status(200).json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (e) {
    console.error("stripe-intent error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
