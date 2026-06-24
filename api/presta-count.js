export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(200).json({ count: null });
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
      {
        method: "HEAD",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Prefer": "count=exact",
        },
      }
    );
    const countHeader = r.headers.get("content-range");
    const count = countHeader ? parseInt(countHeader.split("/")[1], 10) : null;
    return res.status(200).json({ count: isNaN(count) ? null : count });
  } catch {
    return res.status(200).json({ count: null });
  }
}
