export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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

  // Route légère : juste le count des prestataires approuvés
  if (req.query.action === "count") {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { method: "HEAD", headers: { ...headers, "Prefer": "count=exact" } }
      );
      const countHeader = r.headers.get("content-range");
      const count = countHeader ? parseInt(countHeader.split("/")[1], 10) : null;
      return res.status(200).json({ count: isNaN(count) ? null : count });
    } catch {
      return res.status(200).json({ count: null });
    }
  }

  try {
    // Fetch approved prestataires + verified doc IDs in parallel
    const [profilesRes, verifiedDocsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id,prenom,nom,created_at,trial_exhausted`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/documents?verified=eq.true&select=prestataire_id`, { headers }),
    ]);
    const profiles     = await profilesRes.json();
    const verifiedDocs = await verifiedDocsRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(200).json({ prestataires: [] });
    }

    // All BO-approved prestataires are shown — verified docs is a badge, not a gate
    // (KBIS/RIB collected at registration go to user_metadata, not the documents table)
    const approvedProfiles = profiles;
    const verifiedIds = new Set(Array.isArray(verifiedDocs) ? verifiedDocs.map(d => d.prestataire_id) : []);

    // Fetch all ratings + completed missions count in parallel
    const prestaIdList = approvedProfiles.map(p => p.id);
    const [ratingsRes, missionsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/ratings?select=reviewee_provider_id,rating`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=in.(${prestaIdList.join(",")})&status=eq.completed&select=prestataire_id`, { headers }),
    ]);
    const allRatings = await ratingsRes.json();
    const allCompletedMissions = await missionsRes.json().catch(() => []);
    const missionCountByProvider = {};
    if (Array.isArray(allCompletedMissions)) {
      for (const m of allCompletedMissions) {
        missionCountByProvider[m.prestataire_id] = (missionCountByProvider[m.prestataire_id] || 0) + 1;
      }
    }
    const ratingsByProvider = {};
    if (Array.isArray(allRatings)) {
      for (const r of allRatings) {
        if (!ratingsByProvider[r.reviewee_provider_id]) ratingsByProvider[r.reviewee_provider_id] = [];
        ratingsByProvider[r.reviewee_provider_id].push(r.rating);
      }
    }

    // Fetch all auth users in one request to avoid N+1 against Supabase Auth API
    let userMetaMap = {};
    try {
      const allUsersRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`,
        { headers }
      );
      const allUsersData = await allUsersRes.json();
      const allUsers = allUsersData.users || [];
      for (const u of allUsers) userMetaMap[u.id] = u.user_metadata || {};
    } catch {}

    // Enrich each profile with user_metadata
    const enriched = approvedProfiles.map((p) => {
      const meta = userMetaMap[p.id] || {};
      const provRatings = ratingsByProvider[p.id] || [];
      const avgRating = provRatings.length
        ? Math.round(provRatings.reduce((a, b) => a + b, 0) / provRatings.length * 10) / 10
        : 0;
      return {
        id:            p.id,
        name:          `${p.prenom || meta.prenom || ""} ${p.nom || meta.nom || ""}`.trim() || "Prestataire",
        prenom:        p.prenom || meta.prenom || "",
        nom:           p.nom    || meta.nom    || "",
        secteur:          meta.secteur          || meta.sector    || null,
        metier:           meta.metier           || meta.job_title || null,
        niveau:           meta.niveau           || null,
        tarif_net:        Number(meta.tarif_net) || 12,
        langues:          meta.langues          || [],
        bio:              meta.bio              || null,
        metiers_list:     meta.metiers_list     || [],
        dispon_jours:          meta.dispon_jours          || null,
        dispon_jours_creneaux: meta.dispon_jours_creneaux || null,
        dispo_immediat:        meta.dispo_immediat        || false,
        code_postal:      meta.code_postal      || null,
        ville:            meta.ville            || null,
        plan_abonnement:  (() => {
          let plan = meta.plan_abonnement || "free";
          const endDate = meta.subscription_end_date;
          if (endDate && plan !== "free" && new Date(endDate).getTime() < Date.now()) plan = "free";
          return plan;
        })(),
        trial_exhausted:  p.trial_exhausted     || false,
        rating:           avgRating,
        reviews:          provRatings.length,
        missions_count:   missionCountByProvider[p.id] || 0,
        cv:               meta.cv || null,
        photo_url:        meta.photo_public_auth ? (meta.photo_url || null) : null,
        created_at:       p.created_at,
      };
    });

    return res.status(200).json({ prestataires: enriched });
  } catch (e) {
    console.error("prestataires error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
