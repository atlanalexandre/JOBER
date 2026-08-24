// ═══════════════════════════════════════════════════════════════════════════
// Configurer ses virements — le compte de paiement du prestataire
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Un virement ne peut partir que vers un compte Stripe Connect ACTIF. Ce compte
// existait déjà dans le code : il est créé à la validation du dossier par le
// back-office, et un lien de configuration part dans l'e-mail de bienvenue.
//
// Ce lien expire au bout de VINGT-QUATRE HEURES — c'est Stripe qui le décide,
// pas nous. Passé ce délai, le prestataire n'avait plus AUCUN moyen d'y
// revenir : pas de bouton dans l'application, pas de renvoi possible, et rien
// à l'écran pour lui dire que ses virements n'étaient pas configurés.
//
// Le résultat se lisait dans le back-office le 24/08/2026 : des versements
// « en retard » depuis cinq jours, un traitement automatique qui tournait
// parfaitement, et aucun compte de destination en face.
//
// D'où cette fonction : le prestataire redemande un lien quand il veut, autant
// de fois qu'il veut. Elle crée le compte s'il n'existe pas encore — un dossier
// validé avant la mise en place de Connect, ou une création qui avait échoué.
//
// CE QU'ELLE NE FAIT PAS
//
// Elle ne décide rien sur l'argent, ne lit aucune prestation et ne touche à
// aucun montant. Elle rend une URL Stripe, et c'est tout.
// ═══════════════════════════════════════════════════════════════════════════

import { verifyUser } from "./_auth.js";
import { assurerCompteConnect, lienConfiguration } from "./_connect.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const STRIPE_SK        = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  const APP_URL          = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }
  if (!STRIPE_SK) {
    console.error("[connect] STRIPE_SECRET_KEY absente — aucun compte de virement ne peut être créé.");
    return res.status(500).json({ error: "Les virements ne sont pas configurés côté plateforme. Écrivez à direction@alane.fr." });
  }

  // Chacun ne configure QUE son propre compte : l'identité vient du jeton, et
  // aucun identifiant n'est accepté depuis le corps de la requête.
  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  const pr = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=id,role,status,prenom,nom,stripe_account_id,stripe_account_status`,
    { headers }
  );
  if (!pr.ok) {
    const detail = await pr.text().catch(() => "");
    console.error(`[connect] profil illisible (${pr.status}) : ${detail.slice(0, 200)}`);
    return res.status(500).json({ error: "Votre profil n'a pas pu être lu. Réessayez." });
  }
  const rows = await pr.json().catch(() => []);
  const profil = Array.isArray(rows) && rows[0];
  if (!profil) return res.status(404).json({ error: "Profil introuvable" });
  if (profil.role !== "prestataire") {
    return res.status(403).json({ error: "Seuls les prestataires reçoivent des virements." });
  }

  // ── L'état est demandé, pas un lien ──────────────────────────────────
  if (req.body?.action === "statut") {
    return res.status(200).json({
      compte: profil.stripe_account_id ? profil.stripe_account_status || "pending" : null,
      versable: Boolean(profil.stripe_account_id) && profil.stripe_account_status === "enabled",
    });
  }

  const compte = await assurerCompteConnect({
    profil: { ...profil, prenom: profil.prenom || caller.user_metadata?.prenom, nom: profil.nom || caller.user_metadata?.nom },
    email: caller.email,
    supabaseUrl: SUPABASE_URL, headers, stripeKey: STRIPE_SK,
  });
  if (!compte.ok) return res.status(502).json({ error: compte.detail });

  const lien = await lienConfiguration({ compteId: compte.compteId, stripeKey: STRIPE_SK, appUrl: APP_URL });
  if (!lien.ok) return res.status(502).json({ error: lien.detail });

  return res.status(200).json({ url: lien.url, compte: compte.compteId });
}
