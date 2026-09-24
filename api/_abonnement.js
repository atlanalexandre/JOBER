// ═══════════════════════════════════════════════════════════════════════════
// Échéance d'un abonnement prestataire
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Le plan se lit dans `profiles.plan_abonnement` ; `user_metadata` n'en est
// qu'une copie. La DATE DE FIN, elle, était lue dans la copie :
//
//   - la remise à zéro mensuelle rétrogradait `user_metadata` et laissait
//     `profiles` en Premium, puis EFFAÇAIT la date de fin — seule trace de
//     l'expiration. L'abonné gardait son quota Premium sans payer (constaté
//     le 24/09/2026 par le scénario de recette e2e/11) ;
//   - la prolongation offerte par le parrainage n'est écrite que dans
//     `profiles` : lue dans la copie, la date restait l'ancienne, et le
//     contrôle du quota rétrogradait un parrain qu'on venait de prolonger.
//
// La date de fin se lit donc dans `profiles.subscription_end_date`, comme le
// plan. Le webhook Stripe y écrit la fin de la période payée à chaque
// renouvellement.
// ═══════════════════════════════════════════════════════════════════════════

import { dateDuJourFr } from "./_temps.js";

/**
 * L'abonnement payant de ce profil est-il échu ?
 *
 * La date de fin est un JOUR (fin de la période payée). L'abonnement vaut
 * jusqu'à la fin de ce jour, heure de Paris : il est échu à partir du
 * lendemain. Sans date de fin (plan accordé sans échéance), il n'expire pas.
 *
 * @param {{plan_abonnement?:string, subscription_end_date?:string|null}} profil
 * @param {number} nowMs
 */
export function abonnementEchu(profil, nowMs = Date.now()) {
  const plan = profil?.plan_abonnement || "free";
  if (plan === "free") return false;
  const fin = String(profil?.subscription_end_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fin)) return false;
  return fin < dateDuJourFr(nowMs);
}

/**
 * Rétrograde un compte en gratuit, dans `profiles` (qui fait foi) ET dans la
 * copie `user_metadata`. Renvoie true si `profiles` a bien été écrit.
 */
export async function retrograderEnGratuit(userId, supabaseUrl, headers, contexte) {
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ plan_abonnement: "free", subscription_end_date: null }),
  }).catch(e => { console.error(`[${contexte}] rétrogradation de ${userId} impossible :`, e.message); return null; });
  if (!r || !r.ok) {
    console.error(`[${contexte}] rétrogradation de ${userId} refusée (${r?.status}) — le plan payant reste actif.`);
    return false;
  }
  // La copie : utile à l'affichage, jamais à la décision. Son échec se journalise.
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT", headers,
    body: JSON.stringify({ user_metadata: { plan_abonnement: "free", subscription_end_date: null } }),
  }).catch(e => console.error(`[${contexte}] copie user_metadata de ${userId} non mise à jour :`, e.message));
  return true;
}
