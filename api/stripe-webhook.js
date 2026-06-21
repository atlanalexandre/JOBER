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

  // Vérification signature — obligatoire si STRIPE_WEBHOOK_SECRET est configuré
  if (STRIPE_WEBHOOK_SECRET) {
    if (!sig) return res.status(400).json({ error: "Signature manquante" });
    try {
      const crypto = await import("crypto");
      const [, tsStr, v1] = sig.match(/t=(\d+),v1=([a-f0-9]+)/) || [];
      if (!tsStr || !v1) return res.status(400).json({ error: "Signature invalide" });
      if (Math.abs(Date.now() / 1000 - parseInt(tsStr, 10)) > 300) return res.status(400).json({ error: "Timestamp expiré" });
      const payload  = `${tsStr}.${rawBody.toString()}`;
      const expected = crypto.default.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
      if (expected.length !== v1.length || !crypto.default.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"))) return res.status(400).json({ error: "Signature invalide" });
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

      // Opération critique : si Supabase est down, retourner 500 → Stripe retentera
      let missionPatch;
      try {
        missionPatch = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&status=not.in.(completed,closed,cancelled,refused,rejected)`, {
          method: "PATCH", headers, body: JSON.stringify(patch),
        });
      } catch (e) {
        console.error("stripe-webhook: Supabase down, Stripe will retry", e);
        return res.status(500).json({ error: "Supabase unavailable" });
      }
      if (!missionPatch.ok) {
        console.error("stripe-webhook: mission PATCH failed", missionPatch.status, await missionPatch.text());
        return res.status(500).json({ error: "Mission update failed" });
      }

      // Opérations secondaires : on ne bloque pas Stripe si elles échouent
      if (candidatureId) {
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "accepted" }),
        }).catch(e => console.error("candidature accept failed:", e));
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${missionId}&id=neq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "rejected" }),
        }).catch(e => console.error("candidature reject failed:", e));
        if (prestataireId) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers,
            body: JSON.stringify({ user_id: prestataireId, type: "mission", title: "Candidature acceptée ✅", body: "Votre candidature a été acceptée et le paiement confirmé. Préparez-vous pour la mission !", read: false }),
          }).catch(e => console.error("notification failed:", e));
        }
      }
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId  = session.metadata?.user_id || session.client_reference_id;
    const plan    = session.metadata?.plan;
    const billing = session.metadata?.billing || "monthly";
    if (userId && plan && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      };
      const daysToAdd = billing === "yearly" ? 365 : 30;
      const endDate = new Date(Date.now() + daysToAdd * 86400000).toISOString();
      try {
        // GET first to merge — PUT replaces entirely, so we must preserve existing metadata
        const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdrs });
        if (!getR.ok) {
          console.error("stripe-webhook: GET user failed before PUT, aborting to avoid metadata loss", getR.status);
          return res.status(500).json({ error: "User fetch failed" });
        }
        const existingUser = await getR.json();
        const existingMeta = existingUser.user_metadata || {};
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ user_metadata: { ...existingMeta, plan_abonnement: plan, subscription_end_date: endDate } }),
        });
        if (!r.ok) {
          console.error("stripe-webhook: user metadata update failed", r.status);
          return res.status(500).json({ error: "User update failed" });
        }
      } catch (e) {
        console.error("stripe-webhook: Supabase down on checkout.session.completed", e);
        return res.status(500).json({ error: "Supabase unavailable" });
      }
    }
  }

  return res.status(200).json({ received: true });
}
