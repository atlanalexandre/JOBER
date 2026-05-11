export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { subject, message, userEmail, userName, userId } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "Sujet et message requis" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ subject, message, user_email: userEmail||null, user_name: userName||null, user_id: userId||null, status: "open" }),
    });

    if (!r.ok) {
      console.error("Supabase support error:", await r.text());
      return res.status(500).json({ error: "Impossible d'enregistrer le ticket" });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("support.js error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
