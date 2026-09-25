// ═══════════════════════════════════════════════════════════════════════════
// Retour du lien de confirmation d'adresse e-mail
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Le 25/09/2026, un client a cliqué « Confirmer mon adresse » dans l'e-mail
// reçu sur son iPhone. L'adresse a bien été confirmée en base, mais il est
// arrivé sur l'accueil, déconnecté, sans un mot d'explication.
//
// La cause : le client Supabase est en flux PKCE (src/lib/supabase.js). Le lien
// ramène un `?code=` que seul le navigateur ayant servi à l'inscription peut
// échanger contre une session — il y a gardé une clé. Ouvert ailleurs (autre
// appareil, navigateur intégré de Gmail), l'échange échoue : l'adresse est
// confirmée, mais personne n'est connecté.
//
// Et même dans le bon navigateur, le lien s'ouvre dans un NOUVEL onglet : la
// marque de session (`alane_session_active`, en sessionStorage, propre à
// l'onglet) y est absente, et l'application fermait aussitôt la session en
// parlant de « Rester connecté ».
//
// Ce module ne fait que lire l'URL ; App.jsx en tire les conséquences une fois
// que Supabase a tranché sur la session.
// ═══════════════════════════════════════════════════════════════════════════

// Le marqueur ajouté à l'adresse de retour de l'inscription (emailRedirectTo).
// Supabase y ajoute lui-même `code=` ou les paramètres d'erreur.
export const MARQUEUR_CONFIRMATION = "confirmation";

/** Adresse de retour à donner à `signUp` : l'accueil, marqué. */
export function adresseRetourConfirmation(origine) {
  return `${origine}/?${MARQUEUR_CONFIRMATION}=1`;
}

/**
 * @param {string} search  window.location.search
 * @param {string} hash    window.location.hash
 * @returns {null | { erreur: boolean, codeErreur: string|null }}
 *   null si l'URL n'est pas un retour de confirmation.
 */
export function lireRetourConfirmation(search, hash) {
  const sp = new URLSearchParams(search || "");
  if (sp.get(MARQUEUR_CONFIRMATION) !== "1") return null;
  // Supabase place l'erreur dans la query ou dans le fragment selon le flux.
  const hp = new URLSearchParams((hash || "").replace(/^#/, ""));
  const codeErreur = sp.get("error_code") || hp.get("error_code") || sp.get("error") || hp.get("error") || null;
  return { erreur: !!codeErreur, codeErreur };
}

/**
 * Le message à montrer quand le retour de confirmation n'a pas ouvert de session.
 * @param {{ erreur: boolean, codeErreur: string|null }} retour
 */
export function messageConfirmationSansSession(retour) {
  if (retour?.erreur) {
    return {
      titre: "Lien de confirmation expiré ou déjà utilisé",
      texte: "Si vous avez déjà confirmé votre adresse, connectez-vous avec votre e-mail et votre mot de passe. Sinon, écrivez à support@alane.fr."
        + ` (code ${retour.codeErreur || "LIEN_INVALIDE"})`,
      positif: false,
    };
  }
  return {
    titre: "Adresse e-mail confirmée",
    texte: "Choisissez votre profil, puis connectez-vous avec votre e-mail et votre mot de passe.",
    positif: true,
  };
}
