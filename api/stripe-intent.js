async function verifyUser(req, supabaseUrl, serviceRoleKey) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });
  if (STRIPE_SECRET_KEY.startsWith("pk_")) {
    return res.status(500).json({ error: "Configuration Stripe incorrecte : STRIPE_SECRET_KEY doit être la clé secrète (sk_test_... ou sk_live_...), pas la clé publique (pk_...). Corrigez dans Vercel → Settings → Environment Variables → STRIPE_SECRET_KEY." });
  }

  const stripeHeaders = {
    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const { action, amount, currency = "eur", description, metadata = {}, customerId: existingCustomerId, paymentMethodId } = req.body || {};

  // ── Enregistrer une carte (SetupIntent) ───────────────────────────
  if (action === "setup_card") {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE);
    if (!caller) return res.status(401).json({ error: "Non authentifié" });

    try {
      let customerId = existingCustomerId;
      if (!customerId) {
        const cr = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST",
          headers: stripeHeaders,
          body: new URLSearchParams({ email: caller.email || "", "metadata[supabase_id]": caller.id }),
        });
        const customer = await cr.json();
        if (customer.error) return res.status(400).json({ error: customer.error.message });
        customerId = customer.id;
      }
      const sir = await fetch("https://api.stripe.com/v1/setup_intents", {
        method: "POST",
        headers: stripeHeaders,
        body: new URLSearchParams({ customer: customerId, "payment_method_types[]": "card" }),
      });
      const si = await sir.json();
      if (si.error) return res.status(400).json({ error: si.error.message });
      return res.status(200).json({ clientSecret: si.client_secret, customerId });
    } catch (e) {
      return res.status(500).json({ error: "Erreur Stripe setup" });
    }
  }

  // ── Récupérer les détails d'un PaymentMethod ──────────────────────
  if (action === "get_pm") {
    const SUPABASE_URL_PM = process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE_PM = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const callerPm = await verifyUser(req, SUPABASE_URL_PM, SERVICE_ROLE_PM);
    if (!callerPm) return res.status(401).json({ error: "Non authentifié" });
    const { pmId } = req.body || {};
    if (!pmId) return res.status(400).json({ error: "pmId requis" });
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_methods/${pmId}`, { headers: stripeHeaders });
      const pm = await r.json();
      if (pm.error) return res.status(400).json({ error: pm.error.message });
      return res.status(200).json({ brand: pm.card?.brand || "card", last4: pm.card?.last4 || "••••" });
    } catch (e) {
      return res.status(500).json({ error: "Erreur récupération carte" });
    }
  }

  // ── Créer un PaymentIntent ────────────────────────────────────────
  const SUPABASE_URL_PI = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_PI = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const callerPi = await verifyUser(req, SUPABASE_URL_PI, SERVICE_ROLE_PI);
  if (!callerPi) return res.status(401).json({ error: "Non authentifié" });
  if (!amount || typeof amount !== "number" || amount <= 0) return res.status(400).json({ error: "Montant invalide — doit être un nombre positif" });
  if (amount < 1) return res.status(400).json({ error: "Montant invalide (min 1€)" });
  if (amount > 50000) return res.status(400).json({ error: "Montant invalide (max 50 000€)" });
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) return res.status(400).json({ error: "La description ne doit pas dépasser 500 caractères" });

  try {
    const params = {
      amount: String(Math.round(amount * 100)),
      currency,
      "automatic_payment_methods[enabled]": "true",
      "metadata[mission]":     metadata.mission     || "",
      "metadata[client]":      metadata.client      || "",
      "metadata[prestataire]": metadata.prestataire || "",
    };
    if (existingCustomerId) params.customer = existingCustomerId;

    const r = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: stripeHeaders,
      body: new URLSearchParams(params),
    });
    const intent = await r.json();
    if (intent.error) return res.status(400).json({ error: intent.error.message });
    return res.status(200).json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (e) {
    console.error("stripe-intent error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
