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
          await Promise.all(sends);
          sent += sends.length;
        }));
      }

      // ── 2. Rappels de validation pour missions passées non validées ──
      const todayStr = new Date().toISOString().slice(0, 10);
      let validationSent = 0;
      try {
        const pastRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lt.${todayStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,ville`,
          { headers }
        );
        const pastMissions = await pastRes.json();
        if (Array.isArray(pastMissions) && pastMissions.length && RESEND_API_KEY) {
          await Promise.all(pastMissions.map(async (m) => {
            const clientEmail  = userMap[m.client_id]?.email;
            const prestaEmail  = userMap[m.prestataire_id]?.email;
            const clientName   = nameMap[m.client_id]  || "Client";
            const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
            const appUrl       = process.env.APP_URL || "https://www.alane.fr";
            const missionLabel = `${esc(m.metier||"Mission")} · ${esc(m.ville||"")} · ${m.date}`;
            const validHtml = (toName) => `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#F0B429,#E09B10);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">✅</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Validez votre mission</h1>
<p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0;">${missionLabel}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(toName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">La date de votre mission est passée. Pensez à <strong style="color:#F0B429;">valider la mission</strong> depuis votre espace pour finaliser le paiement et obtenir votre cashback.</p>
<div style="text-align:center;margin-top:20px;">
<a href="${appUrl}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Valider ma mission →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;
            const vSends = [];
            if (clientEmail) vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[clientEmail], subject:`✅ Validez votre mission du ${m.date} — ALANE`, html: validHtml(clientName) }) }).catch(()=>{}));
            if (prestaEmail) vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify({ from: RESEND_FROM, to:[prestaEmail], subject:`✅ Validez votre mission du ${m.date} — ALANE`, html: validHtml(prestaName) }) }).catch(()=>{}));
            await Promise.all(vSends);
            validationSent += vSends.length;
          }));
        }
      } catch (e) { console.error("cron validation reminders error:", e); }

      // ── 3. Auto-validation après 24h si le prestataire a validé ─────
      let autoValidated = 0;
      try {
        // DST-safe : soustraire 1 jour calendaire plutôt que 86400000ms
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        const avRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&validation_prestataire=eq.true&validation_client=eq.false&date=lte.${yesterdayStr}&select=id,client_id,prestataire_id,hours,tarif_horaire,metier,sector`,
          { headers }
        );
        const autoMissions = await avRes.json();

        if (Array.isArray(autoMissions) && autoMissions.length) {
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
              const hours = m.hours || 0;
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

              // Marquer la mission complétée
              const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ status: "completed", validation_client: true, montant_total: montantTotal }),
              });
              if (!patchRes.ok) {
                console.error(`cron auto-validate: PATCH mission ${m.id} failed`, await patchRes.text());
                continue;
              }

              await Promise.all([
                // Mettre à jour le cashback client
                fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ cashback_balance: newBalance, missions_completed_month: missionsThisMonth }),
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

      return res.status(200).json({ success: true, reminders: sent, validationReminders: validationSent, autoValidated, missions: missions.length });
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
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
              method: "PUT", headers,
              body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: "free", subscription_end_date: null } }),
            }).catch(() => {});
            downgrades++;
          }
        }
      }));
    } catch (e) { console.error("cron downgrade error:", e); }

    console.log(`cron-reset-monthly: missions reset, ${downgrades} abonnements expirés downgradés`);
    return res.status(200).json({ success: true, downgrades });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
