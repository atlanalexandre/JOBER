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
      const { mission_id, prestataire_id, message } = payload;
      if (!mission_id || !prestataire_id) return res.status(400).json({ error: "mission_id et prestataire_id requis" });
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

      // Récupérer la mission pour avoir hours et tarif_horaire
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
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

      return res.status(200).json({ success: true, montantTotal, cashbackEarned, newBalance });
    }

    if (action === "reject") {
      const { candidature_id } = payload;
      if (!candidature_id) return res.status(400).json({ error: "candidature_id requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "close") {
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("missions error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
