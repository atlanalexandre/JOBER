import crypto from "crypto";

function verifyBoToken(token, secret) {
  if (!token) return false;
  const parts = token.split(".");
  // Support new format (ts.nonce.sig) and legacy format (ts.sig)
  const tsStr  = parts[0];
  const sig    = parts.length >= 3 ? parts[2] : parts[1];
  const payload = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!tsStr || !sig) return false;
  const ts = parseInt(tsStr, 10);
  if (Date.now() / 1000 - ts > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  try {
    const sigBuf = Buffer.from(sig, "hex");
    if (expBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, sigBuf);
  } catch { return false; }
}

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function formatPhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s.\-()]/g, "");
  if (cleaned.startsWith("+33")) return cleaned;
  if (cleaned.startsWith("0")) return "+33" + cleaned.slice(1);
  return null;
}

function frenchOffsetMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const marchEnd = new Date(Date.UTC(y,2,31)); marchEnd.setUTCDate(31-marchEnd.getUTCDay()); marchEnd.setUTCHours(1,0,0,0);
  const octEnd   = new Date(Date.UTC(y,9,31)); octEnd.setUTCDate(31-octEnd.getUTCDay());   octEnd.setUTCHours(1,0,0,0);
  return (d >= marchEnd && d < octEnd) ? -7200000 : -3600000;
}

