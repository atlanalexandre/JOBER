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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, ...payload } = req.body || {};

  // Validation globale
  if (!action || typeof action !== "string" || action.length > 50) {
    return res.status(400).json({ error: "Action invalide" });
  }
  const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {
    if (action === "list_open") {
      const { sector, metier } = payload;
      let url = `${SUPABASE_URL}/rest/v1/missions?status=eq.open&order=created_at.desc`;
      if (sector) url += `&sector=eq.${encodeURIComponent(sector)}`;
      if (metier) url += `&metier=eq.${encodeURIComponent(metier)}`;
      const r = await fetch(url, { headers });
      const missions = await r.json();
      return res.status(200).json(Array.isArray(missions) ? missions : []);
    }

    if (action === "list_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const client_id = caller.id;
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?client_id=eq.${client_id}&order=created_at.desc`,
        { headers }
      );
      const missions = await r.json();
      if (!Array.isArray(missions)) return res.status(200).json([]);

      const enriched = await Promise.all(missions.map(async (m) => {
        const cr = await fetch(
          `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${m.id}&select=id,prestataire_id,status,created_at`,
          { headers }
        );
        const candidatures = await cr.json();
        return { ...m, candidatures: Array.isArray(candidatures) ? candidatures : [] };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "get_candidatures") {
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&order=created_at.asc`,
        { headers }
      );
      const candidatures = await r.json();
      if (!Array.isArray(candidatures)) return res.status(200).json([]);

      const enriched = await Promise.all(candidatures.map(async (c) => {
        const pr = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${c.prestataire_id}&select=prenom,nom`,
          { headers }
        );
        const profiles = await pr.json();
        const profile = Array.isArray(profiles) && profiles[0];
        return { ...c, prenom: profile?.prenom || "", nom: profile?.nom || "" };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "mes_candidatures") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const prestataire_id = caller.id;
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${prestataire_id}&order=created_at.desc`,
        { headers }
      );
      const candidatures = await r.json();
      if (!Array.isArray(candidatures)) return res.status(200).json([]);

      const enriched = await Promise.all(candidatures.map(async (c) => {
        const mr = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?id=eq.${c.mission_id}&select=sector,metier,date,hours,ville,status,tarif_horaire`,
          { headers }
        );
        const missions = await mr.json();
        const mission = Array.isArray(missions) && missions[0];
        return { ...c, mission: mission || null };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "apply") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, message } = payload;
      const prestataire_id = caller.id;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (message && (typeof message !== "string" || message.length > 1000)) return res.status(400).json({ error: "Message trop long (max 1000 caractères)" });

      // Vérifier la limite mensuelle selon le plan (lu depuis platform_settings)
      let PLAN_LIMITS = { free: 2, premium: 10, elite: 999 };
      try {
        const settingsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/platform_settings?key=eq.plan_limits&select=value`,
          { headers }
        );
        const settingsData = await settingsRes.json();
        if (Array.isArray(settingsData) && settingsData[0]?.value) {
          PLAN_LIMITS = settingsData[0].value;
        }
      } catch {}
      try {
        const [userRes, profileRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataire_id}&select=missions_completed_month`, { headers }),
        ]);
        const userData = await userRes.json();
        const profileData = await profileRes.json();
        let plan = userData.user_metadata?.plan_abonnement || "free";

        // Vérifier l'expiry de l'abonnement — downgrade auto si expiré
        const endDate = userData.user_metadata?.subscription_end_date;
        if (endDate && plan !== "free" && new Date(endDate) < new Date()) {
          plan = "free";
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, {
            method: "PUT", headers,
            body: JSON.stringify({ user_metadata: { plan_abonnement: "free", subscription_end_date: null } }),
          }).catch(() => {});
        }

        const limit = PLAN_LIMITS[plan] ?? 2;
        if (limit < 999) {
          const completedThisMonth = (Array.isArray(profileData) && profileData[0]?.missions_completed_month) || 0;
          const assignedRes = await fetch(
            `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${prestataire_id}&status=eq.assigned&select=id`,
            { headers }
          );
          const assignedData = await assignedRes.json();
          const currentlyAssigned = Array.isArray(assignedData) ? assignedData.length : 0;
          const total = completedThisMonth + currentlyAssigned;
          if (total >= limit) {
            return res.status(403).json({
              error: `Limite atteinte — votre plan ${plan === "free" ? "Gratuit" : plan === "premium" ? "Premium" : "Elite"} autorise ${limit} mission${limit > 1 ? "s" : ""}/mois. Passez à un plan supérieur pour continuer.`,
              limit_reached: true,
              plan,
              limit,
            });
          }
        }
      } catch { /* si erreur, on laisse postuler */ }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/candidatures`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ mission_id, prestataire_id, message: message || null, status: "pending" }),
      });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes("unique")) return res.status(400).json({ error: "Vous avez déjà postulé à cette mission" });
        return res.status(500).json({ error: "Erreur candidature" });
      }

      // Notifier le client qu'une candidature a été reçue
      const missionRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,metier,sector`, { headers });
      const missionData = await missionRes.json();
      const missionRow = Array.isArray(missionData) && missionData[0];
      const prestataireRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataire_id}&select=prenom,nom`, { headers });
      const prestataireData = await prestataireRes.json();
      const presta = Array.isArray(prestataireData) && prestataireData[0];
      if (missionRow?.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: missionRow.client_id,
            type: "mission",
            title: "Nouvelle candidature 📋",
            body: `${presta ? `${presta.prenom} ${presta.nom}` : "Un prestataire"} a postulé à votre mission "${missionRow.metier || missionRow.sector}".`,
            read: false,
          }),
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === "accept") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { candidature_id, mission_id, prestataire_id } = payload;
      if (!candidature_id || !mission_id) return res.status(400).json({ error: "candidature_id et mission_id requis" });

      // Récupérer le tarif_net du prestataire depuis user_metadata
      let tarifHoraire = 0;
      if (prestataire_id) {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
          const ud = await ur.json();
          tarifHoraire = Number(ud.user_metadata?.tarif_net) || 0;
        } catch {}
      }

      // Vérifier si la mission a déjà un paiement Stripe
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=stripe_payment_intent,hours`, { headers });
      const mCheckData = await mCheckRes.json();
      const missionCheck = Array.isArray(mCheckData) && mCheckData[0];

      if (missionCheck && !missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        try {
          const hours = missionCheck.hours || 1;
          const amountCents = Math.max(50, Math.round(tarifHoraire * hours * 100));
          const params = new URLSearchParams({
            amount: String(amountCents),
            currency: "eur",
            "metadata[mission]": mission_id,
            "metadata[candidature_id]": candidature_id,
            "metadata[prestataire_id]": prestataire_id || "",
          });
          const ir = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
          const intent = await ir.json();
          if (intent.client_secret) {
            return res.status(200).json({ payment_required: true, client_secret: intent.client_secret, amount: amountCents / 100 });
          }
        } catch {}
      }

      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "accepted" }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&id=neq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });
      const missionPatch = { status: "assigned" };
      if (prestataire_id) missionPatch.prestataire_id = prestataire_id;
      if (tarifHoraire)   missionPatch.tarif_horaire  = tarifHoraire;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(missionPatch),
      });

      // Notification au prestataire
      if (prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: prestataire_id,
            type: "mission",
            title: "Candidature acceptée ✅",
            body: "Votre candidature a été acceptée ! Préparez-vous pour la mission.",
            read: false,
          }),
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === "complete") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      const client_id = caller.id;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });

      // Récupérer la mission pour avoir hours, tarif_horaire et prestataire_id
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status,prestataire_id,metier,sector,client_id`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== client_id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });

      const hours        = mission.hours || 0;
      const tarifHoraire = mission.tarif_horaire || 0;
      const montantTotal = Math.round(hours * tarifHoraire * 100) / 100;

      // Récupérer le palier cashback du client (missions_completed_month)
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profiles = await pr.json();
      const profile = Array.isArray(profiles) && profiles[0];
      const missionsThisMonth = (profile?.missions_completed_month || 0) + 1;

      // Calcul du taux selon palier
      let rate = 0.005;
      if (missionsThisMonth >= 10) rate = 0.015;
      else if (missionsThisMonth >= 6) rate = 0.01;
      else if (missionsThisMonth >= 3) rate = 0.0075;
      const cashbackEarned = Math.round(montantTotal * rate * 100) / 100;
      const newBalance = Math.round(((profile?.cashback_balance || 0) + cashbackEarned) * 100) / 100;

      // Marquer mission completed + montant total
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "completed", montant_total: montantTotal }),
      });

      // Mettre à jour le cashback du client
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ cashback_balance: newBalance, missions_completed_month: missionsThisMonth }),
      });

      // Notification cashback au client
      if (cashbackEarned > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: client_id,
            type: "cashback",
            title: "Cashback crédité 💰",
            body: `+${cashbackEarned.toFixed(2)} € crédités sur votre wallet suite à la validation de votre mission. Solde : ${newBalance.toFixed(2)} €`,
            read: false,
          }),
        });
      }

      // Notification + email au prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission validée ✅",
            body: `Votre mission "${mission.metier || mission.sector || ""}" a été validée. Votre paiement de ${montantTotal.toFixed(2)} € est en cours de traitement.`,
            read: false,
          }),
        }).catch(() => {});

        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
        if (RESEND_API_KEY) {
          try {
            const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
            const uData = await uRes.json();
            const prestaEmail = uData.email;
            const prestaName  = uData.user_metadata?.prenom || "Prestataire";
            if (prestaEmail) {
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: RESEND_FROM,
                  to: prestaEmail,
                  subject: "Mission validée — votre paiement est en cours 💰",
                  html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                    <h2 style="color:#A29BFE;margin:0 0 12px">Mission validée ✅</h2>
                    <p>Bonjour ${prestaName},</p>
                    <p>Le client a validé votre mission <strong>${mission.metier || mission.sector || ""}</strong>.</p>
                    <p>Votre paiement de <strong style="color:#A29BFE">${montantTotal.toFixed(2)} €</strong> est en cours de traitement et sera versé sur votre IBAN sous 3 à 5 jours ouvrés.</p>
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE</p>
                  </div>`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }

      return res.status(200).json({ success: true, montantTotal, cashbackEarned, newBalance });
    }

    if (action === "reject") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { candidature_id } = payload;
      if (!candidature_id) return res.status(400).json({ error: "candidature_id requis" });
      if (!isUuid(candidature_id)) return res.status(400).json({ error: "candidature_id invalide" });

      // Verify the caller owns the mission associated with this candidature
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}&select=mission_id`, { headers });
      const cData = await cRes.json();
      const cand = Array.isArray(cData) && cData[0];
      if (!cand) return res.status(404).json({ error: "Candidature introuvable" });
      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${cand.mission_id}&select=client_id`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission || mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "cancel_prestataire") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,prestataire_id,client_id,sector,metier,date,hours,ville`,
        { headers }
      );
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });

      // Remettre la mission en open et effacer le prestataire
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "open", prestataire_id: null }),
      });

      // Rejeter la candidature du prestataire désisté
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=eq.${caller.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });

      // Notifier le client
      if (mission.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.client_id,
            type: "mission",
            title: "Prestataire désisté — mission réouverte 🔄",
            body: `Votre mission "${mission.metier || mission.sector}" du ${mission.date} a été réouverte automatiquement. De nouveaux prestataires vont être notifiés.`,
            read: false,
          }),
        });
      }

      // Rediffuser aux prestataires approuvés du même secteur (sauf le désisté)
      const prRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const prData = await prRes.json();
      if (Array.isArray(prData)) {
        const chunks = [];
        for (let i = 0; i < prData.length; i += 5) chunks.push(prData.slice(i, i + 5));
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (p) => {
            if (p.id === caller.id) return;
            try {
              const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers });
              const ud = await ur.json();
              const meta = ud.user_metadata || {};
              const prestaSector = meta.secteur || meta.sector;
              if (mission.sector && prestaSector && prestaSector !== mission.sector) return;
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: p.id,
                  type: "mission",
                  title: "🔔 Mission disponible — urgent !",
                  body: `Mission ${mission.metier || mission.sector || ""} le ${mission.date || ""} à ${mission.ville || ""} (${mission.hours || ""}h). Postulez maintenant !`,
                  read: false,
                }),
              });
            } catch {}
          }));
        }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "close") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission || mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "broadcast") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, sector } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });

      // Fetch mission details
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=sector,metier,date,hours,ville`,
        { headers }
      );
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];

      // Fetch all approved prestataires
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profiles = await pr.json();

      let notified = 0;
      if (Array.isArray(profiles)) {
        // Send notifications in parallel batches of 5
        const chunks = [];
        for (let i = 0; i < profiles.length; i += 5) chunks.push(profiles.slice(i, i + 5));
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (p) => {
            try {
              // Filter by sector using user_metadata
              const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers });
              const ud = await ur.json();
              const meta = ud.user_metadata || {};
              const presta_sector = meta.secteur || meta.sector;
              if (sector && presta_sector && presta_sector !== sector) return;
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: p.id,
                  type: "mission",
                  title: "🔔 Nouvelle mission disponible",
                  body: `Mission ${mission?.metier || sector || ""} le ${mission?.date || ""} à ${mission?.ville || ""} (${mission?.hours || ""}h). Postulez dans votre espace !`,
                  read: false,
                }),
              });
              notified++;
            } catch {}
          }));
        }
      }
      return res.status(200).json({ success: true, notified });
    }

    if (action === "update_position") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, lat, lng } = payload;
      if (!mission_id || lat == null || lng == null) return res.status(400).json({ error: "mission_id, lat, lng requis" });
      const prestataire_id = caller.id;
      // Upsert position (use mission_id as unique key per prestataire)
      await fetch(`${SUPABASE_URL}/rest/v1/tracking_positions?on_conflict=mission_id,prestataire_id`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ mission_id, prestataire_id, lat, lng, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "get_position") {
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tracking_positions?mission_id=eq.${mission_id}&select=lat,lng,updated_at&order=updated_at.desc&limit=1`,
        { headers }
      );
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) && rows[0] ? rows[0] : null);
    }

    if (action === "get_sector_status") {
      // Threshold configurable depuis le BO
      let minPrestataires = 20;
      try {
        const sr = await fetch(
          `${SUPABASE_URL}/rest/v1/platform_settings?key=eq.sector_min_prestataires&select=value`,
          { headers }
        );
        const sd = await sr.json();
        if (Array.isArray(sd) && sd[0]?.value != null) minPrestataires = Number(sd[0].value) || 20;
      } catch {}

      // IDs des prestataires approuvés
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profileData = await pr.json();
      const approvedIds = new Set((Array.isArray(profileData) ? profileData : []).map(p => p.id));

      // Récupérer tous les users (metadata contient le secteur) — pagination pour > 1000 users
      let allUsers = [];
      let page = 1;
      while (true) {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers });
        const ud = await ur.json();
        const batch = ud.users || [];
        allUsers = allUsers.concat(batch);
        if (batch.length < 1000) break;
        page++;
      }

      // Compter par secteur
      const counts = {};
      for (const u of allUsers) {
        if (!approvedIds.has(u.id)) continue;
        const sector = u.user_metadata?.secteur || u.user_metadata?.sector;
        if (sector) counts[sector] = (counts[sector] || 0) + 1;
      }

      const KNOWN_SECTORS = ["proprete","logistique","hotellerie","restauration","commercial","distribution","divers"];
      const result = {};
      for (const s of KNOWN_SECTORS) {
        const count = counts[s] || 0;
        result[s] = { count, open: count >= minPrestataires, min: minPrestataires };
      }
      return res.status(200).json(result);
    }

    if (action === "cancel_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, reason, penalty } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status,stripe_payment_intent,montant_total,metier,sector`,
        { headers }
      );
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "assigned", "pending_acceptance"].includes(mission.status)) {
        return res.status(400).json({ error: "Cette mission ne peut plus être annulée" });
      }

      // Update mission to cancelled
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "cancelled", cancellation_reason: reason || null, cancellation_penalty: penalty || 0 }),
      });

      // Stripe partial refund if payment exists and penalty < 100
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      if (mission.stripe_payment_intent && STRIPE_SECRET_KEY && penalty != null && penalty < 100) {
        try {
          const refundPct = (100 - penalty) / 100;
          const amountToRefund = Math.round((mission.montant_total || 0) * refundPct * 100);
          if (amountToRefund > 0) {
            await fetch("https://api.stripe.com/v1/refunds", {
              method: "POST",
              headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ payment_intent: mission.stripe_payment_intent, amount: String(amountToRefund) }).toString(),
            }).catch(() => {});
          }
        } catch {}
      }

      // Notify the prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission annulée ❌",
            body: `La mission "${mission.metier || mission.sector || ""}" a été annulée par le client.${penalty > 0 ? "" : " Vous serez remboursé intégralement."}`,
            read: false,
          }),
        }).catch(() => {});
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("missions error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
