// ═══════════════════════════════════════════════════════════════════════════
// Erreurs Stripe : ce que voit l'utilisateur, ce que garde le journal
// ═══════════════════════════════════════════════════════════════════════════
//
// Les fonctions /api renvoyaient au navigateur le message brut de Stripe. Le
// 25/09/2026, un client a donc lu, sur l'écran de paiement :
//
//     « Invalid API Key provided: sk_test_*****…KGVj »
//
// En anglais, incompréhensible pour lui, et avec la fin de la clé SECRÈTE de la
// plateforme. Le message complet part désormais dans le journal Vercel, avec le
// contexte ; l'utilisateur reçoit une phrase en français qui lui dit quoi faire.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} erreur    l'objet `error` d'une réponse Stripe
 * @param {string} contexte  pour le journal, ex. "stripe-intent/paiement"
 * @returns {string}         le message à renvoyer au navigateur
 */
export function messageErreurStripe(erreur, contexte) {
  const type = erreur?.type || "inconnu";
  const code = erreur?.code || erreur?.decline_code || "";
  console.error(`[${contexte}] Stripe a refusé (${type}${code ? `/${code}` : ""}) :`, erreur?.message || erreur);

  // Clé absente, révoquée ou sans le bon droit : c'est une panne de la
  // plateforme, pas une erreur de l'utilisateur.
  //
  // Aucune de ces phrases n'affirme « rien n'a été prélevé » : cette fonction
  // sert aussi aux remboursements et aux abonnements, où ce serait faux.
  if (type === "authentication_error" || type === "permission_error" || code === "api_key_expired") {
    return "Le service de paiement est momentanément indisponible. Réessayez dans quelques minutes, ou écrivez à support@alane.fr.";
  }
  if (type === "card_error") {
    return "Votre carte a été refusée. Vérifiez ses informations ou essayez une autre carte.";
  }
  if (type === "rate_limit_error" || type === "api_error" || type === "api_connection_error") {
    return "Le service de paiement ne répond pas pour le moment. Réessayez dans quelques minutes.";
  }
  return "L'opération n'a pas pu aboutir auprès du service de paiement. Réessayez, ou écrivez à support@alane.fr.";
}
