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
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Config manquante" });

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const { action, subscription } = req.body || {};

  if (action === "subscribe") {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Subscription invalide" });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id:  caller.id,
        endpoint: subscription.endpoint,
        p256dh:   subscription.keys.p256dh,
        auth:     subscription.keys.auth,
      }),
    });
    return res.status(200).json({ success: true });
  }

  if (action === "unsubscribe") {
    if (!subscription?.endpoint) return res.status(400).json({ error: "Endpoint manquant" });
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${caller.id}&endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
      { method: "DELETE", headers }
    );
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Action invalide" });
}
