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
  if (req.method !== "POST") return res.status(405).end();

  const { prenom, nom, email, role } = req.body || {};
  if (!prenom || !nom || !email || !role) return res.status(400).json({ error: "Missing fields" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

  console.log("notify-admin — RESEND_API_KEY:", RESEND_API_KEY ? "set" : "MISSING");
  console.log("notify-admin — RESEND_FROM:", RESEND_FROM || "MISSING");
  console.log("notify-admin — ADMIN_EMAIL:", ADMIN_EMAIL || "MISSING");

  if (!RESEND_API_KEY || !ADMIN_EMAIL || !RESEND_FROM) {
    console.error("notify-admin — variables manquantes, email non envoyé");
    return res.status(200).json({ ok: true, warning: "email skipped, missing env vars" });
  }

  const roleLabel = role === "prestataire" ? "Prestataire" : "Client";

  const html = emailHtml(`
    <p>Un nouveau compte est en attente de validation.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">Nom</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(prenom)} ${esc(nom)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(email)}</td></tr>
      <tr><td style="padding:8px 0;color:#888;">Rôle</td><td style="padding:8px 0;"><span style="background:${role === "prestataire" ? "#7C6FE020" : "#F0B42920"};color:${role === "prestataire" ? "#7C6FE0" : "#F0B429"};padding:3px 10px;border-radius:20px;font-size:13px;font-weight:700;">${esc(roleLabel)}</span></td></tr>
    </table>
    <p style="text-align:center;margin:24px 0;"><a href="https://www.alane.fr" style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder au backoffice</a></p>
  `);

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [ADMIN_EMAIL],
        subject: `Nouvelle inscription ${roleLabel} — ${prenom} ${nom}`,
        html,
      }),
    });
    const result = await r.text();
    console.log("notify-admin — Resend status:", r.status, "| response:", result);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-admin — fetch error:", e);
    return res.status(200).json({ ok: true, warning: "email failed" });
  }
}
