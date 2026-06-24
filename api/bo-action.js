import crypto from "crypto";

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

function verifyBoToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const secret = process.env.BO_SESSION_SECRET;
  if (!secret) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const ts  = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > 86400) return false; // expire après 24h
  const expected = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}

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
            <p style="margin:0;font-size:13px;color:#888;">L'équipe <strong>ALANE</strong> · <a href='${process.env.APP_URL||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
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
    if (!r.ok) { const body = await r.text(); console.error("Resend bo-action error:", r.status, body); }
  } catch (e) {
    console.error("sendEmail error:", e);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Vérification du token BO signé
  if (!verifyBoToken(req.headers["authorization"] || "")) {
    return res.status(401).json({ error: "Non autorisé — token BO invalide ou expiré" });
  }

  const { action, profileId, ...payload } = req.body;
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
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,role,prenom,nom,status,missions_enabled,created_at&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();
      const authUsers = authData.users || [];
      const merged = (Array.isArray(profiles) ? profiles : []).map(p => {
        const u = authUsers.find(u => u.id === p.id) || {};
        return {
          ...p,
          email: u.email || "",
          ...(u.user_metadata || {}),
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

      // Anti-abus à l'approbation : vérifier si les identifiants du nouveau compte
      // correspondent à un compte précédemment supprimé
      if (action === "approve") {
        const meta2 = userData.user_metadata || {};
        const tel2  = meta2.telephone || null;
        const iban2 = meta2.rib ? String(meta2.rib).replace(/\s/g, "").toUpperCase() : null;
        const siret2 = meta2.kbis || null;
        const orFilters = [];
        if (userEmail) orFilters.push(`email.eq.${encodeURIComponent(userEmail)}`);
        if (tel2)     orFilters.push(`telephone.eq.${encodeURIComponent(tel2)}`);
        if (iban2)    orFilters.push(`iban.eq.${encodeURIComponent(iban2)}`);
        if (siret2)   orFilters.push(`siret.eq.${encodeURIComponent(siret2)}`);
        if (orFilters.length > 0) {
          const blRes = await fetch(
            `${SUPABASE_URL}/rest/v1/account_blacklist?or=(${orFilters.join(",")})&select=id&limit=1`,
            { headers }
          );
          const blData = await blRes.json();
          if (Array.isArray(blData) && blData.length > 0) {
            // Match trouvé : marquer le profil comme trial épuisé
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ trial_exhausted: true }),
            }).catch(() => {});
          }
        }
      }

      if (userEmail) {
        if (status === "approved") {
          const prenom = userData.user_metadata?.prenom || "";
          await sendEmail({
            to: userEmail,
            subject: "Bienvenue sur ALANE — Votre compte est activé ! 🎉",
            html: emailHtml(`
              <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
              <p>Bonne nouvelle ! 🎉 Votre compte <strong>ALANE</strong> a été validé par notre équipe.</p>
              <p>Nous sommes ravis de vous accueillir sur la plateforme. Vous pouvez dès maintenant vous connecter et commencer à utiliser ALANE.</p>
              <p>Si vous avez la moindre question ou besoin d'aide pour démarrer, n'hésitez pas à contacter notre support directement depuis l'application — nous sommes là pour vous accompagner.</p>
              <p style="text-align:center;margin:28px 0;"><a href='${process.env.APP_URL||"https://www.alane.fr"}' style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder à ALANE →</a></p>
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

      // Log action BO
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId, target_email: userEmail || null }),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    if (action === "enable_missions" || action === "disable_missions") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const enabled = action === "enable_missions";

      const [patchRes, userRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ missions_enabled: enabled }),
        }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers }),
      ]);
      if (!patchRes.ok) return res.status(500).json({ error: "Erreur mise à jour" });

      if (enabled) {
        const userData = await userRes.json();
        const userEmail = userData.email;
        const prenom = userData.user_metadata?.prenom || "";
        if (userEmail) {
          await sendEmail({
            to: userEmail,
            subject: "✅ Accès aux missions activé — ALANE",
            html: emailHtml(`
              <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
              <p>Bonne nouvelle ! 🎉 Vos documents ont été validés par notre équipe.</p>
              <p>Vous avez maintenant <strong>accès aux missions</strong> sur la plateforme ALANE. Les clients peuvent désormais vous contacter directement.</p>
              <p style="text-align:center;margin:28px 0;"><a href='${process.env.APP_URL||"https://www.alane.fr"}' style="background:#10D98F;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Voir les missions →</a></p>
              <p style="color:#888;font-size:13px;">À très vite,<br/>L'équipe ALANE</p>
            `),
          });
        }

        // Notification in-app
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: profileId,
            type: "mission",
            title: "Accès aux missions activé ✅",
            body: "Vos documents ont été validés. Vous pouvez maintenant recevoir des missions via ALANE !",
            read: false,
          }),
        }).catch(() => {});
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId }),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    if (action === "delete") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const reason = req.body.reason || "";

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;

      if (userEmail) {
        const reasonBlock = reason ? `<p><strong>Raison communiquée :</strong> ${esc(reason)}</p>` : "";
        await sendEmail({
          to: userEmail,
          subject: "Votre compte ALANE a été supprimé",
          html: emailHtml(`<p>Bonjour,</p><p>Nous vous informons que votre compte <strong>ALANE</strong> a été supprimé par notre équipe d'administration.</p>${reasonBlock}<p>Si vous pensez qu'il s'agit d'une erreur, contactez notre support depuis l'application.</p>`),
        });
      }

      // Log suppression BO
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "delete", target_id: profileId, target_email: userEmail || null, reason: reason || null }),
      }).catch(() => {});

      // Anti-abus : sauvegarder les identifiants dans le blacklist pour bloquer la recréation de compte
      // Récupérer téléphone, IBAN, SIRET depuis user_metadata
      const meta = userData.user_metadata || {};
      const telephone = meta.telephone || null;
      const iban      = meta.rib ? String(meta.rib).replace(/\s/g, "").toUpperCase() : null;
      const siret     = meta.kbis || null;
      if (userEmail || telephone || iban || siret) {
        await fetch(`${SUPABASE_URL}/rest/v1/account_blacklist`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            email:     userEmail || null,
            telephone: telephone,
            iban:      iban,
            siret:     siret,
            reason:    reason ? `account_deleted: ${reason}` : "account_deleted",
          }),
        }).catch(() => {});
      }

      // Cascade: supprimer toutes les données liées avant de supprimer le compte
      await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/missions?or=(client_id.eq.${profileId},prestataire_id.eq.${profileId})`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?user_id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });

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

    if (action === "stats") {
      const [profilesRes, missionsRes, ticketsRes, recentRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role,status,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?select=status,sector,montant_total,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/support_tickets?select=status`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=prenom,nom,role,status,created_at&order=created_at.desc&limit=6`, { headers }),
      ]);

      const profiles  = await profilesRes.json();
      const missions  = await missionsRes.json();
      const tickets   = await ticketsRes.json();
      const recent    = await recentRes.json();

      const p = Array.isArray(profiles) ? profiles : [];
      const m = Array.isArray(missions) ? missions : [];
      const t = Array.isArray(tickets)  ? tickets  : [];
      const r = Array.isArray(recent)   ? recent   : [];

      const clients      = p.filter(x => x.role === "client").length;
      const prestataires = p.filter(x => x.role === "prestataire").length;
      const pending      = p.filter(x => x.status === "pending").length;

      const mOpen      = m.filter(x => x.status === "open").length;
      const mAssigned  = m.filter(x => x.status === "assigned").length;
      const mCompleted = m.filter(x => x.status === "completed").length;
      const mClosed    = m.filter(x => x.status === "closed").length;
      const mTotal     = m.length;
      const tauxCompletion = mTotal > 0 ? Math.round((mCompleted / mTotal) * 100) : 0;
      const caTotal    = m.filter(x => x.status === "completed")
        .reduce((acc, x) => acc + (Number(x.montant_total) || 0), 0);
      const caMoyen    = mCompleted > 0 ? Math.round((caTotal / mCompleted) * 100) / 100 : 0;

      const ticketsOpen = t.filter(x => x.status === "open").length;

      // Missions par secteur
      const sectorMap = {};
      m.forEach(x => {
        if (!x.sector) return;
        sectorMap[x.sector] = (sectorMap[x.sector] || 0) + 1;
      });
      const sectorTotal = Object.values(sectorMap).reduce((a,b)=>a+b, 0) || 1;
      const SECTOR_META = {
        logistique:   { label:"Logistique",   icon:"📦", color:"#81C784" },
        btp:          { label:"BTP",           icon:"🏗️", color:"#FF8A65" },
        restauration: { label:"Restauration",  icon:"🍽️", color:"#F06292" },
        proprete:     { label:"Propreté",      icon:"🧹", color:"#4FC3F7" },
        commercial:   { label:"Commercial",    icon:"💼", color:"#BA68C8" },
        hotellerie:   { label:"Hôtellerie",    icon:"🏨", color:"#FFB74D" },
        distribution: { label:"Distribution",  icon:"🛒", color:"#4DB6AC" },
        divers:       { label:"Divers",        icon:"✨", color:"#7986CB" },
      };
      const sectors = Object.entries(sectorMap)
        .sort((a,b) => b[1]-a[1])
        .map(([id, count]) => ({
          id, ...SECTOR_META[id],
          missions: count,
          pct: Math.round((count / sectorTotal) * 100),
        }));

      // Monthly time-series (last 6 months)
      const now = new Date();
      const last6months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return d.toISOString().slice(0, 7);
      });
      const signupsByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      const missionsByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      const caByMonth = Object.fromEntries(last6months.map(mo => [mo, 0]));
      p.forEach(x => {
        const mo = x.created_at?.slice(0, 7);
        if (mo && signupsByMonth[mo] !== undefined) signupsByMonth[mo]++;
      });
      m.forEach(x => {
        const mo = x.created_at?.slice(0, 7);
        if (mo && missionsByMonth[mo] !== undefined) {
          missionsByMonth[mo]++;
          if (x.status === "completed") caByMonth[mo] = (caByMonth[mo] || 0) + (Number(x.montant_total) || 0);
        }
      });
      const monthLabels = last6months.map(mo => {
        const [y, mIdx] = mo.split("-");
        return new Date(Number(y), Number(mIdx) - 1, 1).toLocaleDateString("fr-FR", { month:"short" });
      });

      return res.status(200).json({
        users:        { clients, prestataires, total: clients + prestataires, pending },
        missions:     { total: mTotal, open: mOpen, assigned: mAssigned, terminees: mCompleted, closed: mClosed, tauxCompletion },
        finance:      { caTotal: Math.round(caTotal * 100) / 100, caMoyen },
        tickets:      { open: ticketsOpen, total: t.length },
        sectors,
        recentUsers:  r,
        signupsByMonth,
        missionsByMonth,
        caByMonth,
        monthLabels,
      });
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

    if (action === "delete_ticket") {
      if (!profileId) return res.status(400).json({ error: "ticketId requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${profileId}`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur suppression ticket" });
      return res.status(200).json({ success: true });
    }

    if (action === "send_global_comm") {
      const message = req.body.message || "";
      if (!message.trim()) return res.status(400).json({ error: "Message requis" });

      // Récupérer tous les prestataires approuvés
      const [profilesRes, authRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&role=eq.prestataire&status=eq.approved`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();
      const authUsers = authData.users || [];
      const ids = new Set((Array.isArray(profiles) ? profiles : []).map(p => p.id));
      const emails = authUsers.filter(u => ids.has(u.id)).map(u => u.email).filter(Boolean);

      let sent = 0;
      const chunks = [];
      for (let i = 0; i < emails.length; i += 5) chunks.push(emails.slice(i, i + 5));
      for (const chunk of chunks) {
        await Promise.all(chunk.map(email =>
          sendEmail({
            to: email,
            subject: "📢 Communication de l'équipe ALANE",
            html: emailHtml(`<p>Bonjour,</p><p>${esc(message).replace(/\n/g,"<br/>")}</p><p style="color:#888;font-size:13px;">L'équipe ALANE</p>`),
          }).then(() => { sent++; }).catch(() => {})
        ));
      }
      return res.status(200).json({ success: true, sent });
    }

    if (action === "send_user_email") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const { subject, message } = req.body;
      if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: "Sujet et message requis" });
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
      const userData = await userRes.json();
      const userEmail = userData.email;
      if (!userEmail) return res.status(404).json({ error: "Email introuvable" });
      const prenom = userData.user_metadata?.prenom || "";
      await sendEmail({
        to: userEmail,
        subject: subject.trim(),
        html: emailHtml(`
          <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
          <p>${esc(message.trim()).replace(/\n/g,"<br/>")}</p>
          <p style="color:#888;font-size:13px;">L'équipe ALANE</p>
        `),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "send_user_email", target_id: profileId, target_email: userEmail }),
      }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === "send_test_email") {
      const adminEmail = process.env.ADMIN_EMAIL || "direction@alane.fr";
      await sendEmail({
        to: adminEmail,
        subject: "✅ Test email ALANE — configuration Resend OK",
        html: emailHtml(`
          <p>Bonjour,</p>
          <p>Ceci est un email de test envoyé depuis le backoffice <strong>ALANE</strong>.</p>
          <p>Si vous recevez cet email, la configuration Resend est correctement opérationnelle.</p>
          <p style="color:#888;font-size:13px;">Envoyé le ${new Date().toLocaleString("fr-FR")} depuis le BO ALANE.</p>
        `),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "list_docs") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${profileId}&select=*&order=created_at.desc`, { headers });
      const docs = await r.json();
      if (!Array.isArray(docs)) return res.status(200).json([]);
      // Générer des URLs signées (1h) pour chaque doc
      const withUrls = await Promise.all(docs.map(async (doc) => {
        try {
          const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${doc.storage_path}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
          });
          const sj = await sr.json();
          return { ...doc, signedUrl: sj.signedURL ? `${SUPABASE_URL}/storage/v1${sj.signedURL}` : null };
        } catch { return { ...doc, signedUrl: null }; }
      }));
      return res.status(200).json(withUrls);
    }

    if (action === "list_all_docs") {
      // Récupère tous les documents + infos prestataire
      const docsRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?select=*&order=created_at.desc`, { headers });
      const allDocs = await docsRes.json();
      if (!Array.isArray(allDocs)) return res.status(200).json([]);

      // Récupère les profils pour les noms
      const ids = [...new Set(allDocs.map(d => d.prestataire_id))];
      let profileMap = {};
      if (ids.length) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(",")})&select=id,prenom,nom`, { headers });
        const profs = await pr.json();
        if (Array.isArray(profs)) profs.forEach(p => { profileMap[p.id] = p; });
      }

      // Récupère les emails depuis auth.users
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { ...headers, "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
      const usersData = await usersRes.json();
      let emailMap = {};
      if (usersData?.users) usersData.users.forEach(u => { emailMap[u.id] = u.email; });

      // Génère les signed URLs
      const withUrls = await Promise.all(allDocs.map(async (doc) => {
        let signedUrl = null;
        try {
          const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${doc.storage_path}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
          });
          const sj = await sr.json();
          signedUrl = sj.signedURL ? `${SUPABASE_URL}/storage/v1${sj.signedURL}` : null;
        } catch {}
        const prof = profileMap[doc.prestataire_id] || {};
        const meta = usersData?.users?.find(u => u.id === doc.prestataire_id)?.user_metadata || {};
        const prenom = prof.prenom || meta.prenom || "";
        const nom = prof.nom || meta.nom || "";
        return { ...doc, signedUrl, prenom, nom, email: emailMap[doc.prestataire_id] || "" };
      }));
      return res.status(200).json(withUrls);
    }

    if (action === "verify_doc") {
      if (!profileId || !req.body.docId) return res.status(400).json({ error: "profileId + docId requis" });
      // Vérifier que le document appartient bien au profil demandé
      const docCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}&prestataire_id=eq.${profileId}&select=id`, { headers });
      const docCheckData = await docCheckRes.json();
      if (!Array.isArray(docCheckData) || !docCheckData[0]) return res.status(403).json({ error: "Document non trouvé pour ce profil" });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ verified: true }),
      });
      // Marquer le profil comme ayant au moins un document vérifié
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ docs_verified: true }),
      }).catch(() => {}); // Ignoré si la colonne n'existe pas encore (migration non appliquée)
      return res.status(200).json({ success: true });
    }

    if (action === "visits_stats") {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startWeek  = new Date(now.getTime() - 7 * 86400000).toISOString();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [todayR, weekR, monthR, totalR] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startToday}&select=id`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startWeek}&select=id`,  { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${startMonth}&select=id`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/visits?select=id`, { headers }),
      ]);

      const [today, week, month, total] = await Promise.all([
        todayR.json(), weekR.json(), monthR.json(), totalR.json(),
      ]);

      // Visites par jour sur les 14 derniers jours
      const start14 = new Date(now.getTime() - 13 * 86400000).toISOString();
      const allR = await fetch(`${SUPABASE_URL}/rest/v1/visits?created_at=gte.${start14}&select=created_at&order=created_at.asc`, { headers });
      const all  = await allR.json();
      const byDay = {};
      (Array.isArray(all) ? all : []).forEach(v => {
        const d = v.created_at?.slice(0, 10);
        if (d) byDay[d] = (byDay[d] || 0) + 1;
      });

      return res.status(200).json({
        today: Array.isArray(today) ? today.length : 0,
        week:  Array.isArray(week)  ? week.length  : 0,
        month: Array.isArray(month) ? month.length : 0,
        total: Array.isArray(total) ? total.length : 0,
        byDay,
      });
    }

    if (action === "list_missions") {
      const statusFilter = req.body.status && req.body.status !== "all" ? `&status=eq.${req.body.status}` : "";
      const [missionsRes, authRes, profilesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?select=id,status,sector,metier,date,hours,tarif_horaire,montant_total,created_at,client_id,prestataire_id,validation_prestataire,validation_client,ville,recurrence${statusFilter}&order=created_at.desc&limit=300`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers }),
      ]);
      const missions  = await missionsRes.json();
      const authData  = await authRes.json();
      const profiles  = await profilesRes.json();
      const authMap   = {};
      (authData.users || []).forEach(u => { authMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });
      const nameMap = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => {
        const n = `${p.prenom||""} ${p.nom||""}`.trim();
        nameMap[p.id] = n || (authMap[p.id]?.meta?.prenom ? `${authMap[p.id].meta.prenom} ${authMap[p.id].meta.nom||""}`.trim() : "");
      });
      const enriched = (Array.isArray(missions) ? missions : []).map(m => ({
        ...m,
        client_name: nameMap[m.client_id] || "Client",
        presta_name: m.prestataire_id ? (nameMap[m.prestataire_id] || "Prestataire") : null,
      }));
      return res.status(200).json(enriched);
    }

    if (action === "force_complete_mission") {
      const { mission_id } = req.body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,hours,tarif_horaire,metier,sector,recurrence,date,heure_debut,ville`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable" });
      if (!["assigned","pending_acceptance"].includes(m.status)) return res.status(400).json({ error: `Statut ${m.status} — seules les missions assigned/pending_acceptance peuvent être validées` });
      const montantTotal = Math.round((m.hours||0) * (m.tarif_horaire||0) * 100) / 100;
      // PATCH atomique — garde le guard status=eq.assigned pour éviter double-crédit
      const patchStatus = m.status === "pending_acceptance" ? "pending_acceptance" : "assigned";
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.${patchStatus}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", montant_total: montantTotal, validation_prestataire: true, validation_client: true }),
      });
      const patched = await patchRes.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) return res.status(409).json({ error: "Mission déjà validée ou statut changé" });
      // Cashback client
      let CASHBACK_TIERS = [{ min:0,max:2,rate:0.005 },{ min:3,max:5,rate:0.0075 },{ min:6,max:9,rate:0.01 },{ min:10,max:999,rate:0.015 }];
      try { const cbR = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`,{headers}); const cbD = await cbR.json(); if(Array.isArray(cbD)&&Array.isArray(cbD[0]?.value)) CASHBACK_TIERS=cbD[0].value; } catch {}
      const profileR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profileD = await profileR.json();
      const prof = Array.isArray(profileD) && profileD[0];
      const mCount = (prof?.missions_completed_month||0)+1;
      const rate = [...CASHBACK_TIERS].reverse().find(t=>mCount>=t.min)?.rate||0.01;
      const cashback = Math.round(montantTotal*rate*100)/100;
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, { method:"POST", headers:{...headers,"Prefer":"return=representation"}, body: JSON.stringify({ p_user_id:m.client_id, p_delta:cashback, p_missions:1 }) }).catch(()=>{});
      // Notification prestataire
      if (m.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.prestataire_id, type:"mission", title:"Mission validée ✅", body:`Votre mission "${m.metier||m.sector}" du ${m.date} a été validée. Votre paiement est en cours.`, read:false }) }).catch(()=>{});
      }
      // Notification client
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"mission", title:"Mission validée ✅", body:`Votre mission "${m.metier||m.sector}" du ${m.date} a été validée.${cashback>0?` Cashback +${cashback.toFixed(2)} €`:""}`, read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"force_complete_mission", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success:true, montantTotal, cashback });
    }

    if (action === "release_dispute") {
      const { mission_id } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,sector`, { headers });
      const missions = await mr.json();
      const m = Array.isArray(missions) && missions[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La mission n'est pas en litige" });

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "completed" }),
      });

      // Notification client
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Litige résolu ✅", body:"ALANE a examiné votre dossier et a validé la prestation. Merci pour votre retour.", read:false }) }).catch(()=>{});
      }
      // Notification prestataire
      if (m.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.prestataire_id, type:"system", title:"Fonds libérés ✅", body:"Suite à l'examen du litige, votre prestation a été validée et les fonds libérés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"release_dispute", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "refund_dispute") {
      const { mission_id } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,stripe_payment_intent`, { headers });
      const missions = await mr.json();
      const m = Array.isArray(missions) && missions[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable" });
      if (m.status !== "disputed") return res.status(400).json({ error: "La mission n'est pas en litige" });

      // Remboursement Stripe si un PaymentIntent existe
      if (m.stripe_payment_intent) {
        const stripeRes = await fetch(`https://api.stripe.com/v1/refunds`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `payment_intent=${m.stripe_payment_intent}`,
        });
        if (!stripeRes.ok) {
          const stripeErr = await stripeRes.json().catch(() => ({}));
          return res.status(500).json({ error: stripeErr?.error?.message || "Erreur Stripe lors du remboursement" });
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });

      // Notification client
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Remboursement en cours 💰", body:"Votre litige a été accepté. Le remboursement sera crédité sous 5 à 10 jours ouvrés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"refund_dispute", target_id:mission_id }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "manual_refund") {
      const { mission_id, reason } = body;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,stripe_payment_intent`, { headers });
      const rows = await mr.json();
      const m = Array.isArray(rows) && rows[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable" });
      if (m.stripe_payment_intent) {
        const stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `payment_intent=${m.stripe_payment_intent}`,
        });
        if (!stripeRes.ok) {
          const err = await stripeRes.json().catch(() => ({}));
          return res.status(500).json({ error: err?.error?.message || "Erreur Stripe" });
        }
      }
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, { method:"PATCH", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ status:"closed" }) });
      if (m.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:m.client_id, type:"system", title:"Remboursement initié 💰", body: reason || "Un remboursement a été initié par ALANE. Vous serez crédité sous 5 à 10 jours ouvrés.", read:false }) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"manual_refund", target_id:mission_id, details:{ reason } }) }).catch(()=>{});
      return res.status(200).json({ success: true });
    }

    if (action === "adjust_cashback") {
      const { profileId, delta, reason } = body;
      if (!profileId || delta == null) return res.status(400).json({ error: "profileId + delta requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, { method:"POST", headers:{...headers,"Prefer":"return=representation"}, body: JSON.stringify({ p_user_id:profileId, p_delta:Number(delta), p_missions:0 }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ user_id:profileId, type:"cashback", title: Number(delta) >= 0 ? `Cashback crédité +${Math.abs(Number(delta)).toFixed(2)} €` : `Cashback ajusté ${Number(delta).toFixed(2)} €`, body: reason || "Ajustement par l'administration ALANE.", read:false }) }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"adjust_cashback", target_id:profileId, details:{ delta, reason } }) }).catch(()=>{});
      return res.status(200).json({ ok: true });
    }

    if (action === "broadcast_notification") {
      const { title, body: notifBody, target } = body;
      if (!title || !notifBody) return res.status(400).json({ error: "title + body requis" });
      const roleFilter = target === "clients" ? "&role=eq.client" : target === "prestataires" ? "&role=eq.prestataire" : "";
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id${roleFilter}&status=eq.approved`, { headers });
      const profs = await pr.json();
      if (!Array.isArray(profs) || profs.length === 0) return res.status(200).json({ ok:true, sent:0 });
      const notifs = profs.map(p => ({ user_id:p.id, type:"system", title, body:notifBody, read:false }));
      for (let i = 0; i < notifs.length; i += 100) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify(notifs.slice(i, i+100)) }).catch(()=>{});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"broadcast_notification", details:{ title, target, count:notifs.length } }) }).catch(()=>{});
      return res.status(200).json({ ok:true, sent:notifs.length });
    }

    if (action === "list_ratings") {
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/ratings?select=id,rating,comment,created_at,reviewer_id,reviewee_id&order=created_at.desc&limit=200`, { headers });
      const ratings = await rr.json();
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profs = await pr.json();
      const nameMap = {};
      (Array.isArray(profs) ? profs : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });
      return res.status(200).json((Array.isArray(ratings) ? ratings : []).map(r => ({ ...r, reviewer_name: nameMap[r.reviewer_id]||"Inconnu", reviewee_name: nameMap[r.reviewee_id]||"Inconnu" })));
    }

    if (action === "delete_rating") {
      const { ratingId } = body;
      if (!ratingId) return res.status(400).json({ error: "ratingId requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/ratings?id=eq.${ratingId}`, { method:"DELETE", headers:{...headers,"Prefer":"return=minimal"} });
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, { method:"POST", headers:{...headers,"Prefer":"return=minimal"}, body: JSON.stringify({ action:"delete_rating", target_id:ratingId }) }).catch(()=>{});
      return res.status(200).json({ ok:true });
    }
    }

    if (action === "list_missions_export") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?select=id,status,sector,metier,date,hours,tarif_horaire,montant_total,created_at,client_id,prestataire_id,stripe_payment_intent&order=created_at.desc`,
        { headers }
      );
      const missions = await r.json();
      return res.status(200).json(Array.isArray(missions) ? missions : []);
    }

    if (action === "reset_visits") {
      await fetch(`${SUPABASE_URL}/rest/v1/visits?id=neq.00000000-0000-0000-0000-000000000000`, {
        method: "DELETE",
        headers: { ...headers, "Prefer": "return=minimal" },
      });
      return res.status(200).json({ success: true });
    }

    if (action === "update_profile") {
      if (!profileId) return res.status(400).json({ error: "profileId requis" });

      const PROFILE_COLS = ["prenom", "nom", "status"];
      const VALID_STATUSES = ["pending", "approved", "rejected"];
      const META_WHITELIST = ["secteur","metier","niveau","tarif_net","langues","dispon_jours","dispon_jours_creneaux","dispo_immediat","code_postal","ville","telephone","cv","zone_km","statut_pro","experience_ans","competences","plan_abonnement","subscription_end_date"];
      const profileFields = {};
      const metaFields = {};
      for (const [k, v] of Object.entries(payload)) {
        if (PROFILE_COLS.includes(k)) profileFields[k] = v;
        else if (META_WHITELIST.includes(k)) metaFields[k] = v;
      }
      if (profileFields.status !== undefined && !VALID_STATUSES.includes(profileFields.status)) {
        return res.status(400).json({ error: "Statut invalide" });
      }

      if (Object.keys(profileFields).length > 0) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify(profileFields),
        });
        if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour profil" });
      }

      if (Object.keys(metaFields).length > 0) {
        const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { headers });
        const existingUser = getR.ok ? await getR.json() : {};
        const existingMeta = existingUser.user_metadata || {};
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ user_metadata: { ...existingMeta, ...metaFields } }),
        });
        if (!r.ok) return res.status(500).json({ error: "Erreur mise à jour métadonnées" });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action: "update_profile", target_id: profileId }),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    if (action === "list_logs") {
      const logsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bo_logs?order=created_at.desc&limit=200`,
        { headers }
      );
      const logs = await logsRes.json();
      return res.status(200).json(Array.isArray(logs) ? logs : []);
    }

    if (action === "stripe_stats") {
      const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
      if (!STRIPE_KEY) {
        return res.status(200).json({ error: "Stripe non configuré" });
      }
      const stripeAuth = "Basic " + Buffer.from(STRIPE_KEY + ":").toString("base64");
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

      const [balanceRes, chargesRes] = await Promise.all([
        fetch("https://api.stripe.com/v1/balance", {
          headers: { "Authorization": stripeAuth },
        }),
        fetch(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${thirtyDaysAgo}`, {
          headers: { "Authorization": stripeAuth },
        }),
      ]);

      if (!balanceRes.ok || !chargesRes.ok) {
        return res.status(200).json({ error: "Erreur Stripe API" });
      }

      const balanceData = await balanceRes.json();
      const chargesData = await chargesRes.json();

      const available = (balanceData.available || []).reduce((acc, b) => acc + (b.amount || 0), 0) / 100;
      const pending   = (balanceData.pending   || []).reduce((acc, b) => acc + (b.amount || 0), 0) / 100;

      const charges = Array.isArray(chargesData.data) ? chargesData.data : [];
      const succeeded = charges.filter(c => c.status === "succeeded");
      const volume = succeeded.reduce((acc, c) => acc + (c.amount || 0), 0) / 100;
      const commission = Math.round(volume * 0.20 * 100) / 100;

      return res.status(200).json({
        available: Math.round(available * 100) / 100,
        pending:   Math.round(pending   * 100) / 100,
        last30days: {
          count:      succeeded.length,
          volume:     Math.round(volume     * 100) / 100,
          commission: commission,
        },
      });
    }

    if (action === "list_paid_missions") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?stripe_payment_intent=not.is.null&status=eq.completed&select=id,montant_total,stripe_payment_intent,created_at,sector,metier&order=created_at.desc&limit=50`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (action === "get_settings") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?select=key,value`, { headers });
      const rows = await r.json();
      if (!Array.isArray(rows)) return res.status(200).json({});
      const obj = {};
      for (const row of rows) obj[row.key] = row.value;
      return res.status(200).json(obj);
    }

    if (action === "save_settings") {
      if (!verifyBoToken(req.headers["authorization"])) return res.status(401).json({ error: "Non autorisé" });
      const { key, value } = payload;
      if (!key || value === undefined) return res.status(400).json({ error: "key et value requis" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return res.status(500).json({ error: "Erreur sauvegarde" });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("bo-action error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
