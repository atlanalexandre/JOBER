// ═══════════════════════════════════════════════════════════════════════════
// L'adresse publique de l'application — source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// CE QUI EST ARRIVÉ LE 26/08/2026
//
// Un prestataire touche « Configurer mes virements » et lit :
//
//     Stripe a refusé le lien de configuration :
//     Redirect urls must begin with HTTP or HTTPS.
//
// La variable `APP_URL` de Vercel contenait l'adresse SANS SCHÉMA — quelque
// chose comme `www.alane.fr` au lieu de `https://www.alane.fr`. Or les dix-huit
// endroits qui la lisaient portaient tous la même précaution :
//
//     (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr"
//
// Cette garde ne joue que si la variable est VIDE. Renseignée mais mal formée,
// elle passe telle quelle — et le repli n'a jamais l'occasion de servir.
//
// CE QUE ÇA CASSAIT AILLEURS, EN SILENCE
//
// Stripe, au moins, refuse et le dit. Les e-mails, eux, ne disent rien : un
// `href="www.alane.fr/…"` sans schéma est interprété comme un chemin RELATIF
// par les clients de messagerie. Étaient donc concernés le lien « Accéder à
// ALANE » de l'e-mail de bienvenue, celui de réinitialisation de mot de passe,
// le rappel de panier abandonné, et surtout LES BOUTONS ACCEPTER ET REFUSER
// envoyés au prestataire à chaque proposition de prestation.
//
// CE QUE FAIT CETTE FONCTION
//
// Elle nettoie, ajoute le schéma s'il manque, retire la barre finale — et
// journalise quand elle doit corriger, parce qu'une variable mal renseignée
// doit être réparée à la source, pas rattrapée indéfiniment par le code.
// ═══════════════════════════════════════════════════════════════════════════

const REPLI = "https://www.alane.fr";

export function appUrl() {
  // Les guillemets sont retirés : les coller depuis un tableau de bord les
  // embarque parfois, et `"https://www.alane.fr"` n'est pas une adresse.
  const brut = (process.env.APP_URL || "").replace(/\s/g, "").replace(/^["']+|["']+$/g, "");

  if (!brut) return REPLI;

  const complet = /^https?:\/\//i.test(brut) ? brut : `https://${brut}`;
  if (complet !== brut) {
    console.error(`[url] APP_URL vaut « ${brut} », sans schéma — corrigée en « ${complet} » `
      + "pour ce traitement. À réparer dans les variables Vercel : Stripe refuse une "
      + "adresse sans http(s), et les liens des e-mails deviennent relatifs.");
  }
  return complet.replace(/\/+$/, "");
}
