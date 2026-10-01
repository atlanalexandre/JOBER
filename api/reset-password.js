import { utilisateurParEmail } from "./_auth.js";
import { secretReinitialisation, lireLien, verifierLien } from "./_reinitialisation.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: "Paramètres manquants" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caractères minimum)" });

  // Plus de secret public de repli : voir api/_reinitialisation.js.
  const RESET_SECRET     = secretReinitialisation();
  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESET_SECRET) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const lien = lireLien(resetToken);
  if (!lien) return res.status(400).json({ error: "Token invalide" });
  const email = lien.email;

  // Le compte est retrouvé par son adresse EXACTE (api/_auth.js). La recherche
  // `?email=` prenait le premier compte rendu — le plus récent, le paramètre
  // n'étant pas un filtre : le mot de passe changé était celui du dernier
  // inscrit, pas celui du demandeur (constaté en recette le 01/10/2026).
  let userId, etatCompte;
  try {
    const compte = await utilisateurParEmail(email, SUPABASE_URL, SERVICE_ROLE_KEY);
    if (!compte) return res.status(400).json({ error: "Lien invalide ou déjà utilisé. Demandez un nouveau lien." });
    userId = compte.id;
    etatCompte = compte.updated_at;
  } catch (e) {
    console.error("[reset-password] recherche du compte impossible :", e.message);
    return res.status(500).json({ error: "Erreur lors de la recherche du compte" });
  }

  // Signature vérifiée contre l'état ACTUEL du compte : un lien qui a déjà servi
  // (le mot de passe a changé depuis) ne vaut plus.
  const verdict = verifierLien(RESET_SECRET, resetToken, etatCompte);
  if (verdict === "expire") {
    return res.status(400).json({ error: "Ce lien a expiré. Demandez un nouveau lien de réinitialisation." });
  }
  if (verdict !== "ok") {
    return res.status(400).json({ error: "Lien invalide ou déjà utilisé. Demandez un nouveau lien." });
  }

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
