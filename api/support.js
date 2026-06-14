async function verifyUser(req, supabaseUrl, serviceRoleKey) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

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

export default async function handler(req, res) {
  // ICS calendar file generation
  if (req.method === "GET" && req.query.ics === "1") {
    const { title = "Mission ALANE", date, start = "08:00", end = "17:00", location = "", description = "" } = req.query;
    if (!date) return res.status(400).json({ error: "date requis" });
    const toIcsDt = (dateStr, timeStr) => { const [y,m,d] = dateStr.split("-"); const [hh,mm] = timeStr.split(":"); return `${y}${m.padStart(2,"0")}${d.padStart(2,"0")}T${hh.padStart(2,"0")}${mm.padStart(2,"0")}00`; };
    const uid = `${Date.now()}@alane.fr`;
    const now = new Date().toISOString().replace(/[-:]/g,"").slice(0,15);
    const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ALANE//Mission//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${now}`,`DTSTART:${toIcsDt(date,start)}`,`DTEND:${toIcsDt(date,end)}`,`SUMMARY:${title.replace(/,/g,"\\,")}`,`LOCATION:${location.replace(/,/g,"\\,")}`,`DESCRIPTION:${description.replace(/,/g,"\\,")}`, "END:VEVENT","END:VCALENDAR"].join("\r\n");
    res.setHeader("Content-Type","text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="mission-alane.ics"');
    return res.status(200).send(ics);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
  const RESEND_FROM    = process.env.RESEND_FROM || "onboarding@resend.dev";

  // ── booking_confirm: send booking confirmation email to client ────
  if (req.body?.action === "booking_confirm") {
    const { clientEmail, clientName, prestaName, date, hours, total, job } = req.body;
    if (!clientEmail) return res.status(200).json({ ok: false, reason: "no email" });
    if (RESEND_API_KEY) {
      const bookingHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:'DM Sans',system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:32px 28px 24px;text-align:center;">
<div style="font-size:42px;margin-bottom:10px;">✅</div>
<h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 6px;">Réservation confirmée !</h1>
<p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;">Votre mission a bien été enregistrée</p></td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 20px;">Bonjour <strong>${esc(clientName)||"cher client"}</strong>,</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#162547;border-radius:14px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(124,111,224,0.25);"><tr><td style="padding:18px 20px;">
<p style="color:#7C6FE0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 14px;">Détails de la mission</p>
${[["👤 Prestataire",esc(prestaName)||"À confirmer"],["💼 Poste",esc(job)||"—"],["📅 Date",esc(date)||"—"],["⏱️ Durée",hours?`${esc(String(hours))}h`:"—"],["💶 Total bloqué",total?`${esc(String(total))} €`:"—"]].map(([l,v])=>`<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr><td style="color:#8B8FA8;font-size:13px;width:48%;">${l}</td><td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${v}</td></tr></table>`).join("")}
</td></tr></table>
<p style="color:#10D98F;font-size:13px;font-weight:600;margin:0 0 20px;">🔒 Votre argent est sécurisé en escrow et ne sera libéré qu'après validation mutuelle.</p>
<div style="text-align:center;margin-top:20px;"><a href='${process.env.APP_URL||"https://www.alane.fr"}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;">Suivre ma mission →</a></div>
</td></tr><tr><td style="padding:18px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${process.env.APP_URL||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: RESEND_FROM, to: [clientEmail], subject: `✅ Réservation confirmée — ${esc(job)||"Mission"} · ALANE`, html: bookingHtml }),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  // ── notify_signup: notify admin of new registration ──────────────
  if (req.body?.action === "notify_signup") {
    const { prenom, nom, email, role } = req.body;
    if (!prenom || !nom || !email || !role) return res.status(400).json({ error: "Missing fields" });

    if (!RESEND_API_KEY || !ADMIN_EMAIL || !RESEND_FROM) {
      return res.status(200).json({ ok: true, warning: "email skipped, missing env vars" });
    }

    const roleLabel = role === "prestataire" ? "Prestataire" : "Client";
    const html = emailHtml(`
      <p>Un nouveau compte est en attente de validation.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">Nom</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(prenom)} ${esc(nom)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(email)}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Rôle</td><td style="padding:8px 0;"><span style="background:${role === "prestataire" ? "#7C6FE020" : "#F0B42920"};color:${role === "prestataire" ? "#7C6FE0" : "#F0B429"};padding:3px 10px;border-radius:20px;font-size:13px;font-weight:700;">${esc(roleLabel)}</span></td></tr>
      </table>
      <p style="text-align:center;margin:24px 0;"><a href='${process.env.APP_URL||"https://www.alane.fr"}?bo=1' style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder au backoffice</a></p>
    `);

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: RESEND_FROM, to: [ADMIN_EMAIL], subject: `Nouvelle inscription ${roleLabel} — ${prenom} ${nom}`, html }),
      });
    } catch {}
    return res.status(200).json({ ok: true });
  }

  // ── track_referral: link new user to referrer ────────────────────
  if (req.body?.action === "track_referral") {
    const { newUserId, referrerUUID } = req.body;
    if (!newUserId || !referrerUUID) return res.status(400).json({ error: "Missing fields" });

    const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Config missing" });

    const hdrs = {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };

    try {
      // Set referred_by on new user
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
        method: "PATCH", headers: hdrs,
        body: JSON.stringify({ referred_by: referrerUUID }),
      });

      // Increment referral_count on referrer and get updated count
      const countRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${referrerUUID}&select=referral_count`, { headers: hdrs });
      const countData = await countRes.json();
      const currentCount = countData?.[0]?.referral_count || 0;
      const newCount = currentCount + 1;

      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${referrerUUID}`, {
        method: "PATCH", headers: hdrs,
        body: JSON.stringify({ referral_count: newCount }),
      });

      // If referrer reaches 3 filleuls, grant 1 month Premium
      if (newCount >= 3 && newCount % 3 === 0) {
        const endDate = new Date(Date.now() + 30 * 86400000).toISOString();
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${referrerUUID}`, {
          method: "PUT",
          headers: { ...hdrs, "Prefer": undefined },
          body: JSON.stringify({ user_metadata: { plan_abonnement: "premium", subscription_end_date: endDate } }),
        }).catch(() => {});
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: hdrs,
          body: JSON.stringify({ user_id: referrerUUID, type: "system", title: "🎁 1 mois Premium offert !", body: "Bravo ! Vous avez parrainé 3 filleuls abonnés. Votre mois Premium est activé automatiquement.", read: false }),
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true, newCount });
    } catch (e) {
      console.error("track_referral error:", e);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }

  // ── delete_account: RGPD art. 17 droit à l'effacement ───────────
  if (req.body?.action === "delete_account") {
    const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });
    const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
    if (!caller) return res.status(401).json({ error: "Non authentifié" });
    const userId = caller.id;
    const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify({ prenom: "Anonymisé", nom: "Anonymisé", cashback_balance: 0, missions_completed_month: 0 }),
      });
      for (const filter of [`client_id=eq.${userId}`, `prestataire_id=eq.${userId}`]) {
        await fetch(`${SUPABASE_URL}/rest/v1/missions?${filter}`, {
          method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" },
          body: JSON.stringify({ description: null, adresse: null, ville: null }),
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${userId}`, { method: "DELETE", headers: hdrs });
      await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}`, { method: "DELETE", headers: hdrs });
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?user_id=eq.${userId}`, {
        method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify({ user_email: null, user_name: null, user_id: null }),
      });
      const docsRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}&select=storage_path`, { headers: hdrs });
      const docs = await docsRes.json();
      if (Array.isArray(docs) && docs.length > 0) {
        const paths = docs.map(d => d.storage_path).filter(Boolean);
        if (paths.length > 0) await fetch(`${SUPABASE_URL}/storage/v1/object/documents`, { method: "DELETE", headers: hdrs, body: JSON.stringify({ prefixes: paths }) }).catch(() => {});
        await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}`, { method: "DELETE", headers: hdrs });
      }
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: hdrs });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error("delete_account error:", e.message);
      return res.status(500).json({ error: "Erreur lors de la suppression. Contactez le support." });
    }
  }

  // ── default: support ticket ───────────────────────────────────────
  const { subject, message, userEmail, userName, userId } = req.body || {};
  if (!subject || !message) return res.status(400).json({ error: "Sujet et message requis" });
  if (message.length < 10) return res.status(400).json({ error: "Le message doit contenir au moins 10 caractères" });
  if (subject.length > 200) return res.status(400).json({ error: "Le sujet ne doit pas dépasser 200 caractères" });
  if (message.length > 5000) return res.status(400).json({ error: "Le message ne doit pas dépasser 5000 caractères" });
  if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) return res.status(400).json({ error: "Adresse email invalide" });

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ subject, message, user_email: userEmail||null, user_name: userName||null, user_id: userId||null, status: "open" }),
    });

    if (!r.ok) {
      console.error("Supabase support error:", await r.text());
      return res.status(500).json({ error: "Impossible d'enregistrer le ticket" });
    }

    if (RESEND_API_KEY && ADMIN_EMAIL) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [ADMIN_EMAIL],
            subject: `[Support] ${subject}`,
            html: emailHtml(`
              <p>Nouveau ticket support reçu.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">De</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(userName)||"Inconnu"} (${esc(userEmail)||"email inconnu"})</td></tr>
                <tr><td style="padding:8px 0;color:#888;">Sujet</td><td style="padding:8px 0;font-weight:600;">${esc(subject)}</td></tr>
              </table>
              <div style="background:#f8f8fb;border-left:3px solid #7C6FE0;padding:14px 16px;border-radius:0 8px 8px 0;margin-top:16px;white-space:pre-wrap;">${esc(message)}</div>
            `),
          }),
        });
      } catch {}
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("support.js error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
