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
    // Fetch approved prestataires from profiles
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id,prenom,nom,created_at`,
      { headers }
    );
    const profiles = await profilesRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(200).json({ prestataires: [] });
    }

    // Enrich each profile with user_metadata from auth admin
    const enriched = await Promise.all(
      profiles.map(async (p) => {
        try {
          const userRes = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users/${p.id}`,
            { headers }
          );
          const userData = await userRes.json();
          const meta = userData.user_metadata || {};
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
            dispon_jours:     meta.dispon_jours     || null,
            dispo_immediat:   meta.dispo_immediat   || false,
            code_postal:      meta.code_postal      || null,
            plan_abonnement:  meta.plan_abonnement  || "free",
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
