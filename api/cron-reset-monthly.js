export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // Vercel cron jobs call with GET; optionally verify the secret header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
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

    console.log("cron-reset-monthly: missions_completed_month reset to 0 for all profiles");
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
