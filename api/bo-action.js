import crypto from "crypto";

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

function verifyBoToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const secret = process.env.BO_SESSION_SECRET || "alane-bo-secret-change-me-in-vercel";
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
    if (!r.ok) console.error("Resend bo-action error:", r.status);
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
              <p>Bonjour${prenom ? ` <strong>${esc(prenom)}</strong>` : ""},</p>
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

      // Log action BO
      await fetch(`${SUPABASE_URL}/rest/v1/bo_logs`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ action, target_id: profileId, target_email: userEmail || null }),
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
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role,status`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?select=status,sector,montant_total`, { headers }),
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

      return res.status(200).json({
        users:        { clients, prestataires, total: clients + prestataires, pending },
        missions:     { total: mTotal, open: mOpen, assigned: mAssigned, terminees: mCompleted, closed: mClosed, tauxCompletion },
        finance:      { caTotal: Math.round(caTotal * 100) / 100 },
        tickets:      { open: ticketsOpen, total: t.length },
        sectors,
        recentUsers:  r,
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
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers }),
      ]);
      const profiles = await profilesRes.json();
      const authData = await authRes.json();
      const authUsers = authData.users || [];
      const ids = new Set((Array.isArray(profiles) ? profiles : []).map(p => p.id));
      const emails = authUsers.filter(u => ids.has(u.id)).map(u => u.email).filter(Boolean);

      let sent = 0;
      for (const email of emails) {
        await sendEmail({
          to: email,
          subject: "📢 Communication de l'équipe ALANE",
          html: emailHtml(`<p>Bonjour,</p><p>${esc(message).replace(/\n/g,"<br/>")}</p><p style="color:#888;font-size:13px;">L'équipe ALANE</p>`),
        });
        sent++;
      }
      return res.status(200).json({ success: true, sent });
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

    if (action === "verify_doc") {
      if (!profileId || !req.body.docId) return res.status(400).json({ error: "profileId + docId requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${req.body.docId}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ verified: true }),
      });
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

    if (action === "list_logs") {
      const logsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bo_logs?order=created_at.desc&limit=200`,
        { headers }
      );
      const logs = await logsRes.json();
      return res.status(200).json(Array.isArray(logs) ? logs : []);
    }

    if (action === "list_paid_missions") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?stripe_payment_intent=not.is.null&status=eq.completed&select=id,montant_total,stripe_payment_intent,created_at,sector,metier&order=created_at.desc&limit=50`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("bo-action error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
