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
  if (req.method !== "GET") return res.status(405).end();

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "");
  const cronSecret  = process.env.CRON_SECRET;
  const boSecret    = process.env.BO_SESSION_SECRET || "alane-bo-secret-change-me-in-vercel";

  // Accept either CRON_SECRET or a valid BO session token
  const isCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const isBo   = verifyBoToken(token, boSecret);
  if (!isCron && !isBo) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {
    // Reset missions_completed_month pour tous les profils
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?missions_completed_month=gt.0`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0 }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("cron-reset-monthly error:", err);
      return res.status(500).json({ error: "Erreur reset" });
    }

    // Downgrade des abonnements expirés
    let downgrades = 0;
    try {
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
      const usersData = await usersRes.json();
      const users = usersData.users || [];
      const now = new Date();
      await Promise.all(users.map(async u => {
        const meta = u.user_metadata || {};
        if (meta.plan_abonnement && meta.plan_abonnement !== "free" && meta.subscription_end_date) {
          if (new Date(meta.subscription_end_date) < now) {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
              method: "PUT", headers,
              body: JSON.stringify({ user_metadata: { plan_abonnement: "free", subscription_end_date: null } }),
            }).catch(() => {});
            downgrades++;
          }
        }
      }));
    } catch {}

    console.log(`cron-reset-monthly: missions reset, ${downgrades} abonnements expirés downgradés`);
    return res.status(200).json({ success: true, downgrades });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
