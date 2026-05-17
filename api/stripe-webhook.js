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
    const intent        = event.data.object;
    const missionId     = intent.metadata?.mission;
    const candidatureId = intent.metadata?.candidature_id;
    const prestataireId = intent.metadata?.prestataire_id;
    if (missionId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const headers = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
      };
      const patch = { stripe_payment_intent: intent.id, status: "assigned" };
      if (prestataireId) patch.prestataire_id = prestataireId;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      }).catch(() => {});
      // Accepter la candidature + rejeter les autres
      if (candidatureId) {
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "accepted" }),
        }).catch(() => {});
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${missionId}&id=neq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "rejected" }),
        }).catch(() => {});
        // Notifier le prestataire
        if (prestataireId) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers,
            body: JSON.stringify({ user_id: prestataireId, type: "mission", title: "Candidature acceptée ✅", body: "Votre candidature a été acceptée et le paiement confirmé. Préparez-vous pour la mission !", read: false }),
          }).catch(() => {});
        }
      }
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId  = session.metadata?.user_id || session.client_reference_id;
    const plan    = session.metadata?.plan;
    if (userId && plan && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      };
      // Update user_metadata plan via admin API
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers: hdrs,
        body: JSON.stringify({ user_metadata: { plan_abonnement: plan } }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ received: true });
}
