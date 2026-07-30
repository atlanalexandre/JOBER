export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const refreshToken = (req.headers["x-refresh-token"] || "").trim();
  if (!token && !refreshToken) return res.status(401).json({ error: "Token requis" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration manquante" });

  const svcHeaders = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Décoder le JWT localement — pas d'appel réseau sur le chemin normal
  let userId;
  if (token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
      if (payload?.sub && payload?.exp * 1000 > Date.now() + 10000) {
        userId = payload.sub;
      }
    } catch { /* continue */ }
  }

  // Si token expiré/invalide → rafraîchir via Supabase
  if (!userId && refreshToken) {
    try {
      const rr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (rr.ok) {
        const rd = await rr.json();
        userId = rd.user?.id;
        if (rd.access_token) {
          res.setHeader("x-new-access-token", rd.access_token);
          res.setHeader("x-new-refresh-token", rd.refresh_token);
        }
      }
    } catch { /* continue */ }
  }

  if (!userId) return res.status(401).json({ error: "Session expirée — reconnectez-vous." });

  const { profileData } = req.body || {};
  if (!profileData || typeof profileData !== "object") {
    return res.status(400).json({ error: "profileData requis" });
  }

  // Récupérer le metadata actuel pour merge côté serveur
  // (le frontend n'envoie pas la photo_url sauf si elle a changé — évite les gros corps de requête)
  let currentMeta = {};
  try {
    const cur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svcHeaders });
    if (cur.ok) currentMeta = (await cur.json())?.user_metadata || {};
  } catch { /* continuer avec currentMeta vide */ }

  // Champs que le navigateur ne peut jamais écrire lui-même : ils décident de
  // l'argent, des droits ou de l'état du compte. Cette fonction fusionnait sans
  // filtre tout ce qu'on lui envoyait.
  const CHAMPS_INTERDITS = [
    "plan_abonnement", "subscription_end_date", "plan_souhaite",
    "role", "status", "missions_enabled", "trial_exhausted",
    "missions_completed_month", "cashback_balance", "prepaid_balance",
    "stripe_customer_id", "stripe_subscription_id", "stripe_account_id", "stripe_account_status",
  ];
  const refuses = CHAMPS_INTERDITS.filter(k => k in profileData);
  if (refuses.length) {
    console.error(`[update-profile] champs privilégiés refusés pour ${userId} : ${refuses.join(", ")}`);
    return res.status(403).json({ error: "Certains champs ne peuvent pas être modifiés depuis l'application." });
  }

  // Aucune valeur volumineuse : user_metadata est encodé dans le jeton, envoyé en
  // en-tête HTTP à chaque requête, et Cloudflare plafonne les en-têtes à 16 Ko.
  // Une photo en base64 y avait été stockée — 60 Ko — et TOUTES les requêtes du
  // compte étaient rejetées en 520, déconnexion comprise : le compte devenait
  // inutilisable (règle 1.1). Rien ne l'empêchait ici, dans la fonction qui écrit
  // précisément ce champ.
  for (const [k, v] of Object.entries(profileData)) {
    if (typeof v === "string" && /^data:/i.test(v)) {
      console.error(`[update-profile] data URI refusée sur « ${k} » pour ${userId} (${v.length} caractères)`);
      return res.status(413).json({ error: "Les fichiers ne peuvent pas être enregistrés dans le profil. Utilisez l'envoi de document." });
    }
  }

  // Merge : données existantes + nouvelles (les nouvelles ont priorité)
  const merged = { ...currentMeta, ...profileData };

  // Plafond global, très en deçà des 16 Ko : le jeton contient aussi ses propres
  // en-têtes et signatures, et d'autres en-têtes voyagent avec lui.
  const tailleMeta = Buffer.byteLength(JSON.stringify(merged), "utf8");
  if (tailleMeta > 6144) {
    console.error(`[update-profile] user_metadata trop volumineux pour ${userId} : ${tailleMeta} octets`);
    return res.status(413).json({
      error: "Votre profil contient trop d'informations pour être enregistré. "
           + "Raccourcissez votre description ou vos compétences.",
    });
  }

  // Mise à jour via Admin API
  try {
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: svcHeaders,
      body: JSON.stringify({ user_metadata: merged }),
    });
    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[update-profile] admin PUT error:", updateRes.status, err);
      return res.status(500).json({ error: "Erreur mise à jour profil (" + updateRes.status + ")" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[update-profile] exception:", e?.message);
    return res.status(500).json({ error: "Erreur serveur: " + (e?.message || "inconnue") });
  }
}
