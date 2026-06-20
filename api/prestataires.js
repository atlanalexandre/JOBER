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

  try {
    // Fetch approved prestataires + verified doc IDs in parallel
    const [profilesRes, verifiedDocsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id,prenom,nom,created_at`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/documents?verified=eq.true&select=prestataire_id`, { headers }),
    ]);
    const profiles     = await profilesRes.json();
    const verifiedDocs = await verifiedDocsRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(200).json({ prestataires: [] });
    }

    // Only show prestataires with at least one verified document
    const verifiedIds = new Set(Array.isArray(verifiedDocs) ? verifiedDocs.map(d => d.prestataire_id) : []);
    const approvedProfiles = profiles.filter(p => verifiedIds.has(p.id));

    if (approvedProfiles.length === 0) {
      return res.status(200).json({ prestataires: [] });
    }

    // Fetch all ratings to compute averages
    const ratingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?select=reviewee_provider_id,rating`,
      { headers }
    );
    const allRatings = await ratingsRes.json();
    const ratingsByProvider = {};
    if (Array.isArray(allRatings)) {
      for (const r of allRatings) {
        if (!ratingsByProvider[r.reviewee_provider_id]) ratingsByProvider[r.reviewee_provider_id] = [];
        ratingsByProvider[r.reviewee_provider_id].push(r.rating);
      }
    }

    // Enrich each profile with user_metadata from auth admin
    const enriched = await Promise.all(
      approvedProfiles.map(async (p) => {
        try {
          const userRes = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users/${p.id}`,
            { headers }
          );
          const userData = await userRes.json();
          const meta = userData.user_metadata || {};
          const provRatings = ratingsByProvider[p.id] || [];
          const avgRating = provRatings.length
            ? Math.round(provRatings.reduce((a, b) => a + b, 0) / provRatings.length * 10) / 10
            : 0;
          return {
            id:            p.id,
            name:          `${p.prenom || ""} ${p.nom || ""}`.trim() || "Prestataire",
            prenom:        p.prenom || "",
            nom:           p.nom || "",
            secteur:          meta.secteur          || meta.sector    || null,
            metier:           meta.metier           || meta.job_title || null,
            niveau:           meta.niveau           || null,
            tarif_net:        Number(meta.tarif_net) || 12,
            langues:          meta.langues          || null,
            dispon_jours:          meta.dispon_jours          || null,
            dispon_jours_creneaux: meta.dispon_jours_creneaux || null,
            dispo_immediat:        meta.dispo_immediat        || false,
            code_postal:      meta.code_postal      || null,
            ville:            meta.ville            || null,
            plan_abonnement:  meta.plan_abonnement  || "free",
            rating:           avgRating,
            reviews:          provRatings.length,
            cv:               meta.cv || null,
            created_at:       p.created_at,
          };
        } catch {
          return {
            id:         p.id,
            name:       `${p.prenom || ""} ${p.nom || ""}`.trim() || "Prestataire",
            prenom:     p.prenom || "",
            nom:        p.nom || "",
            tarif_net:  12,
            created_at: p.created_at,
          };
        }
      })
    );

    return res.status(200).json({ prestataires: enriched });
  } catch (e) {
    console.error("prestataires error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