function sendSms(apiKey, to, content) {
  const phone = formatPhone(to);
  if (!phone) return Promise.resolve();
  return fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: "ALANE", recipient: phone, content }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "");
  const cronSecret  = (process.env.CRON_SECRET || "").replace(/\s/g, "");
  const boSecret    = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");

  if (!cronSecret) {
    console.error("[cron] CRITIQUE: CRON_SECRET non configuré — accès non authentifié bloqué. Configurez CRON_SECRET dans Vercel.");
  }
  const isCron = cronSecret ? authHeader === `Bearer ${cronSecret}` : false;
  const isBo   = boSecret ? verifyBoToken(token, boSecret) : false;
  if (!isCron && !isBo) return res.status(401).json({ error: "Unauthorized" });

  // Valider le paramètre ?action — seule la valeur "reminders" est acceptée
  const queryAction = req.query?.action;
  if (queryAction !== undefined && queryAction !== "reminders") {
    return res.status(400).json({ error: "Action inconnue — valeur acceptée : reminders" });
  }

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // ── Expiry des pending_acceptance zombies (toutes routes) ───────
  {
    const nowIso = new Date().toISOString();
    try {
      const zRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.pending_acceptance&acceptance_deadline=lt.${nowIso}&select=id,client_id,metier,titre`,
        { headers }
      );
      const zombies = await zRes.json().catch(() => []);
      if (Array.isArray(zombies) && zombies.length) {
        await Promise.all(zombies.map(async z => {
          // Reset mission → open + effacer prestataire_id + réinitialiser broadcast_sent_at
          // pour permettre une re-diffusion immédiate
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${z.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "open", prestataire_id: null, broadcast_sent_at: null }),
          }).catch(() => {});
          if (z.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: z.client_id,
                type: "mission",
                title: "Prestataire non disponible",
                body: `Le prestataire n'a pas répondu pour "${z.titre || z.metier || "votre mission"}". Elle est remise en recherche — vous pouvez la re-diffuser depuis votre espace.`,
                read: false,
              }),
            }).catch(() => {});
          }
        }));
        console.log(`[cron] expired ${zombies.length} pending_acceptance zombie(s)`);
      }
    } catch (e) { console.error("[cron] zombie expiry error:", e); }
  }

  // ── Mode rappels quotidiens ─────────────────────────────────────
  if (req.query?.action === "reminders") {
    const RESEND_API_KEY    = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
    const RESEND_FROM       = process.env.RESEND_FROM || "onboarding@resend.dev";
    const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
    const smsEnabled = !!BREVO_API_KEY;

    try {
      // Charger tous les utilisateurs (paginé) et profils une seule fois
      const userMap = {};
      let usersPage = 1;
      while (true) {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${usersPage}`, { headers });
        const uData = await uRes.json();
        const batch = uData.users || [];
        batch.forEach(u => { userMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });
        if (batch.length < 1000) break;
        usersPage++;
      }
      const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profiles  = await profilesRes.json();
      const nameMap   = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });

      // ── 1. Rappels de mission pour demain ────────────────────────
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const missionsRes  = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=eq.${tomorrowStr}&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville,adresse`,
        { headers }
      );
      const missionsData = await missionsRes.json();
      const missions     = Array.isArray(missionsData) ? missionsData : [];

      let sent = 0;
      if (missions.length && RESEND_API_KEY) {
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
  ...(m.heure_debut ? [["🕐 Heure de début", m.heure_debut], ["🕔 Heure de fin", (() => { const [h,min] = m.heure_debut.split(":").map(Number); const e = h*60+min+Math.round(Number(m.hours)*60); return `${String(Math.floor(e/60)%24).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`; })()] ] : [["⏱️ Durée", `${m.hours}h`]]),
  ["📍 Lieu", [m.adresse, m.ville].filter(Boolean).join(", ")||"—"],
  toRole === "client" ? ["👷 Prestataire", prestaName] : ["🏢 Client", clientName],
].map(([l,v])=>`<tr><td style="color:#8B8FA8;font-size:13px;padding:6px 0;">${l}</td><td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${esc(String(v))}</td></tr>`).join("")}
</table>
${toRole === "prestataire" ? `
<div style="margin-top:16px;background:#1A2B4A;border-left:4px solid #F0B429;border-radius:0 10px 10px 0;padding:14px 16px;">
  <p style="color:#F0B429;font-size:13px;font-weight:800;margin:0 0 8px;">🚗 Anticipez votre temps de trajet !</p>
  <p style="color:#B0B8CC;font-size:13px;line-height:1.6;margin:0 0 12px;">Calculez votre itinéraire dès maintenant et prévoyez d'arriver <strong style="color:#F0F0F5;">au moins 10 minutes avant l'heure de début</strong>. Un retard impacte votre note et peut limiter votre accès aux prochaines missions.</p>
  ${(() => { const addr = [m.adresse, m.ville].filter(Boolean).join(", "); return addr ? `<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(addr)}" style="display:inline-block;padding:9px 18px;background:#F0B429;color:#050E20;border-radius:8px;text-decoration:none;font-weight:800;font-size:13px;">📍 Calculer mon itinéraire →</a>` : ""; })()}
</div>` : ""}
${(() => {
  const appUrl = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
  const loc = encodeURIComponent([m.adresse, m.ville].filter(Boolean).join(", ") || "");
  const titleEnc = encodeURIComponent(`Mission ALANE — ${m.metier||"Mission"}`);
  const descEnc  = encodeURIComponent(`Mission via ALANE. Voir détails : ${appUrl}`);
  const heureDebut = m.heure_debut || "08:00";
  const [hd, md2] = heureDebut.split(":").map(Number);
  const endMin = hd * 60 + md2 + Math.round(Number(m.hours) * 60);
  const heureFin = `${String(Math.floor(endMin/60)%24).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
  const [y,mo,d] = tomorrowStr.split("-");
  const gcStart = `${y}${mo}${d}T${heureDebut.replace(":","").padEnd(6,"0")}`;
  const gcEnd   = `${y}${mo}${d}T${heureFin.replace(":","").padEnd(6,"0")}`;
  const gcUrl   = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titleEnc}&dates=${gcStart}/${gcEnd}&details=${descEnc}&location=${loc}`;
  const icsUrl  = `${appUrl}/api/support?ics=1&title=${titleEnc}&date=${tomorrowStr}&start=${encodeURIComponent(heureDebut)}&end=${encodeURIComponent(heureFin)}&location=${loc}&description=${descEnc}`;
  return `<div style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
<a href="${gcUrl}" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">📅 Google Agenda</a>
<a href="${icsUrl}" style="display:inline-block;background:#555;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">🗓 Apple / Outlook</a>
</div>`;
})()}
<div style="text-align:center;margin-top:16px;"><a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Voir ma mission →</a></div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
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
          if (smsEnabled) {
            const smsBody = `⏰ ALANE - Rappel : votre mission ${m.metier||"Mission"} à ${m.ville||""} est demain à ${m.heure_debut||""}h. Bonne mission ! — alane.fr`;
            const clientPhone = userMap[m.client_id]?.meta?.telephone;
            const prestaPhone = userMap[m.prestataire_id]?.meta?.telephone;
            if (clientPhone) sends.push(sendSms(BREVO_API_KEY, clientPhone, smsBody));
            if (prestaPhone) sends.push(sendSms(BREVO_API_KEY, prestaPhone, smsBody));
          }
          await Promise.all(sends);
          sent += sends.length;
        }));
      }

      // ── 2. Rappels de validation ciblés selon qui n'a pas encore validé ──
      const todayStr = new Date().toISOString().slice(0, 10);
      let validationSent = 0;
      try {
        const pastRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lt.${todayStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,actual_hours,ville,heure_debut,validation_prestataire,validation_client,last_validation_reminder_at`,
          { headers }
        );
        const pastMissionsRaw = await pastRes.json();
        const now = Date.now();
        const TWELVE_HOURS_MS = 2 * 60 * 60 * 1000; // relance toutes les 2h
        const pastMissions = Array.isArray(pastMissionsRaw) ? pastMissionsRaw.filter(m => {
          if (!m.heure_debut) return true;
          const effectiveH = m.actual_hours ?? m.hours ?? 0;
          const endMs = new Date(`${m.date}T${m.heure_debut}:00`).getTime() + (Number(effectiveH) * 3600000);
          if (endMs >= now) return false;
          // N-05: skip missions that already got a reminder less than 12h ago
          if (m.last_validation_reminder_at) {
            const lastReminderMs = new Date(m.last_validation_reminder_at).getTime();
            if (!isNaN(lastReminderMs) && now - lastReminderMs < TWELVE_HOURS_MS) return false;
          }
          return true;
        }) : [];
        if (pastMissions.length && RESEND_API_KEY) {
          await Promise.all(pastMissions.map(async (m) => {
            const clientEmail  = userMap[m.client_id]?.email;
            const prestaEmail  = userMap[m.prestataire_id]?.email;
            const clientName   = nameMap[m.client_id]  || "Client";
            const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
            const appUrl       = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
            const missionLabel = `${esc(m.metier||"Mission")} · ${esc(m.ville||"")} · ${m.date}`;

            // Email prestataire : uniquement s'il n'a pas encore confirmé la fin de mission
            const prestaHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">📋</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Confirmez la fin de votre mission</h1>
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;">${missionLabel}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(prestaName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre mission du <strong style="color:#A29BFE;">${m.date}</strong> est terminée mais vous n'avez pas encore confirmé la fin de prestation depuis votre espace.<br/><br/>Cette confirmation est <strong style="color:#fff;">indispensable pour déclencher votre paiement</strong>.</p>
<div style="text-align:center;margin-top:20px;">
<a href="${appUrl}" style="display:inline-block;background:#7C6FE0;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Confirmer ma mission →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

            // Email client : uniquement si le prestataire a déjà confirmé mais le client n'a pas validé
            const clientHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#F0B429,#E09B10);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">✅</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Validez votre mission</h1>
<p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0;">${missionLabel}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(clientName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre prestataire a confirmé la fin de la mission du <strong style="color:#F0B429;">${m.date}</strong>. Il ne vous reste plus qu'à valider depuis votre espace pour finaliser le paiement et obtenir votre cashback.</p>
<div style="text-align:center;margin-top:20px;">
<a href="${appUrl}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Valider la mission →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

            const vSends = [];
            // Relance prestataire seulement s'il n'a pas encore confirmé
            if (!m.validation_prestataire && prestaEmail)
              vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[prestaEmail], subject:`📋 Confirmez la fin de votre mission du ${m.date} — ALANE`, html: prestaHtml }) }).catch(()=>{}));
            // Relance client seulement si prestataire a confirmé mais client n'a pas encore validé
            if (m.validation_prestataire && !m.validation_client && clientEmail)
              vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[clientEmail], subject:`✅ Validez votre mission du ${m.date} — ALANE`, html: clientHtml }) }).catch(()=>{}));
            if (smsEnabled) {
              const smsPresta  = `📋 ALANE - Confirmez la fin de votre mission ${m.metier||"Mission"} du ${m.date} pour recevoir votre paiement. — alane.fr`;
              const smsCashback = `✅ ALANE - Votre prestataire a confirmé la mission du ${m.date}. Validez-la pour obtenir votre cashback. — alane.fr`;
              const clientPhone = userMap[m.client_id]?.meta?.telephone;
              const prestaPhone = userMap[m.prestataire_id]?.meta?.telephone;
              if (!m.validation_prestataire && prestaPhone) vSends.push(sendSms(BREVO_API_KEY, prestaPhone, smsPresta));
              if (m.validation_prestataire && !m.validation_client && clientPhone) vSends.push(sendSms(BREVO_API_KEY, clientPhone, smsCashback));
            }
            await Promise.all(vSends);
            validationSent += vSends.length;
            // N-05: stamp last_validation_reminder_at to prevent duplicate sends within 12h
            if (vSends.length > 0) {
              fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ last_validation_reminder_at: new Date().toISOString() }),
              }).catch(() => {});
            }
          }));
        }
      } catch (e) { console.error("cron validation reminders error:", e); }

      // ── 3. Auto-validation après 24h — que le prestataire ait confirmé ou non ─────
      let autoValidated = 0;
      try {
        // DST-safe : soustraire 1 jour calendaire plutôt que 86400000ms
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // On récupère toutes les missions assignées (peu importe validation_prestataire)
        // dont la date est <= hier (filtre large — on affine en JS avec heure_debut + hours)
        const avRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lte.${yesterdayStr}&select=id,client_id,prestataire_id,hours,actual_hours,tarif_horaire,metier,sector,date,heure_debut,validation_prestataire,cashback_credited`,
          { headers }
        );
        const autoMissionsRaw = await avRes.json();

        // Vérifier que 24h se sont effectivement écoulées depuis la FIN de la mission (heure_debut + hours)
        const nowTs = Date.now();
        const autoMissions = Array.isArray(autoMissionsRaw) ? autoMissionsRaw.filter(m => {
          if (!m.date) return true;
          const [h = 8, mn = 0] = (m.heure_debut || "08:00").split(":").map(Number);
          const naiveMs = new Date(`${m.date}T${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}:00`).getTime();
          const missionEndMs = naiveMs + frenchOffsetMs(new Date(naiveMs)) + Number(m.hours || 1) * 3600000;
          return nowTs - missionEndMs >= 24 * 3600000;
        }) : [];

        if (autoMissions.length) {
          // Charger les taux cashback depuis platform_settings
          let CASHBACK_TIERS = [
            { min:0, max:2, rate:0.005 }, { min:3, max:5, rate:0.0075 },
            { min:6, max:9, rate:0.01 }, { min:10, max:999, rate:0.015 },
          ];
          try {
            const cbRes  = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`, { headers });
            const cbData = await cbRes.json();
            if (Array.isArray(cbData) && Array.isArray(cbData[0]?.value)) CASHBACK_TIERS = cbData[0].value;
          } catch (e) { console.error("cron cashback_rates fetch error:", e); }

          // Traitement séquentiel pour éviter les écritures concurrentes sur le même client
          for (const m of autoMissions) {
            try {
              // B-05: skip if cashback was already credited (idempotence)
              if (m.cashback_credited) {
                console.log(`cron auto-validate: cashback already credited for mission ${m.id}, skipping`);
                continue;
              }
              // B-02: use actual_hours (validated by prestataire) if available, fallback to planned hours
              const hours = m.actual_hours ?? m.hours ?? 0;
              const tarif = m.tarif_horaire || 0;
              const montantTotal = Math.round(hours * tarif * 100) / 100;
              const mLabel = esc(m.metier || m.sector || "Mission");
              const appUrl = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";

              // Lire le profil client au moment du traitement pour éviter les données périmées
              const cpRes  = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,missions_completed_month`, { headers });
              const cpData = await cpRes.json();
              const profile = Array.isArray(cpData) && cpData[0] ? cpData[0] : {};
              const missionsThisMonth = (profile.missions_completed_month || 0) + 1;
              const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
              const cashbackEarned = Math.round(montantTotal * rate * 100) / 100;
              const newBalance = Math.round(((profile.cashback_balance || 0) + cashbackEarned) * 100) / 100;

              // Marquer la mission complétée et cashback crédité (B-05: cashback_credited = idempotence guard)
              const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ status: "completed", validation_client: true, validation_prestataire: true, montant_total: montantTotal, cashback_credited: true }),
              });
              if (!patchRes.ok) {
                console.error(`cron auto-validate: PATCH mission ${m.id} failed`, await patchRes.text());
                continue;
              }

              await Promise.all([
                // Mise à jour atomique du cashback via RPC pour éviter les race conditions
                fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=representation" },
                  body: JSON.stringify({ p_user_id: m.client_id, p_delta: cashbackEarned, p_missions: 1 }),
                }).catch(e => console.error("cron cashback update error:", e)),
                // Notification client
                fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.client_id, type: "mission", title: "Mission validée automatiquement ✅", body: `Votre mission "${mLabel}" a été validée automatiquement (délai 24h dépassé).${cashbackEarned > 0 ? ` Cashback crédité : +${cashbackEarned.toFixed(2)} €` : ""}`, read: false }),
                }).catch(()=>{}),
                // Notification prestataire
                m.prestataire_id && fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.prestataire_id, type: "mission", title: "Mission validée ✅", body: `Votre mission "${mLabel}" a été validée. Votre paiement de ${montantTotal.toFixed(2)} € est en cours de traitement.`, read: false }),
                }).catch(()=>{}),
                // Email prestataire — réutilise userMap déjà chargé
                (async () => {
                  if (!m.prestataire_id || !RESEND_API_KEY) return;
                  const prestaEmail = userMap[m.prestataire_id]?.email;
                  const prestaPrenom = userMap[m.prestataire_id]?.meta?.prenom || nameMap[m.prestataire_id] || "Prestataire";
                  if (!prestaEmail) return;
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ from: RESEND_FROM, to: [prestaEmail], subject: `Mission validée — votre paiement est en cours 💰`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#A29BFE;margin:0 0 12px">Mission validée automatiquement ✅</h2><p>Bonjour ${esc(prestaPrenom)},</p><p>Le délai de validation de 24h étant écoulé, votre mission <strong>${mLabel}</strong> a été automatiquement validée.</p><p>Votre paiement de <strong style="color:#A29BFE">${montantTotal.toFixed(2)} €</strong> est en cours de traitement et sera versé sur votre IBAN sous 3 à 5 jours ouvrés.</p><p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
                  }).catch(()=>{});
                })(),
                // Email client — confirmation auto-validation
                (async () => {
                  if (!RESEND_API_KEY) return;
                  const clientEmail = userMap[m.client_id]?.email;
                  const clientPrenom = userMap[m.client_id]?.meta?.prenom || nameMap[m.client_id] || "Client";
                  if (!clientEmail) return;
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ from: RESEND_FROM, to: [clientEmail], subject: `Mission validée automatiquement — ALANE`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429;margin:0 0 12px">Mission validée ✅</h2><p>Bonjour ${esc(clientPrenom)},</p><p>Votre mission <strong>${mLabel}</strong> a été automatiquement validée, le délai de confirmation de 24h étant écoulé.</p>${cashbackEarned > 0 ? `<p>Votre cashback de <strong style="color:#F0B429">+${cashbackEarned.toFixed(2)} €</strong> a été crédité sur votre wallet.</p>` : ""}<p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
                  }).catch(()=>{});
                })(),
              ]);
              autoValidated++;
            } catch (e) { console.error(`cron auto-validate mission ${m.id} error:`, e); }
          }
        }
      } catch (e) { console.error("cron auto-validation error:", e); }

      // ── 4. Notifications de fin de mission (missions terminées depuis la dernière exécution) ──
      let endNotifSent = 0;
      try {
        const enRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&end_notif_sent=not.is.true&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville`,
          { headers }
        );
        const enMissions = await enRes.json().catch(() => []);
        if (Array.isArray(enMissions)) {
          const nowMs = Date.now();
          const ended = enMissions.filter(m => {
            if (!m.date) return false;
            const [h = 8, mn = 0] = (m.heure_debut || "08:00").split(":").map(Number);
            const naive = new Date(`${m.date}T${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}:00`);
            const y = naive.getUTCFullYear();
            const marchEnd = new Date(Date.UTC(y,2,31)); marchEnd.setUTCDate(31-marchEnd.getUTCDay()); marchEnd.setUTCHours(1,0,0,0);
            const octEnd   = new Date(Date.UTC(y,9,31)); octEnd.setUTCDate(31-octEnd.getUTCDay());   octEnd.setUTCHours(1,0,0,0);
            const offset = (naive >= marchEnd && naive < octEnd) ? -7200000 : -3600000;
            return nowMs >= naive.getTime() - offset + Number(m.hours || 1) * 3600000;
          });
          for (const m of ended) {
            try {
              const mLabel = esc(m.metier || m.sector || "Mission");
              const appUrl2 = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
              const prestaEmail2 = userMap[m.prestataire_id]?.email;
              const clientEmail2 = userMap[m.client_id]?.email;
              const prestaName2  = nameMap[m.prestataire_id] || "Prestataire";
              const clientName2  = nameMap[m.client_id] || "Client";
              const sends2 = [];
              // In-app notification prestataire
              if (m.prestataire_id)
                sends2.push(fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.prestataire_id, type: "mission", title: "Confirmez la fin de votre mission ✅", body: `Votre mission "${mLabel}" est terminée. Confirmez depuis votre espace pour déclencher votre paiement.`, read: false }),
                }).catch(() => {}));
              if (RESEND_API_KEY && prestaEmail2)
                sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[prestaEmail2], subject:`🎉 Mission terminée — confirmez pour être payé(e) · ALANE`, html:`<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#10D98F">Mission terminée !</h2><p>Bonjour ${esc(prestaName2)},</p><p>Votre mission <strong>${mLabel}</strong> vient de se terminer. <strong>Confirmez la fin</strong> depuis votre espace ALANE pour déclencher votre paiement.</p><a href="${appUrl2}" style="display:inline-block;background:#10D98F;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;margin-top:16px">Confirmer ma mission →</a><p style="margin-top:24px;color:rgba(255,255,255,0.4);font-size:11px">L'équipe ALANE · <a href="${appUrl2}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }) }).catch(()=>{}));
              if (smsEnabled && m.prestataire_id) {
                const prestaPhone2 = userMap[m.prestataire_id]?.meta?.telephone;
                if (prestaPhone2) sends2.push(sendSms(BREVO_API_KEY, prestaPhone2, `✅ ALANE - Votre mission ${mLabel} est terminée. Confirmez depuis l'app pour recevoir votre paiement. — alane.fr`));
              }
              if (RESEND_API_KEY && clientEmail2)
                sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[clientEmail2], subject:`✅ Mission terminée — validation en attente · ALANE`, html:`<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429">Mission terminée</h2><p>Bonjour ${esc(clientName2)},</p><p>La mission <strong>${mLabel}</strong> vient de se terminer. Votre prestataire va confirmer la fin depuis son espace. Vous serez notifié(e) pour valider.</p><a href="${appUrl2}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;margin-top:16px">Suivre ma mission →</a><p style="margin-top:24px;color:rgba(255,255,255,0.4);font-size:11px">L'équipe ALANE · <a href="${appUrl2}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }) }).catch(()=>{}));
              await Promise.all(sends2);
              endNotifSent += sends2.length;
              await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" },
                body: JSON.stringify({ end_notif_sent: true }),
              }).catch(()=>{});
            } catch(e) { console.error(`end-notif mission ${m.id}:`, e); }
          }
        }
      } catch(e) { console.error("end-notif in reminders error:", e); }

      return res.status(200).json({ success: true, reminders: sent, validationReminders: validationSent, autoValidated, endNotifSent, missions: missions.length });
    } catch (e) {
      console.error("cron reminders error:", e);
      return res.status(500).json({ error: "Erreur rappels" });
    }
  }

  // ── Expiration des missions pending_acceptance dont le délai est dépassé ──
  // Appelé par tous les modes pour éviter les zombies
  try {
    const nowIso = new Date().toISOString();
    const zRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?status=eq.pending_acceptance&acceptance_deadline=lt.${nowIso}&select=id,client_id,metier,titre`,
      { headers }
    );
    const zombies = await zRes.json().catch(() => []);
    if (Array.isArray(zombies) && zombies.length > 0) {
      await Promise.all(zombies.map(async zm => {
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${zm.id}`, {
          method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ status: "open", prestataire_id: null }),
        }).catch(() => {});
        if (zm.client_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({
              user_id: zm.client_id, type: "mission",
              title: "Prestataire non disponible ⏱️",
              body: `Le prestataire n'a pas répondu à temps pour la mission "${zm.titre || zm.metier || ""}". Elle est de nouveau disponible.`,
              read: false,
            }),
          }).catch(() => {});
        }
      }));
      console.log(`cron: expired ${zombies.length} pending_acceptance missions`);
    }
  } catch (e) { console.error("cron zombie expiry error:", e); }

  // ── Auto-clôture des missions ouvertes dont la date est passée ──
  {
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const pastRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)&date=lt.${todayStr}&select=id,client_id,metier,titre`,
        { headers }
      );
      const pastMissions = await pastRes.json().catch(() => []);
      if (Array.isArray(pastMissions) && pastMissions.length) {
        await Promise.all(pastMissions.map(async m => {
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "closed" }),
          }).catch(() => {});
          // Rejeter toutes candidatures en attente
          await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${m.id}&status=eq.pending`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "rejected" }),
          }).catch(() => {});
          if (m.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: m.client_id,
                type: "mission",
                title: "Mission clôturée automatiquement",
                body: `Votre mission "${m.titre || m.metier || "mission"}" n'a pas trouvé de prestataire avant sa date — elle a été clôturée automatiquement.`,
                read: false,
              }),
            }).catch(() => {});
          }
        }));
        console.log(`[cron] auto-closed ${pastMissions.length} past-date open mission(s)`);
      }
    } catch (e) { console.error("[cron] auto-close past missions error:", e); }
  }

  // ── Mode reset mensuel (défaut) ─────────────────────────────────
  try {
    // Reset mensuel : remet missions_completed_month à 0 ET débloque trial_exhausted pour TOUS les profils.
    // Le quota free (2 missions/mois) est mensuel — trial_exhausted doit se réinitialiser chaque 1er du mois.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?or=(missions_completed_month.gt.0,trial_exhausted.is.true)`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0, trial_exhausted: false }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("cron-reset-monthly error:", err);
      return res.status(500).json({ error: "Erreur reset" });
    }

    // Downgrade des abonnements expirés — traité par batch de 50, paginé sur tous les utilisateurs
    let downgrades = 0;
    try {
      const allUsers = [];
      let downgradePage = 1;
      while (true) {
        const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${downgradePage}`, { headers });
        const usersData = await usersRes.json();
        const batch = usersData.users || [];
        allUsers.push(...batch);
        if (batch.length < 1000) break;
        downgradePage++;
      }
      const now = new Date();
      const toDowngrade = allUsers.filter(u => {
        const meta = u.user_metadata || {};
        return meta.plan_abonnement && meta.plan_abonnement !== "free" && meta.subscription_end_date
          && new Date(meta.subscription_end_date) < now;
      });
      const BATCH_SIZE = 50;
      for (let i = 0; i < toDowngrade.length; i += BATCH_SIZE) {
        const batch = toDowngrade.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async u => {
          const meta = u.user_metadata || {};
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
            method: "PUT", headers,
            body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: "free", subscription_end_date: null } }),
          }).catch(() => {});
          downgrades++;
        }));
        if (i + BATCH_SIZE < toDowngrade.length) await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) { console.error("cron downgrade error:", e); }

    console.log(`cron-reset-monthly: missions reset, ${downgrades} abonnements expirés downgradés`);
    return res.status(200).json({ success: true, downgrades });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
