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
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });
  const userId = caller.id;

  try {
    // 1. Anonymiser le profil (conserver la ligne pour l'intégrité référentielle des missions)
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        prenom: "Anonymisé",
        nom: "Anonymisé",
        cashback_balance: 0,
        missions_completed_month: 0,
      }),
    });

    // 2. Anonymiser les missions (garder l'historique pour les clients)
    await fetch(`${SUPABASE_URL}/rest/v1/missions?client_id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ description: null, adresse: null, ville: null }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ description: null, adresse: null, ville: null }),
    });

    // 3. Supprimer les données personnelles directes
    await fetch(`${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${userId}`, {
      method: "DELETE", headers,
    });
    await fetch(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}`, {
      method: "DELETE", headers,
    });
    await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ user_email: null, user_name: null, user_id: null }),
    });

    // 4. Supprimer les documents de stockage
    const docsRes = await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}&select=storage_path`, { headers });
    const docs = await docsRes.json();
    if (Array.isArray(docs) && docs.length > 0) {
      const paths = docs.map(d => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ prefixes: paths }),
        }).catch(() => {});
      }
      await fetch(`${SUPABASE_URL}/rest/v1/documents?prestataire_id=eq.${userId}`, {
        method: "DELETE", headers,
      });
    }

    // 5. Supprimer le compte auth (supprime aussi user_metadata)
    const deleteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE", headers,
    });
    if (!deleteRes.ok && deleteRes.status !== 404) {
      const err = await deleteRes.text();
      throw new Error(`Erreur suppression auth: ${err}`);
    }

    return res.status(200).json({ success: true, message: "Compte et données personnelles supprimés conformément au RGPD art. 17." });
  } catch (e) {
    console.error("GDPR delete error:", e.message);
    return res.status(500).json({ error: "Erreur lors de la suppression. Contactez le support." });
  }
}
