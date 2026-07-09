// Sauvegarde / suppression d'un brouillon de réservation abandonné
// Appelé depuis le frontend au début (save) et à la fin (clear) du tunnel de paiement

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
  if (req.method !== "POST") return res.status(405).end();

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).end();

  const user = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!user) return res.status(401).json({ error: "Non authentifié" });

  const hdrs = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  const { action, prestataire_name, metier, date, ville, montant, mission_id } = req.body || {};

  if (action === "save") {
    await fetch(`${SUPABASE_URL}/rest/v1/booking_drafts`, {
      method: "POST",
      headers: { ...hdrs, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        client_id:       user.id,
        prestataire_name: prestataire_name || null,
        metier:          metier || null,
        date:            date   || null,
        ville:           ville  || null,
        montant:         montant != null ? Number(montant) : null,
        mission_id:      mission_id || null,
        created_at:      new Date().toISOString(),
        notified_at:     null,
      }),
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (action === "clear") {
    await fetch(`${SUPABASE_URL}/rest/v1/booking_drafts?client_id=eq.${user.id}`, {
      method: "DELETE",
      headers: { ...hdrs, "Prefer": "return=minimal" },
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "action invalide" });
}
