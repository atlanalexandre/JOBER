import { emailHtml, esc, sendEmail } from "./_email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, redirectOrigin } = req.body || {};
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Email requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const appUrl = redirectOrigin || process.env.APP_URL || "https://www.alane.fr";

  // Générer le lien de reset via l'API admin Supabase
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "recovery",
      email: email.trim().toLowerCase(),
      options: { redirectTo: appUrl },
    }),
  });

  if (!linkRes.ok) {
    // Ne pas révéler si l'email existe ou non (sécurité)
    return res.status(200).json({ ok: true });
  }

  const linkData = await linkRes.json();
  const resetLink = linkData?.properties?.action_link;

  if (!resetLink) return res.status(200).json({ ok: true });

  const html = emailHtml(`
    <h2 style="font-size:20px;font-weight:800;margin:0 0 12px;color:#1a1a2e;">Réinitialisation de votre mot de passe</h2>
    <p style="margin:0 0 20px;color:#444;">Vous avez demandé à réinitialiser le mot de passe de votre compte <strong>ALANE</strong>.</p>
    <p style="margin:0 0 24px;color:#444;">Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${esc(resetLink)}" style="display:inline-block;background:#7C6FE0;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">
        Réinitialiser mon mot de passe →
      </a>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#999;text-align:center;">Ce lien est valable 24 heures. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
  `);

  await sendEmail({
    to: email.trim().toLowerCase(),
    subject: "Réinitialisation de votre mot de passe ALANE",
    html,
  });

  return res.status(200).json({ ok: true });
}
