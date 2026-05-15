function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

function emailHtml(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Helvetica Neue,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <tr>
          <td style="background:#050E20;padding:28px 36px;text-align:center;">
            <span style="font-size:28px;font-weight:800;letter-spacing:2px;">
              <span style="color:#7C6FE0;">A</span><span style="color:#ffffff;">LAN</span><span style="color:#F0B429;">E</span>
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;color:#1a1a2e;font-size:15px;line-height:1.7;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="background:#f4f4f7;padding:20px 36px;text-align:center;border-top:1px solid #e8e8f0;">
            <p style="margin:0;font-size:13px;color:#888;">L'équipe <strong>ALANE</strong> · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

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
            subject: `[Support] ${subject}`,
            html: emailHtml(`
              <p>Nouveau ticket support reçu.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">De</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(userName)||"Inconnu"} (${esc(userEmail)||"email inconnu"})</td></tr>
                <tr><td style="padding:8px 0;color:#888;">Sujet</td><td style="padding:8px 0;font-weight:600;">${esc(subject)}</td></tr>
              </table>
              <div style="background:#f8f8fb;border-left:3px solid #7C6FE0;padding:14px 16px;border-radius:0 8px 8px 0;margin-top:16px;white-space:pre-wrap;">${esc(message)}</div>
            `),
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
