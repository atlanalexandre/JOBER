import crypto from "crypto";

function verifyBoToken(token, secret) {
  if (!token) return false;
  const [tsStr, sig] = token.split(".");
  if (!tsStr || !sig) return false;
  const ts = parseInt(tsStr, 10);
  if (Date.now() / 1000 - ts > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(tsStr).digest("hex");
  return expected === sig;
}

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "");
  const cronSecret  = process.env.CRON_SECRET;
  const boSecret    = process.env.BO_SESSION_SECRET || "alane-bo-secret-change-me-in-vercel";

  const isCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const isBo   = verifyBoToken(token, boSecret);
  if (!isCron && !isBo) return res.status(401).json({ error: "Unauthorized" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // ── Mode rappels quotidiens ─────────────────────────────────────
  if (req.query?.action === "reminders") {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM    = process.env.RESEND_FROM || "onboarding@resend.dev";

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    try {
      const missionsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=eq.${tomorrowStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,ville`,
        { headers }
      );
      const missionsData = await missionsRes.json();
      const missions = Array.isArray(missionsData) ? missionsData : [];

      if (!missions.length || !RESEND_API_KEY) {
        return res.status(200).json({ success: true, reminders: 0 });
      }

      // Récupérer tous les utilisateurs en une requête
      const usersRes  = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
      const usersData = await usersRes.json();
      const userMap   = {};
      (usersData.users || []).forEach(u => { userMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });

      // Récupérer les noms depuis profiles
      const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profiles    = await profilesRes.json();
      const nameMap     = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });

      let sent = 0;
      await Promise.all(missions.map(async (m) => {
        const clientEmail  = userMap[m.client_id]?.email;
        const prestaEmail  = userMap[m.prestataire_id]?.email;
        const clientName   = nameMap[m.client_id] || "Client";
        const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
        const missionInfo  = `${esc(m.metier||"Mission")} · ${esc(m.ville||"")} · ${m.hours}h`;

        const emailBody = (toName, toRole) => `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">⏰</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Rappel : mission demain !</h1>
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;">${missionInfo}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(toName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre mission est prévue <strong style="color:#F0B429;">demain</strong>. Voici un rappel des détails :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#162547;border-radius:12px;padding:16px 20px;border:1px solid rgba(124,111,224,0.2);">
${[
  ["💼 Poste", m.metier||"—"],
  ["📅 Date", tomorrowStr],
  ["⏱️ Durée", `${m.hours}h`],
  ["📍 Lieu", m.ville||"—"],
  toRole === "client" ? ["👷 Prestataire", prestaName] : ["🏢 Client", clientName],
].map(([l,v])=>`<tr><td style="color:#8B8FA8;font-size:13px;padding:6px 0;">${l}</td><td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${esc(String(v))}</td></tr>`).join("")}
</table>
<div style="text-align:center;margin-top:24px;"><a href="https://www.alane.fr" style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Voir ma mission →</a></div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

        const sends = [];
        if (clientEmail) sends.push(
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: RESEND_FROM, to: [clientEmail], subject: `⏰ Rappel mission demain — ${m.metier||"Mission"} · ALANE`, html: emailBody(clientName, "client") }),
          }).catch(()=>{})
        );
        if (prestaEmail) sends.push(
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: RESEND_FROM, to: [prestaEmail], subject: `⏰ Rappel mission demain — ${m.metier||"Mission"} · ALANE`, html: emailBody(prestaName, "prestataire") }),
          }).catch(()=>{})
        );
        await Promise.all(sends);
        sent += sends.length;
      }));

      return res.status(200).json({ success: true, reminders: sent, missions: missions.length });
    } catch (e) {
      console.error("cron reminders error:", e);
      return res.status(500).json({ error: "Erreur rappels" });
    }
  }

  // ── Mode reset mensuel (défaut) ─────────────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?missions_completed_month=gt.0`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0 }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("cron-reset-monthly error:", err);
      return res.status(500).json({ error: "Erreur reset" });
    }

    // Downgrade des abonnements expirés
    let downgrades = 0;
    try {
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
      const usersData = await usersRes.json();
      const users = usersData.users || [];
      const now = new Date();
      await Promise.all(users.map(async u => {
        const meta = u.user_metadata || {};
        if (meta.plan_abonnement && meta.plan_abonnement !== "free" && meta.subscription_end_date) {
          if (new Date(meta.subscription_end_date) < now) {
            // Merge pour ne pas écraser les métadonnées existantes
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
              method: "PUT", headers,
              body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: "free", subscription_end_date: null } }),
            }).catch(() => {});
            downgrades++;
          }
        }
      }));
    } catch {}

    console.log(`cron-reset-monthly: missions reset, ${downgrades} abonnements expirés downgradés`);
    return res.status(200).json({ success: true, downgrades });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
