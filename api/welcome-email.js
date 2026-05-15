export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { email, prenom, nom, role } = req.body || {};
  if (!email || !prenom) return res.status(400).json({ error: "Missing fields" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM;
  if (!RESEND_API_KEY || !RESEND_FROM) return res.status(200).json({ ok: true });

  const isPresta = role === "prestataire";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,Helvetica Neue,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="background:#050E20;padding:28px 36px;text-align:center;">
          <span style="font-size:28px;font-weight:800;letter-spacing:2px;">
            <span style="color:#7C6FE0;">A</span><span style="color:#ffffff;">LAN</span><span style="color:#F0B429;">E</span>
          </span>
        </td></tr>
        <tr><td style="padding:36px;color:#1a1a2e;font-size:15px;line-height:1.7;">
          <p>Bonjour <strong>${prenom}</strong>,</p>
          <p>Votre inscription sur <strong>ALANE</strong> a bien été reçue. ${isPresta ? "Notre équipe va examiner votre dossier et vous enverrons un email dès validation de votre compte (généralement sous 24h)." : "Notre équipe va valider votre compte et vous enverrons un email dès approbation."}</p>
          <p>En attendant, si vous avez des questions, n'hésitez pas à contacter notre support.</p>
          <p>À très bientôt,<br/><strong>L'équipe ALANE</strong></p>
        </td></tr>
        <tr><td style="background:#f4f4f7;padding:20px 36px;text-align:center;border-top:1px solid #e8e8f0;">
          <p style="margin:0;font-size:13px;color:#888;">L'équipe <strong>ALANE</strong> · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: [email], subject: `Bienvenue sur ALANE, ${prenom} !`, html }),
    });
  } catch(_) {}
  return res.status(200).json({ ok: true });
}
