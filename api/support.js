export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { subject, message, userEmail, userName, userId } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "Sujet et message requis" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY   = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL      = process.env.ADMIN_EMAIL;
  const RESEND_FROM      = process.env.RESEND_FROM || "onboarding@resend.dev";

  console.log("support.js — ADMIN_EMAIL:", ADMIN_EMAIL ? "set" : "missing", "| RESEND_API_KEY:", RESEND_API_KEY ? "set" : "missing");

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

    // Notify admin by email via Resend
    if (RESEND_API_KEY && ADMIN_EMAIL) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [ADMIN_EMAIL],
            subject: `[ALANE Support] ${subject}`,
            text: `Nouveau ticket support\n\nDe : ${userName||"Inconnu"} (${userEmail||"email inconnu"})\nSujet : ${subject}\n\nMessage :\n${message}`,
          }),
        });
        const emailData = await emailRes.json();
        console.log("Resend response:", JSON.stringify(emailData));
      } catch (emailErr) {
        console.error("Resend error:", emailErr);
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("support.js error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
