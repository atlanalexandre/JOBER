import crypto from "crypto";
import { rembourserDepuisLeBO, versementAAnnuler } from "./_remboursement_bo.js";
import { restituerCashback } from "./_cashback.js";

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

  const BO_SECRET        = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
  const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!BO_SECRET) return res.status(500).json({ error: "BO_SESSION_SECRET non configuré" });

  const token = (req.headers["authorization"] || "").replace("Bearer ", "");
  if (!verifyBoToken(token, BO_SECRET)) return res.status(401).json({ error: "Non autorisé" });

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });

  // `reason` était transmis tel quel à Stripe, qui refuse tout motif inconnu :
  // le motif est désormais fixé par rembourserDepuisLeBO().
  const { paymentIntentId, missionId } = req.body || {};
  if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId requis" });
  if (!missionId) return res.status(400).json({ error: "missionId requis" });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Supabase non configuré" });

  // S-06: cross-check missionId ↔ paymentIntentId to prevent cross-mission refund (mandatory)
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&select=stripe_payment_intent`,
    { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
  ).catch(() => null);
  if (!checkRes?.ok) return res.status(500).json({ error: "Impossible de vérifier la prestation" });
  const checkData = await checkRes.json().catch(() => []);
  const missionCheck = Array.isArray(checkData) && checkData[0];
  if (!missionCheck) return res.status(404).json({ error: "Prestation introuvable" });
  if (!missionCheck.stripe_payment_intent) {
    return res.status(400).json({ error: "Aucun paiement Stripe enregistré pour cette prestation" });
  }
  if (missionCheck.stripe_payment_intent !== paymentIntentId) {
    return res.status(400).json({ error: "paymentIntentId ne correspond pas à cette prestation" });
  }

  // Même règle que « Rembourser » et « Annuler » du back-office
  // (api/_remboursement_bo.js). Ce chemin remboursait D'ABORD, puis tentait de
  // reprendre le virement du prestataire : si la reprise échouait, le client
  // était remboursé et le prestataire gardait son virement — ALANE payait deux
  // fois. Il ne rendait pas non plus le cashback (relecture du 30/09/2026).
  let lignePaiement = null;
  const trRes = await fetch(
    `${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&select=id,client_id,stripe_payment_intent,payout_status,stripe_transfer_id`,
    { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
  ).catch(() => null);
  if (trRes?.ok) lignePaiement = (await trRes.json().catch(() => []))[0] || null;
  if (!lignePaiement) return res.status(500).json({ error: "Impossible de relire la prestation : rien n'a été remboursé." });

  try {
    const rb = await rembourserDepuisLeBO(lignePaiement, "stripe-refund");
    if (!rb.ok) return res.status(rb.code).json({ error: rb.message });
    await restituerCashback(lignePaiement, SUPABASE_URL,
      { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }, "stripe-refund");
    const annulerVersement = versementAAnnuler(lignePaiement) || rb.virementRepris;

    // Clôture de la prestation.
    //
    // Le remboursement — et le cas échéant l'annulation du virement — sont déjà
    // partis à ce stade. Le résultat de cette écriture n'était pas vérifié : si
    // elle échouait, la prestation restait ouverte, se clôturait normalement à
    // son terme, et le prestataire était payé sur un montant déjà rendu au
    // client. C'est exactement ce que faisait `cancellation_reason`.
    {
      const rc = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
        method: "PATCH",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ status: "closed", ...(annulerVersement ? { payout_status: "annule" } : {}) }),
      }).catch(e => { console.error("[stripe-refund] clôture impossible :", e.message); return null; });
      const lc = rc ? await rc.json().catch(() => []) : null;
      if (!rc || !rc.ok || !Array.isArray(lc) || lc.length === 0) {
        console.error(`[stripe-refund] prestation ${missionId} REMBOURSÉE mais NON close (${rc?.status}) `
          + "— elle se clôturera d'elle-même et le prestataire sera payé. À reprendre à la main.");
        return res.status(500).json({
          error: "Le remboursement est parti, mais la prestation n'a pas pu être close. "
               + "Reprenez-la à la main avant qu'elle ne se clôture d'elle-même.",
        });
      }
    }

    return res.status(200).json({ ok: true, refundId: rb.refundId, transferReversed: rb.virementRepris || undefined });
  } catch (e) {
    console.error("stripe-refund error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
