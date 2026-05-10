export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { subject, message, userEmail, userName, userId } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: "Sujet et message requis" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const OWNER_EMAIL    = process.env.OWNER_EMAIL;

  if (!RESEND_API_KEY || !OWNER_EMAIL) {
    return res.status(500).json({ error: "Configuration email manquante" });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "JOBER Support <onboarding@resend.dev>",
        to:      [OWNER_EMAIL],
        reply_to: userEmail || undefined,
        subject: `[JOBER Support] ${subject}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#7C6FE0;margin-bottom:4px">Nouveau ticket support JOBER</h2>
            <hr style="border:1px solid #eee;margin:16px 0"/>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:6px 0;color:#666;width:120px">Utilisateur</td><td style="padding:6px 0;font-weight:600">${userName || "Anonyme"}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${userEmail || "Non renseigné"}</td></tr>
              <tr><td style="padding:6px 0;color:#666">ID</td><td style="padding:6px 0;font-size:12px;color:#999">${userId || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Sujet</td><td style="padding:6px 0;font-weight:600">${subject}</td></tr>
            </table>
            <div style="background:#f8f8f8;border-left:4px solid #7C6FE0;padding:16px;border-radius:4px;white-space:pre-wrap;line-height:1.6">${message}</div>
            <hr style="border:1px solid #eee;margin:20px 0"/>
            <p style="color:#999;font-size:12px;margin:0">Envoyé depuis l'app JOBER · ${new Date().toLocaleString("fr-FR")}</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Resend error:", err);
      return res.status(500).json({ error: "Erreur envoi email" });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Support handler error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
