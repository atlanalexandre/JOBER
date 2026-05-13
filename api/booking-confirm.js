export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientEmail, clientName, prestaName, date, hours, total, job } = req.body || {};

  if (!clientEmail) {
    return res.status(200).json({ ok: false, reason: "no email" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM || "onboarding@resend.dev";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Confirmation de réservation ALANE</title>
</head>
<body style="margin:0;padding:0;background:#0A1628;font-family:'DM Sans',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:32px 28px 24px;text-align:center;">
              <div style="font-size:42px;margin-bottom:10px;">✅</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 6px;">Réservation confirmée !</h1>
              <p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;">Votre mission a bien été enregistrée</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px;">
              <p style="color:#F0F0F5;font-size:15px;margin:0 0 20px;">Bonjour <strong>${clientName || "cher client"}</strong>,</p>
              <p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 24px;">
                Votre paiement a été sécurisé sur ALANE. Retrouvez ci-dessous le récapitulatif de votre mission.
              </p>

              <!-- Mission card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#162547;border-radius:14px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(124,111,224,0.25);">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="color:#7C6FE0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 14px;">Détails de la mission</p>
                    ${[
                      ["👤 Prestataire", prestaName || "À confirmer"],
                      ["💼 Poste",        job         || "—"],
                      ["📅 Date",         date        || "—"],
                      ["⏱️ Durée",        hours ? `${hours}h` : "—"],
                      ["💶 Total bloqué", total ? `${total} €` : "—"],
                    ].map(([label, value]) => `
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                      <tr>
                        <td style="color:#8B8FA8;font-size:13px;width:48%;">${label}</td>
                        <td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${value}</td>
                      </tr>
                    </table>`).join("")}
                  </td>
                </tr>
              </table>

              <!-- Escrow notice -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(16,217,143,0.10);border:1px solid rgba(16,217,143,0.30);border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="color:#10D98F;font-size:13px;font-weight:600;margin:0;">
                      🔒 Votre argent est sécurisé en escrow et ne sera libéré qu'après validation mutuelle de la mission.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Steps -->
              <p style="color:#8B8FA8;font-size:13px;margin:0 0 10px;font-weight:700;">Prochaines étapes</p>
              ${[
                ["1", "Le prestataire reçoit la notification et confirme sa présence"],
                ["2", "Vous recevez le contrat de mission pour signature"],
                ["3", "Après la mission, validez pour libérer le paiement"],
              ].map(([n, text]) => `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>
                  <td style="width:28px;vertical-align:top;">
                    <div style="width:22px;height:22px;border-radius:50%;background:#7C6FE0;color:#fff;font-size:11px;font-weight:800;text-align:center;line-height:22px;">${n}</div>
                  </td>
                  <td style="padding-left:10px;color:#8B8FA8;font-size:13px;vertical-align:middle;">${text}</td>
                </tr>
              </table>`).join("")}

              <div style="text-align:center;margin-top:28px;">
                <a href="https://alane-delta.vercel.app" style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;">
                  Suivre ma mission →
                </a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
              <p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="https://alane-delta.vercel.app" style="color:#7C6FE0;text-decoration:none;">alane-delta.vercel.app</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  try {
    if (RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [clientEmail],
          subject: `✅ Réservation confirmée — ${job || "Mission"} · ALANE`,
          html,
        }),
      });
      const txt = await r.text();
      console.log("booking-confirm Resend:", r.status, txt);
    } else {
      console.log("booking-confirm: no RESEND_API_KEY, skipping email");
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("booking-confirm error:", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
