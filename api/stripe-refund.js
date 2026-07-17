import crypto from "crypto";

function verifyBoToken(token, secret) {
  if (!token) return false;
  const parts = token.split(".");
  // Support new format (ts.nonce.sig) and legacy format (ts.sig)
  const tsStr = parts[0];
  const sig = parts.length >= 3 ? parts[2] : parts[1];
  const payload = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!tsStr || !sig) return false;
  const ts = parseInt(tsStr, 10);
  if (Date.now() / 1000 - ts > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  try {
    const sigBuf = Buffer.from(sig, "hex");
    if (expBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, sigBuf);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const BO_SECRET        = process.env.BO_SESSION_SECRET;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!BO_SECRET) return res.status(500).json({ error: "BO_SESSION_SECRET non configuré" });

  const token = (req.headers["authorization"] || "").replace("Bearer ", "");
  if (!verifyBoToken(token, BO_SECRET)) return res.status(401).json({ error: "Non autorisé" });

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });

  const { paymentIntentId, missionId, reason } = req.body || {};
  if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId requis" });
  if (!missionId) return res.status(400).json({ error: "missionId requis" });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Supabase non configuré" });

  // S-06: cross-check missionId ↔ paymentIntentId to prevent cross-mission refund (mandatory)
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&select=stripe_payment_intent`,
    { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
  ).catch(() => null);
  if (!checkRes?.ok) return res.status(500).json({ error: "Impossible de vérifier la mission" });
  const checkData = await checkRes.json().catch(() => []);
  const missionCheck = Array.isArray(checkData) && checkData[0];
  if (!missionCheck) return res.status(404).json({ error: "Mission introuvable" });
  if (!missionCheck.stripe_payment_intent) {
    return res.status(400).json({ error: "Aucun paiement Stripe enregistré pour cette mission" });
  }
  if (missionCheck.stripe_payment_intent !== paymentIntentId) {
    return res.status(400).json({ error: "paymentIntentId ne correspond pas à cette mission" });
  }

  // Fetch stripe_transfer_id before refunding so we can reverse the payout to the prestataire
  let stripeTransferId = null;
  const trRes = await fetch(
    `${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&select=stripe_transfer_id`,
    { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
  ).catch(() => null);
  if (trRes?.ok) {
    const trData = await trRes.json().catch(() => []);
    stripeTransferId = Array.isArray(trData) && trData[0]?.stripe_transfer_id || null;
  }

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

    // Reverse the Connect transfer to the prestataire if one was made
    let transferReversalId = null;
    let transferReversalFailed = false;
    if (stripeTransferId) {
      try {
        const revRes = await fetch(`https://api.stripe.com/v1/transfers/${stripeTransferId}/reversals`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        });
        const revData = await revRes.json();
        if (revRes.ok) {
          transferReversalId = revData.id;
          console.log(`[stripe-refund] Transfer ${stripeTransferId} reversed → ${transferReversalId}`);
        } else {
          console.error("[stripe-refund] Transfer reversal failed:", revData.error?.message);
          transferReversalFailed = true;
        }
      } catch (revErr) {
        console.error("[stripe-refund] Transfer reversal error:", revErr.message);
        transferReversalFailed = true;
      }
    }

    // Update mission status to closed
    {
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

    return res.status(200).json({ ok: true, refundId: refundData.id, amount: refundData.amount, transferReversalId, transferReversalFailed: transferReversalFailed || undefined });
  } catch (e) {
    console.error("stripe-refund error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
