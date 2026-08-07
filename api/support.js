import { esc, emailHtml, sendEmail, hashPii } from "./_email.js";
import { verifyUser } from "./_auth.js";

// Rate limiting anti-spam pour les soumissions de contact publiques
const _contactRl = new Map();
function checkContactRateLimit(ip, max = 3) {
  const now = Date.now();
  const rec = _contactRl.get(ip) || { count: 0, reset: now + 600_000 }; // 10 min
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 600_000; }
  rec.count++;
  _contactRl.set(ip, rec);
  return rec.count > max;
}

export default async function handler(req, res) {
  // ICS calendar file generation
  if (req.method === "GET" && req.query.ics === "1") {
    const { title = "Prestation ALANE", date, start = "08:00", end = "17:00", location = "", description = "" } = req.query;
    if (!date) return res.status(400).json({ error: "date requis" });
    const sanitizeIcs = (s) => String(s || "").replace(/[\r\n]/g, " ").replace(/,/g, "\\,");
    const toIcsDt = (dateStr, timeStr) => { const [y,m,d] = dateStr.split("-"); const [hh,mm] = timeStr.split(":"); return `${y}${m.padStart(2,"0")}${d.padStart(2,"0")}T${hh.padStart(2,"0")}${mm.padStart(2,"0")}00`; };
    const uid = `${Date.now()}@alane.fr`;
    const now = new Date().toISOString().replace(/[-:]/g,"").slice(0,15);
    const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ALANE//Mission//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${now}`,`DTSTART:${toIcsDt(date,start)}`,`DTEND:${toIcsDt(date,end)}`,`SUMMARY:${sanitizeIcs(title)}`,`LOCATION:${sanitizeIcs(location)}`,`DESCRIPTION:${sanitizeIcs(description)}`, "END:VEVENT","END:VCALENDAR"].join("\r\n");
    res.setHeader("Content-Type","text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="prestation-alane.ics"');
    return res.status(200).send(ics);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  // ── welcome: send welcome email after registration ────────────────
  if (req.body?.action === "welcome") {
    const _welcomeCaller = await verifyUser(req, (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, ""), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, ""));
    if (!_welcomeCaller) return res.status(401).json({ error: "Non authentifié" });
    const { email, prenom, nom, role } = req.body;
    if (!email || !prenom) return res.status(200).json({ ok: true });

    // Anti-abus : vérifier immédiatement la blacklist dès l'inscription
    // Si un identifiant match, marquer trial_exhausted=true avant même l'approbation BO
    const SUPABASE_URL2 = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "") || process.env.SUPABASE_URL;
    const SERVICE_KEY2  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    if (SUPABASE_URL2 && SERVICE_KEY2) {
      try {
        const svcHeaders = {
          "apikey": SERVICE_KEY2,
          "Authorization": `Bearer ${SERVICE_KEY2}`,
          "Content-Type": "application/json",
        };
        // Récupérer les métadonnées du compte qui vient d'être créé (phone + IBAN)
        const usersRes = await fetch(
          `${SUPABASE_URL2}/auth/v1/admin/users?email=${encodeURIComponent(email)}&per_page=1`,
          { headers: svcHeaders }
        );
        const usersData = await usersRes.json();
        const newUser = usersData?.users?.[0];
        if (newUser) {
          const meta3 = newUser.user_metadata || {};
          const tel3   = meta3.telephone || null;
          // `profiles.rib` d'abord — voir migration 2026-07-30_rgpd_iban_hors_du_jeton.
          let rib3 = meta3.rib;
          try {
            // SUPABASE_URL2, pas SUPABASE_URL : ce dernier est déclaré plus bas
            // dans la même fonction, si bien que le lire ici levait
            // « Cannot access before initialization » à chaque inscription. Le
            // catch l'avalait, `rib3` restait à `meta3.rib` — vide depuis que
            // l'IBAN a quitté le jeton — et le contrôle anti-recréation ne
            // reconnaissait plus jamais un IBAN déjà blacklisté.
            const rP3 = await fetch(`${SUPABASE_URL2}/rest/v1/profiles?id=eq.${newUser.id}&select=rib&limit=1`, { headers: svcHeaders });
            const dP3 = await rP3.json().catch(() => []);
            if (Array.isArray(dP3) && dP3[0]?.rib) rib3 = dP3[0].rib;
          } catch (e) {
            console.error("[signup] lecture de profiles.rib impossible :", e.message);
          }
          const iban3  = rib3 ? String(rib3).replace(/\s/g, "").toUpperCase() : null;
          const siret3 = meta3.kbis || null;
          const orFilters3 = [];
          if (email)   orFilters3.push(`email_hash.eq.${hashPii(email)}`);
          if (tel3)    orFilters3.push(`telephone_hash.eq.${hashPii(tel3)}`);
          if (iban3)   orFilters3.push(`iban_hash.eq.${hashPii(iban3)}`);
          if (siret3)  orFilters3.push(`siret_hash.eq.${hashPii(siret3)}`);
          if (orFilters3.length > 0) {
            const blParams3 = new URLSearchParams({ or: `(${orFilters3.join(",")})`, select: "id", limit: "1" });
            const blRes3 = await fetch(`${SUPABASE_URL2}/rest/v1/account_blacklist?${blParams3}`, { headers: svcHeaders });
            const blData3 = await blRes3.json();
            if (Array.isArray(blData3) && blData3.length > 0) {
              await fetch(`${SUPABASE_URL2}/rest/v1/profiles?id=eq.${newUser.id}`, {
                method: "PATCH",
                headers: { ...svcHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({ trial_exhausted: true }),
              }).catch(() => {});
              console.log("[welcome] Compte blacklisté détecté à l'inscription — trial_exhausted=true");
            }
          }
        }
      } catch (blErr) {
        console.error("[welcome] Erreur check blacklist:", blErr.message);
      }
    }

    const isPresta = role === "prestataire";
    const welcomeHtml = emailHtml(`
      <p>Bonjour <strong>${esc(prenom)}</strong>,</p>
      <p>Votre inscription sur <strong>ALANE</strong> a bien été reçue. ${isPresta ? "Notre équipe va examiner votre dossier et vous enverrons un email dès validation de votre compte (généralement sous 24h)." : "Notre équipe va valider votre compte et vous enverrons un email dès approbation."}</p>
      <p>En attendant, si vous avez des questions, n'hésitez pas à contacter notre support.</p>
      <p>À très bientôt,<br/><strong>L'équipe ALANE</strong></p>
    `);
    await sendEmail({ to: email, subject: `Bienvenue sur ALANE, ${esc(prenom)} !`, html: welcomeHtml });
    return res.status(200).json({ ok: true });
  }

  // ── booking_confirm: send booking confirmation email to client ────
  if (req.body?.action === "booking_confirm") {
    const _bookingCaller = await verifyUser(req, (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, ""), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, ""));
    if (!_bookingCaller) return res.status(401).json({ error: "Non authentifié" });
    const { clientEmail, clientName, prestaName, date, startTime, hours, adresse, ville, total, job } = req.body;
    // Sortie silencieuse historique : la confirmation n'était pas envoyée et rien
    // ne le disait, ni au client ni dans les journaux. C'est le seul chemin qui
    // explique une confirmation absente alors que l'email au prestataire part.
    if (!clientEmail) {
      console.error("[booking_confirm] aucune adresse client transmise — confirmation NON envoyée. caller:", _bookingCaller.id);
      return res.status(200).json({ ok: false, reason: "no email" });
    }
    console.log("[booking_confirm] envoi de la confirmation au client (domaine:", String(clientEmail).split("@")[1] || "?", ")");
    const bookingHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:'DM Sans',system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:32px 28px 24px;text-align:center;">
<div style="font-size:42px;margin-bottom:10px;">✅</div>
<h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 6px;">Réservation confirmée !</h1>
<p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;">Votre prestation a bien été enregistrée</p></td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 20px;">Bonjour <strong>${esc(clientName)||"cher client"}</strong>,</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#162547;border-radius:14px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(124,111,224,0.25);"><tr><td style="padding:18px 20px;">
<p style="color:#7C6FE0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 14px;">Détails de la prestation</p>
${[["👤 Prestataire",esc(prestaName)||"À confirmer"],["💼 Poste",esc(job)||"—"],["📅 Date",esc(date)||"—"],["🕐 Heure de début",esc(startTime)||"—"],["⏱️ Durée",hours?`${esc(String(hours))}h`:"—"],["📍 Lieu",[esc(adresse),esc(ville)].filter(Boolean).join(", ")||"—"],["💶 Total bloqué",total?`${esc(String(total))} €`:"—"]].map(([l,v])=>`<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr><td style="color:#8B8FA8;font-size:13px;width:48%;">${l}</td><td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${v}</td></tr></table>`).join("")}
</td></tr></table>
<p style="color:#10D98F;font-size:13px;font-weight:600;margin:0 0 20px;">🔒 Votre argent est sécurisé en escrow et ne sera libéré qu'après validation mutuelle.</p>
<div style="text-align:center;margin-top:20px;"><a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;">Suivre ma prestation →</a></div>
</td></tr><tr><td style="padding:18px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;
    await sendEmail({ to: clientEmail, subject: `✅ Réservation confirmée — ${esc(job)||"Prestation"} · ALANE`, html: bookingHtml });
    return res.status(200).json({ ok: true });
  }

  // ── notify_signup: notify admin of new registration ──────────────
  if (req.body?.action === "notify_signup") {
    const _signupCaller = await verifyUser(req, (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, ""), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, ""));
    if (!_signupCaller) return res.status(401).json({ error: "Non authentifié" });
    const { prenom, nom, email, role } = req.body;
    if (!prenom || !nom || !email || !role) return res.status(400).json({ error: "Missing fields" });

    const notifDest = ADMIN_EMAIL || "direction@alane.fr";
    const roleLabel = role === "prestataire" ? "Prestataire" : "Client";
    const html = emailHtml(`
      <p>Un nouveau compte est en attente de validation.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">Nom</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(prenom)} ${esc(nom)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(email)}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Rôle</td><td style="padding:8px 0;"><span style="background:${role === "prestataire" ? "#7C6FE020" : "#F0B42920"};color:${role === "prestataire" ? "#7C6FE0" : "#F0B429"};padding:3px 10px;border-radius:20px;font-size:13px;font-weight:700;">${esc(roleLabel)}</span></td></tr>
      </table>
      <p style="text-align:center;margin:24px 0;"><a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}?bo=1' style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Accéder au backoffice</a></p>
    `);

    const cleanSubject = `Nouvelle inscription ${roleLabel} — ${String(prenom||"").replace(/[\r\n]/g," ")} ${String(nom||"").replace(/[\r\n]/g," ")}`;
    await sendEmail({ to: notifDest, subject: cleanSubject, html });
    return res.status(200).json({ ok: true });
  }

  // ── track_referral: link new user to referrer ────────────────────
  if (req.body?.action === "track_referral") {
    const { newUserId, referrerUUID } = req.body;
    if (!newUserId || !referrerUUID) return res.status(400).json({ error: "Missing fields" });
    const isUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ""));
    if (!isUuid(newUserId) || !isUuid(referrerUUID)) return res.status(400).json({ error: "IDs invalides" });
    if (newUserId === referrerUUID) return res.status(400).json({ error: "Auto-parrainage interdit" });

    // S-09: le parrainage ne peut être enregistré que par le nouvel utilisateur lui-même
    const SUPABASE_URL_REF = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE_KEY_REF = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    if (!SUPABASE_URL_REF || !SERVICE_ROLE_KEY_REF) return res.status(500).json({ error: "Config missing" });
    const callerRef = await verifyUser(req, SUPABASE_URL_REF, SERVICE_ROLE_KEY_REF);
    if (!callerRef) return res.status(401).json({ error: "Non authentifié" });
    if (callerRef.id !== newUserId) return res.status(403).json({ error: "Non autorisé — vous ne pouvez enregistrer que votre propre parrainage" });

    const SUPABASE_URL     = SUPABASE_URL_REF;
    const SERVICE_ROLE_KEY = SERVICE_ROLE_KEY_REF;

    const hdrs = {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };

    try {
      // Rattachement du filleul à son parrain. La récompense n'est PLUS évaluée
      // ici : la plateforme promet « 3 filleuls ABONNÉS », et un filleul qui vient
      // de s'inscrire n'a rien souscrit. L'évaluation se fait donc au moment où il
      // souscrit réellement, dans le webhook Stripe.
      const patchFilleul = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}&referred_by=is.null`, {
        method: "PATCH", headers: { ...hdrs, "Prefer": "return=representation" },
        body: JSON.stringify({ referred_by: referrerUUID }),
      });
      const lignes = await patchFilleul.json().catch(() => []);
      if (!patchFilleul.ok || !Array.isArray(lignes) || lignes.length === 0) {
        // Filtre sur referred_by IS NULL : un parrainage ne se réattribue pas.
        console.error(`[track_referral] rattachement refusé — filleul ${newUserId} déjà parrainé ou écriture impossible (${patchFilleul.status})`);
        return res.status(409).json({ error: "Ce compte est déjà rattaché à un parrain." });
      }

      // Le compteur est recalculé depuis la source plutôt qu'incrémenté : deux
      // inscriptions simultanées se perdaient mutuellement.
      const cntRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?referred_by=eq.${referrerUUID}&select=id`,
        { method: "HEAD", headers: { ...hdrs, "Prefer": "count=exact" } }
      );
      const plage = cntRes.headers.get("content-range") || "";
      const newCount = parseInt(plage.split("/")[1], 10) || 0;
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${referrerUUID}`, {
        method: "PATCH", headers: hdrs,
        body: JSON.stringify({ referral_count: newCount }),
      }).catch(e => console.error("[track_referral] compteur non mis à jour :", e.message));

      return res.status(200).json({ ok: true, newCount });
    } catch (e) {
      console.error("track_referral error:", e);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }

  // ── delete_account: RGPD art. 17 droit à l'effacement ───────────
  if (req.body?.action === "delete_account") {
    const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });
    const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
    if (!caller) return res.status(401).json({ error: "Non authentifié" });
    const userId = caller.id;
    const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
    try {
      // S-10: block deletion if user has active missions
      const activeMissionsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?or=(client_id.eq.${userId},prestataire_id.eq.${userId})&status=in.(open,pending_acceptance,assigned)&select=id&limit=1`,
        { headers: hdrs }
      );
      const activeMissions = await activeMissionsRes.json().catch(() => []);
      if (Array.isArray(activeMissions) && activeMissions.length > 0) {
        return res.status(409).json({ error: "Impossible de supprimer votre compte : vous avez une prestation en cours. Terminez ou annulez vos prestations actives avant de supprimer votre compte." });
      }

      // Empreinte anti-recréation, AVANT l'anonymisation qui rend les données
      // illisibles.
      //
      // La suppression par le backoffice alimentait `account_blacklist` ; la
      // suppression par l'utilisateur lui-même, non. Or c'est le chemin que les
      // gens empruntent. Il suffisait donc de supprimer son compte depuis
      // l'application, puis de se réinscrire, pour retrouver un essai gratuit —
      // et recommencer autant de fois que voulu. Le dispositif anti-abus
      // n'existait que pour les comptes supprimés par l'administration.
      //
      // La table ne stocke que des empreintes, jamais de données en clair : elle
      // reste compatible avec le droit à l'effacement, qu'elle sert même, en
      // évitant de conserver les identifiants pour arriver au même résultat.
      try {
        const prSup = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=rib&limit=1`, { headers: hdrs });
        const pdSup = prSup.ok ? await prSup.json().catch(() => []) : [];
        const ribSup = (Array.isArray(pdSup) && pdSup[0]?.rib) || caller.user_metadata?.rib || null;
        const ibanSup = ribSup ? String(ribSup).replace(/\s/g, "").toUpperCase() : null;
        const telSup   = caller.user_metadata?.telephone || null;
        const siretSup = caller.user_metadata?.siret || caller.user_metadata?.kbis || null;

        if (caller.email || telSup || ibanSup || siretSup) {
          const blRes = await fetch(`${SUPABASE_URL}/rest/v1/account_blacklist`, {
            method: "POST", headers: { ...hdrs, "Prefer": "return=minimal" },
            body: JSON.stringify({
              email_hash:     hashPii(caller.email),
              telephone_hash: hashPii(telSup),
              iban_hash:      hashPii(ibanSup),
              siret_hash:     hashPii(siretSup),
              reason:         "account_deleted: suppression par l'utilisateur",
            }),
          });
          if (!blRes.ok) {
            console.error(`[delete_account] empreinte non enregistrée (${blRes.status}) — `
              + "le compte pourra être recréé avec un nouvel essai gratuit.");
          }
        }
      } catch (blErr) {
        // On ne bloque pas la suppression : le droit à l'effacement prime sur le
        // dispositif anti-abus. Mais on le signale.
        console.error("[delete_account] empreinte anti-recréation non calculée :", blErr.message);
      }

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
        // Bucket = "Documents" (casse significative). L'ancienne valeur en minuscules
        // échouait silencieusement : les pièces d'identité restaient en ligne après
        // une demande de suppression de compte.
        if (paths.length > 0) {
          const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/Documents`, { method: "DELETE", headers: hdrs, body: JSON.stringify({ prefixes: paths }) }).catch(() => null);
          if (!delRes || !delRes.ok) console.error("delete_account: suppression storage échouée", delRes?.status, paths.length, "fichier(s)");
        }
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
  const { subject, message, userEmail, userName, _hp } = req.body || {};
  if (!subject || !message) return res.status(400).json({ error: "Sujet et message requis" });
  if (message.length < 10) return res.status(400).json({ error: "Le message doit contenir au moins 10 caractères" });
  if (subject.length > 200) return res.status(400).json({ error: "Le sujet ne doit pas dépasser 200 caractères" });
  if (message.length > 5000) return res.status(400).json({ error: "Le message ne doit pas dépasser 5000 caractères" });
  if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) return res.status(400).json({ error: "Adresse email invalide" });
  // Anti-spam : honeypot + rate limit (tous les utilisateurs, limite plus haute si authentifié)
  if (_hp) return res.status(200).json({ success: true }); // Champ honeypot rempli = bot

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  // Le formulaire est public — il sert aussi aux visiteurs non inscrits — mais
  // l'identité, elle, ne se déclare pas.
  //
  // `userId` était lu depuis le corps de la requête, et servait à deux choses :
  // relever la limite anti-spam de 3 à 20 messages par dix minutes, et attribuer
  // le ticket à un compte. Il suffisait donc d'inventer un identifiant pour
  // obtenir la limite haute, et d'en copier un vrai pour faire écrire un ticket
  // au nom de quelqu'un d'autre.
  //
  // Le jeton est vérifié quand il est présent ; l'identifiant retenu est celui
  // qu'il porte, jamais celui du corps.
  const ticketCaller = req.headers.authorization
    ? await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY)
    : null;
  const ticketUserId = ticketCaller?.id || null;

  const rlIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",").at(-1).trim();
  const rlMax = ticketUserId ? 20 : 3; // 20/10min pour authentifiés, 3/10min pour anonymes
  if (checkContactRateLimit(rlIp, rlMax)) return res.status(429).json({ error: "Trop de messages envoyés — réessayez dans 10 minutes" });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ subject, message, user_email: userEmail||null, user_name: userName||null, user_id: ticketUserId, status: "open" }),
    });

    if (!r.ok) {
      console.error("Supabase support error:", await r.text());
      return res.status(500).json({ error: "Impossible d'enregistrer le ticket" });
    }

    if (ADMIN_EMAIL) {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `[Support] ${subject}`,
        html: emailHtml(`
          <p>Nouveau ticket support reçu.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;width:120px;">De</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${esc(userName)||"Inconnu"} (${esc(userEmail)||"email inconnu"})</td></tr>
            <tr><td style="padding:8px 0;color:#888;">Sujet</td><td style="padding:8px 0;font-weight:600;">${esc(subject)}</td></tr>
          </table>
          <div style="background:#f8f8fb;border-left:3px solid #7C6FE0;padding:14px 16px;border-radius:0 8px 8px 0;margin-top:16px;white-space:pre-wrap;">${esc(message)}</div>
        `),
      });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("support.js error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
