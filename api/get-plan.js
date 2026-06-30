// Lit plan_abonnement depuis profiles avec service role key (bypasse RLS + JWT cache)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY    = process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  // Vérifier le JWT utilisateur
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": ANON_KEY, "Authorization": authHeader },
  });
  if (!userRes.ok) return res.status(401).json({ error: "JWT invalide" });
  const user = await userRes.json();
  if (!user?.id) return res.status(401).json({ error: "Utilisateur introuvable" });

  // Lire plan depuis profiles avec service role (bypasse RLS)
  const planRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=plan_abonnement,trial_exhausted`,
    { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } }
  );
  if (!planRes.ok) return res.status(500).json({ error: "Erreur lecture profiles" });

  const rows = await planRes.json();
  const plan = rows[0]?.plan_abonnement || "free";
  const trial_exhausted = !!rows[0]?.trial_exhausted;

  return res.status(200).json({ plan, trial_exhausted });
}
