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

async function sendEmail({ to, subject, html }) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!key) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    console.log("Resend bo-action:", await r.text());
  } catch (e) {
    console.error("sendEmail error:", e);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, profileId } = req.body;
  const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    if (action === "list") {
      const [profilesRes, authRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,role,prenom,nom,status,created_at&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers }),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();
      const authUsers = authData.users || [];
      const merged = (Array.isArray(profiles) ? profiles : []).map(p => {
        const u = authUsers.find(u => u.id === p.id) || {};
        return {
          ...p,
          email:       u.email || "",
          rib:         u.user_metadata?.rib || "",
          kbis:        u.user_metadata?.kbis || "",
          societe_nom: u.user_metadata?.societe_nom || "",
          type_compte: u.user_metadata?.type_compte || "",
          telephone:   u.user_metadata?.telephone || "",
        };
      });
      return res.status(200).json(merged);
    }

    if (action === "approve" || action === "reject") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const status = action === "approve" ? "approved" : "rejected";
      const [patchRes, userRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ status }),
        }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers }),
      ]);
      if (!patchRes.ok) return res.status(500).json({ error: "Erreur mise à jour" });

      const userData = await userRes.json();
      const userEmail = userData.email;
      if (userEmail) {
        if (status === "approved") {
          const prenom = userData.user_metadata?.prenom || "";
          await sendEmail({
            to: userEmail,
            subject: "Bienvenue sur ALANE — Votre compte est activé ! 🎉",
            html: emailHtml(`
              <p>Bonjour${prenom ? ` <strong>${prenom}</strong>` : ""},</p>
              <p>Bonne nouvelle ! 🎉 Votre compte <strong>ALANE</strong> a été validé par notre équipe.</p>
              <p>Nous sommes ravis de vous accueillir sur la plateforme. Vous pouvez dès maintenant vous connecter et commencer à utiliser ALANE.</p>
              <p>Si vous avez la moindre question ou besoin d'aide pour démarrer, n'hésitez pas à contacter notre support directement depuis l'application — nous sommes là pour vous accompagner.</p>
              <p style="text-align:center;margin:28px 0;"><a href="https://www.alane.fr" style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder à ALANE →</a></p>
              <p style="color:#888;font-size:13px;">À très vite sur la plateforme,<br/>L'équipe ALANE</p>
            `),
          });
        } else {
          await sendEmail({
            to: userEmail,
            subject: "Votre demande de compte ALANE",
            html: emailHtml(`<p>Bonjour,</p><p>Nous avons examiné votre demande d'inscription mais ne sommes pas en mesure de l'activer pour le moment.</p><p>Pour plus d'informations, n'hésitez pas à contacter notre support depuis l'application.</p>`),
          });
        }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "delete") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const reason = req.body.reason || "";

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;

      if (userEmail) {
        const reasonBlock = reason ? `<p><strong>Raison communiquée :</strong> ${reason}</p>` : "";
        await sendEmail({
          to: userEmail,
          subject: "Votre compte ALANE a été supprimé",
          html: emailHtml(`<p>Bonjour,</p><p>Nous vous informons que votre compte <strong>ALANE</strong> a été supprimé par notre équipe d'administration.</p>${reasonBlock}<p>Si vous pensez qu'il s'agit d'une erreur, contactez notre support depuis l'application.</p>`),
        });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
        method: "DELETE",
        headers,
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur suppression compte auth" });
      return res.status(200).json({ success: true });
    }

    if (action === "list_tickets") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?select=*&order=created_at.desc`, { headers });
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (action === "close_ticket") {
      if (!profileId) return res.status(400).json({ error: "ticketId requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("bo-action error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
