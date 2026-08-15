import { verifyUser } from "./_auth.js";

// ═══════════════════════════════════════════════════════════════════════════
// RECHARGEMENT SUSPENDU — décision du 14/08/2026
// ═══════════════════════════════════════════════════════════════════════════
//
// Le portefeuille prépayé reçoit des fonds du public, sans terme, et sert à
// payer des tiers. Sa qualification n'est pas assurée : monnaie électronique au
// sens de l'article L.315-1 du Code monétaire et financier, avoir commercial, ou
// autre chose. Le conseil juridique place la suspension du rechargement en tête
// de ses recommandations, avant même l'immatriculation de la société.
//
// La suspension est volontairement écrite ICI, en dur, et non dans un réglage du
// backoffice : rouvrir doit être une décision relue, pas un clic.
//
// Ce qui n'est PAS suspendu : payer une prestation avec un solde existant, le
// cashback, et le paiement par carte. Seul l'ajout d'argent est fermé.
//
// POUR ROUVRIR, une fois la qualification tranchée : passer cette constante à
// `false`, et vérifier au préalable que les CGPS décrivent le portefeuille —
// conditions de remboursement et délai compris.
const RECHARGEMENT_SUSPENDU = true;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  if (RECHARGEMENT_SUSPENDU) {
    return res.status(503).json({
      error: "Le rechargement du portefeuille est momentanément suspendu. "
           + "Votre solde reste utilisable pour régler vos prestations, et vous pouvez "
           + "en demander le remboursement depuis votre portefeuille.",
    });
  }

  const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

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
