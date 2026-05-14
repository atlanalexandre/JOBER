async function sendEmail({ to, subject, text }) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  if (!key) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
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
          await sendEmail({
            to: userEmail,
            subject: "Votre compte ALANE est activé !",
            text: `Bonjour,\n\nVotre compte ALANE a été validé par notre équipe. Vous pouvez maintenant vous connecter.\n\nhttps://www.alane.fr\n\nBienvenue sur ALANE !\nL'équipe ALANE`,
          });
        } else {
          await sendEmail({
            to: userEmail,
            subject: "Votre demande de compte ALANE",
            text: `Bonjour,\n\nNous avons examiné votre demande d'inscription mais ne pouvons pas l'activer pour le moment.\n\nPour plus d'informations, contactez notre support depuis l'application.\n\nL'équipe ALANE`,
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
        const reasonBlock = reason ? `\n\nRaison communiquée : ${reason}` : "";
        await sendEmail({
          to: userEmail,
          subject: "Votre compte ALANE a été supprimé",
          text: `Bonjour,\n\nNous vous informons que votre compte ALANE a été supprimé par notre équipe d'administration.${reasonBlock}\n\nSi vous pensez qu'il s'agit d'une erreur, vous pouvez nous contacter via le formulaire de support.\n\nL'équipe ALANE`,
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
