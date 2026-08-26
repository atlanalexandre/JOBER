import { resendBody } from "./_email.js";
import crypto from "crypto";
import { appUrl } from "./_url.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body || {};
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Email requis" });

  const normalizedEmail = email.trim().toLowerCase();
  const RESET_SECRET    = ((process.env.BO_SESSION_SECRET || "").replace(/\s/g, "") || "alane-reset-fallback").replace(/\s/g, "");
  const RESEND_KEY      = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
  const RESEND_FROM     = process.env.RESEND_FROM || "onboarding@resend.dev";
  const APP_URL         = appUrl();

  // Vérifier que l'email existe dans Supabase (sécurité silencieuse)
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    try {
      const check = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(normalizedEmail)}&page=1&per_page=1`,
        { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
      );
      if (check.ok) {
        const data = await check.json();
        const users = data?.users || [];
        if (users.length === 0) {
          // Email inexistant — répondre ok pour ne pas révéler l'existence du compte
          return res.status(200).json({ ok: true });
        }
      }
    } catch (e) {
      console.error("[forgot-password] user check error:", e);
    }
  }

  // Générer token HMAC : emailB64.timestamp.hmac
  const timestamp   = Date.now();
  const emailB64    = Buffer.from(normalizedEmail).toString("base64url");
  const hmac        = crypto.createHmac("sha256", RESET_SECRET)
    .update(`${normalizedEmail}:${timestamp}`)
    .digest("hex");
  const resetToken  = `${emailB64}.${timestamp}.${hmac}`;
  const resetUrl    = `${APP_URL}?reset_token=${resetToken}`;


  if (!RESEND_KEY) {
    console.error("[forgot-password] RESEND_API_KEY not set");
    return res.status(200).json({ ok: true });
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const html = `<!DOCTYPE html>
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
            <h2 style="font-size:20px;font-weight:800;margin:0 0 12px;color:#1a1a2e;">Réinitialisation de votre mot de passe</h2>
            <p style="margin:0 0 20px;color:#444;">Vous avez demandé à réinitialiser le mot de passe de votre compte <strong>ALANE</strong>.</p>
            <p style="margin:0 0 24px;color:#444;">Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${esc(resetUrl)}" style="display:inline-block;background:#7C6FE0;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">
                Réinitialiser mon mot de passe →
              </a>
            </div>
            <p style="margin:20px 0 0;font-size:12px;color:#999;text-align:center;">Ce lien est valable 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f4f7;padding:20px 36px;text-align:center;border-top:1px solid #e8e8f0;">
            <p style="margin:0;font-size:13px;color:#888;">L'équipe <strong>ALANE</strong> · <a href="${APP_URL}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: resendBody({
          from: RESEND_FROM,
          to: [normalizedEmail],
          subject: "Réinitialisation de votre mot de passe ALANE",
          html,
        }),
      });
      if (r.ok) break;
      const body = await r.text();
      console.error("[forgot-password] Resend error:", r.status, body);
      if (r.status < 500) break;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.error("[forgot-password] Resend fetch error:", e);
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return res.status(200).json({ ok: true });
}
