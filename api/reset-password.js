import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: "Paramètres manquants" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caractères minimum)" });

  const RESET_SECRET     = ((process.env.BO_SESSION_SECRET || "").replace(/\s/g, "") || "alane-reset-fallback").replace(/\s/g, "");
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  // Parser le token : emailB64.timestamp.hmac
  const parts = resetToken.split(".");
  if (parts.length !== 3) return res.status(400).json({ error: "Token invalide" });

  const [emailB64, timestampStr, hmac] = parts;

  let email;
  try {
    email = Buffer.from(emailB64, "base64url").toString("utf8");
  } catch {
    return res.status(400).json({ error: "Token invalide" });
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return res.status(400).json({ error: "Token invalide" });

  // Vérifier expiry (1 heure)
  if (Date.now() - timestamp > 60 * 60 * 1000) {
    return res.status(400).json({ error: "Ce lien a expiré. Demandez un nouveau lien de réinitialisation." });
  }

  // Vérifier HMAC
  const expectedHmac = crypto.createHmac("sha256", RESET_SECRET)
    .update(`${email}:${timestamp}`)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expectedHmac, "hex"))) {
    return res.status(400).json({ error: "Token invalide ou falsifié" });
  }

  // Trouver l'utilisateur par email
  let userId;
  try {
    const userRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
      { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!userRes.ok) {
      const err = await userRes.text();
      console.error("[reset-password] user lookup failed:", userRes.status, err);
      return res.status(500).json({ error: "Erreur lors de la recherche du compte" });
    }
    const data = await userRes.json();
    const users = data?.users || [];
    if (users.length === 0) return res.status(404).json({ error: "Compte introuvable" });
    userId = users[0].id;
  } catch (e) {
    console.error("[reset-password] user lookup error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }

  // Mettre à jour le mot de passe via l'API admin
  try {
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("[reset-password] update failed:", updateRes.status, err);
      return res.status(500).json({ error: "Impossible de mettre à jour le mot de passe" });
    }
  } catch (e) {
    console.error("[reset-password] update error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }

  console.log("[reset-password] password updated for:", email);
  return res.status(200).json({ ok: true });
}
