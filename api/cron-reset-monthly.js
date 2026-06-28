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
  const cronSecret  = process.env.CRON_SECRET;
  const boSecret    = process.env.BO_SESSION_SECRET;

  const isCron = !cronSecret || authHeader === `Bearer ${cronSecret}`;
  const isBo   = boSecret ? verifyBoToken(token, boSecret) : false;
  if (!isCron && !isBo) return res.status(401).json({ error: "Unauthorized" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${z.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "open", prestataire_id: null }),
          }).catch(() => {});
          if (z.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ user_id: z.client_id, type: "mission", title: "Prestataire non disponible", body: `Le prestataire n'a pas répondu pour "${z.titre || z.metier || "votre mission"}". Elle est remise en recherche.`, read: false }),
            }).catch(() => {});
          }
        }));
        console.log(`[cron] expired ${zombies.length} pending_acceptance zombie(s)`);
      }
    } catch (e) { console.error("[cron] zombie expiry error:", e); }
  }

  // ── Mode rappels quotidiens ─────────────────────────────────────
  if (req.query?.action === "reminders") {
    const RESEND_API_KEY    = process.env.RESEND_API_KEY;
    const RESEND_FROM       = process.env.RESEND_FROM || "onboarding@resend.dev";
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const smsEnabled = !!BREVO_API_KEY;

    try {
      // Charger tous les utilisateurs et profils une seule fois — utilisé par toutes les sections
      const [usersRes, profilesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers }),
      ]);
      const usersData = await usersRes.json();
      const userMap   = {};
      (usersData.users || []).forEach(u => { userMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });
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
${(() => {
  const appUrl = process.env.APP_URL || "https://www.alane.fr";
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
<div style="text-align:center;margin-top:16px;"><a href='${process.env.APP_URL||"https://www.alane.fr"}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Voir ma mission →</a></div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${process.env.APP_URL||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
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
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lt.${todayStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,ville,heure_debut,validation_prestataire,validation_client,last_validation_reminder_at`,
          { headers }
        );
        const pastMissionsRaw = await pastRes.json();
        const now = Date.now();
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const pastMissions = Array.isArray(pastMissionsRaw) ? pastMissionsRaw.filter(m => {
          if (!m.heure_debut) return true;
          const endMs = new Date(`${m.date}T${m.heure_debut}:00`).getTime() + (Number(m.hours || 0) * 3600000);
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
            const appUrl       = process.env.APP_URL || "https://www.alane.fr";
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
              const appUrl = process.env.APP_URL || "https://www.alane.fr";

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

      // ── 4. Notifications fin de mission (fusionné ici — évite le 3e cron Vercel Hobby) ──
      let endNotifSent = 0;
      try {
        const appUrl = process.env.APP_URL || "https://www.alane.fr";
        const nowMs = Date.now();
        const enRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&end_notif_sent=not.is.true&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville`,
          { headers }
        );
        const allEndMissions = await enRes.json().catch(() => []);
        const endedMissions = Array.isArray(allEndMissions) ? allEndMissions.filter(m => {
          if (!m.date) return false;
          const [h2 = 8, mn2 = 0] = (m.heure_debut || "08:00").split(":").map(Number);
          const naiveMs2 = new Date(`${m.date}T${String(h2).padStart(2,"0")}:${String(mn2).padStart(2,"0")}:00`).getTime();
          return nowMs >= naiveMs2 + frenchOffsetMs(new Date(naiveMs2)) + Number(m.hours || 1) * 3600000;
        }) : [];
        for (const m of endedMissions) {
          try {
            const mLabel = esc(m.metier || m.sector || "Mission");
            const mInfo  = `${mLabel} · ${esc(m.ville || "")} · ${m.date}`;
            const pName  = nameMap[m.prestataire_id] || "Prestataire";
            const cName  = nameMap[m.client_id]  || "Client";
            const pEmail = userMap[m.prestataire_id]?.email;
            const cEmail = userMap[m.client_id]?.email;
            const sends2 = [];
            if (RESEND_API_KEY && pEmail)
              sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[pEmail], subject:`🎉 Mission terminée — confirmez pour être payé(e) · ALANE`, html: `<p>Bonjour ${esc(pName)}, votre mission <strong>${mLabel}</strong> (${mInfo}) vient de se terminer. Confirmez la fin depuis votre espace ALANE. <a href="${appUrl}">→ Confirmer</a></p>` }) }).catch(()=>{}));
            if (RESEND_API_KEY && cEmail)
              sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[cEmail], subject:`✅ Mission terminée — validation en attente · ALANE`, html: `<p>Bonjour ${esc(cName)}, la mission <strong>${mLabel}</strong> (${mInfo}) vient de se terminer. Validez-la depuis votre espace. <a href="${appUrl}">→ Valider</a></p>` }) }).catch(()=>{}));
            await Promise.all(sends2);
            endNotifSent += sends2.length;
            await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ end_notif_sent: true }),
            }).catch(() => {});
          } catch (e2) { console.error(`end-notif mission ${m.id}:`, e2); }
        }
      } catch (e) { console.error("cron end-notif error:", e); }

      return res.status(200).json({ success: true, reminders: sent, validationReminders: validationSent, autoValidated, endNotifSent, missions: missions.length });
    } catch (e) {
      console.error("cron reminders error:", e);
      return res.status(500).json({ error: "Erreur rappels" });
    }
  }

  // ── Notification immédiate de fin de mission (toutes les 15 min) ──
  if (req.query?.action === "end-notif") {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM    = process.env.RESEND_FROM || "onboarding@resend.dev";
    const BREVO_API_KEY  = process.env.BREVO_API_KEY;
    const appUrl         = process.env.APP_URL || "https://www.alane.fr";

    try {
      // Missions assignées dont end_notif_sent n'est pas encore true
      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&end_notif_sent=not.is.true&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville`,
        { headers }
      );
      const allMissions = await mRes.json();
      if (!Array.isArray(allMissions)) return res.status(200).json({ sent: 0 });

      const nowMs = Date.now();
      // Filtrer celles dont l'heure de fin est passée (UTC+2, France CEST)
      const ended = allMissions.filter(m => {
        if (!m.date) return false;
        const [h = 8, mn = 0] = (m.heure_debut || "08:00").split(":").map(Number);
        const _missionStart = new Date(`${m.date}T${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}:00`);
        const missionEndMs = _missionStart.getTime()
          + frenchOffsetMs(_missionStart)
          + Number(m.hours || 1) * 3600000;
        return nowMs >= missionEndMs;
      });

      if (ended.length === 0) return res.status(200).json({ sent: 0 });

      // Charger emails et téléphones une fois pour toutes — après le filtre pour ne charger que si nécessaire
      const uids = [...new Set(ended.flatMap(m => [m.client_id, m.prestataire_id].filter(Boolean)))];
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
      const usersData = await usersRes.json();
      const userMap = {};
      (usersData.users || []).forEach(u => { userMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });

      const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profilesData = await profilesRes.json();
      const nameMap = {};
      (Array.isArray(profilesData) ? profilesData : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });

      let sent = 0;
      for (const m of ended) {
        try {
          const missionLabel = esc(m.metier || m.sector || "Mission");
          const missionInfo  = `${missionLabel} · ${esc(m.ville || "")} · ${m.date}`;
          const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
          const clientName   = nameMap[m.client_id]  || "Client";
          const prestaEmail  = userMap[m.prestataire_id]?.email;
          const clientEmail  = userMap[m.client_id]?.email;
          const prestaPhone  = userMap[m.prestataire_id]?.meta?.telephone;
          const clientPhone  = userMap[m.client_id]?.meta?.telephone;

          const prestaHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#10D98F,#0ABF7A);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">🎉</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Mission terminée !</h1>
<p style="color:rgba(255,255,255,0.85);font-size:13px;margin:0;">${missionInfo}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(prestaName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">
  Votre mission <strong style="color:#10D98F;">${missionLabel}</strong> vient de se terminer.<br/><br/>
  <strong style="color:#fff;">Confirmez la fin de prestation</strong> depuis votre espace ALANE pour déclencher votre paiement.
  Le client disposera ensuite de 24h pour valider — passé ce délai, la mission est automatiquement validée.
</p>
<div style="text-align:center;margin-top:24px;">
<a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#10D98F,#0ABF7A);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:800;font-size:15px;">Confirmer ma mission →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

          const clientHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#F0B429,#E09B10);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">✅</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Mission terminée — en attente de validation</h1>
<p style="color:rgba(255,255,255,0.85);font-size:13px;margin:0;">${missionInfo}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(clientName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">
  La mission <strong style="color:#F0B429;">${missionLabel}</strong> vient de se terminer.<br/><br/>
  Votre prestataire va confirmer la fin depuis son espace. Vous recevrez une notification dès que c'est fait pour valider le paiement.
  <br/><br/>
  <strong style="color:#fff;">Si votre prestataire ne confirme pas sous 24h</strong>, la mission sera validée automatiquement.
</p>
<div style="text-align:center;margin-top:24px;">
<a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#F0B429,#E09B10);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:800;font-size:15px;">Suivre ma mission →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

          // UPDATE atomique conditionnel : "réserver" la mission avant d'envoyer pour éviter les doubles envois
          const reserved = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}&end_notif_sent=is.false`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=representation" },
            body: JSON.stringify({ end_notif_sent: true }),
          }).catch(() => null);
          if (!reserved) continue;
          const reservedData = await reserved.json().catch(() => []);
          if (!Array.isArray(reservedData) || reservedData.length === 0) continue; // Déjà traité par un autre run

          const sends = [];
          if (RESEND_API_KEY && prestaEmail)
            sends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[prestaEmail], subject:`🎉 Mission terminée — confirmez pour être payé(e) · ALANE`, html: prestaHtml }) }).catch(()=>{}));
          if (RESEND_API_KEY && clientEmail)
            sends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[clientEmail], subject:`✅ Mission terminée — validation en attente · ALANE`, html: clientHtml }) }).catch(()=>{}));
          if (BREVO_API_KEY && prestaPhone)
            sends.push(sendSms(BREVO_API_KEY, prestaPhone, `🎉 ALANE - Votre mission ${m.metier||"Mission"} est terminée ! Confirmez la fin depuis l'app pour recevoir votre paiement. — alane.fr`));
          if (BREVO_API_KEY && clientPhone)
            sends.push(sendSms(BREVO_API_KEY, clientPhone, `✅ ALANE - Votre mission ${m.metier||"Mission"} est terminée. Votre prestataire va confirmer, vous serez notifié(e) pour valider. — alane.fr`));

          await Promise.all(sends);
          sent += sends.length;
        } catch (e) { console.error(`end-notif mission ${m.id}:`, e); }
      }

      return res.status(200).json({ success: true, processed: ended.length, sent });
    } catch (e) {
      console.error("end-notif cron error:", e);
      return res.status(500).json({ error: "Erreur end-notif" });
    }
  }

  // ── Mode reset mensuel (défaut) ─────────────────────────────────
  try {
    // trial_exhausted=not.is.true : ne pas remettre à 0 les profils dont l'offre est épuisée
    // → evite que le compteur "retombe" à 0 et laisse croire qu'un nouveau quota est disponible
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?missions_completed_month=gt.0&trial_exhausted=not.is.true`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0 }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("cron-reset-monthly error:", err);
      return res.status(500).json({ error: "Erreur reset" });
    }

    // Downgrade des abonnements expirés — traité par batch de 50 pour éviter le rate limiting Supabase Auth
    let downgrades = 0;
    try {
      const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
      const usersData = await usersRes.json();
      const allUsers = usersData.users || [];
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
