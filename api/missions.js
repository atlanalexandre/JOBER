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
      const { client_id } = payload;
      if (!client_id) return res.status(400).json({ error: "client_id requis" });
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
      return res.status(200).json({ success: true });
    }

    if (action === "accept") {
      const { candidature_id, mission_id } = payload;
      if (!candidature_id || !mission_id) return res.status(400).json({ error: "candidature_id et mission_id requis" });
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
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "assigned" }),
      });
      return res.status(200).json({ success: true });
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
