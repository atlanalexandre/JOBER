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
  const stripeHeaders = {
    "Authorization": `Bearer ${STRIPE_SK}`,
    "Content-Type":  "application/x-www-form-urlencoded",
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

  let compteId = profil.stripe_account_id || null;

  // ── Créer le compte s'il n'existe pas ────────────────────────────────
  //
  // Cas réels : un dossier validé avant la mise en place de Connect, ou une
  // création qui a échoué au moment de la validation — l'échec y est journalisé
  // mais n'interrompt pas la validation, ce qui est le bon choix : mieux vaut un
  // prestataire validé sans compte de virement qu'un dossier bloqué.
  if (!compteId) {
    const params = new URLSearchParams({
      type: "express",
      country: "FR",
      email: caller.email || "",
      "capabilities[transfers][requested]": "true",
      business_type: "individual",
      "individual[first_name]": profil.prenom || caller.user_metadata?.prenom || "",
      "individual[last_name]":  profil.nom    || caller.user_metadata?.nom    || "",
    });
    const acctRes = await fetch("https://api.stripe.com/v1/accounts", {
      method: "POST", headers: stripeHeaders, body: params.toString(),
    });
    const acct = await acctRes.json().catch(() => ({}));
    if (!acctRes.ok || !acct.id) {
      console.error(`[connect] création de compte refusée pour ${caller.id} :`,
        JSON.stringify(acct).slice(0, 300));
      return res.status(502).json({ error: `Stripe a refusé la création du compte : ${acct?.error?.message || "erreur inconnue"}` });
    }
    compteId = acct.id;

    // Le résultat de l'écriture est vérifié : un compte créé chez Stripe mais
    // non enregistré ici serait recréé au prochain appel, et le prestataire
    // accumulerait des comptes orphelins sans jamais en avoir un actif.
    const up = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ stripe_account_id: compteId, stripe_account_status: "pending" }),
    });
    const majRows = await up.json().catch(() => []);
    if (!up.ok || !Array.isArray(majRows) || majRows.length === 0) {
      console.error(`[connect] compte ${compteId} créé chez Stripe mais NON ENREGISTRÉ pour ${caller.id} `
        + `(${up.status}) — à rattacher à la main pour éviter les comptes orphelins.`);
      return res.status(500).json({ error: "Votre compte de virement a été créé mais n'a pas pu être enregistré. Écrivez à direction@alane.fr." });
    }
    console.log(`[connect] compte ${compteId} créé pour le prestataire ${caller.id}`);
  }

  // ── Un lien frais, à chaque demande ──────────────────────────────────
  //
  // Les `account_links` de Stripe expirent en 24 h et ne servent qu'une fois.
  // On en régénère un à chaque appel plutôt que d'en conserver un : un lien
  // stocké serait périmé le jour où l'on en a besoin.
  const linkRes = await fetch("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: stripeHeaders,
    body: new URLSearchParams({
      account: compteId,
      refresh_url: `${APP_URL}/provider/dashboard`,
      return_url:  `${APP_URL}/provider/dashboard`,
      type: "account_onboarding",
    }).toString(),
  });
  const link = await linkRes.json().catch(() => ({}));
  if (!linkRes.ok || !link.url) {
    console.error(`[connect] lien de configuration refusé pour ${compteId} :`,
      JSON.stringify(link).slice(0, 300));
    return res.status(502).json({ error: `Stripe a refusé le lien de configuration : ${link?.error?.message || "erreur inconnue"}` });
  }

  return res.status(200).json({ url: link.url, compte: compteId });
}
