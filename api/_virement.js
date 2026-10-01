// ═══════════════════════════════════════════════════════════════════════════
// Virement au prestataire : réessayer sans jamais payer deux fois
// ═══════════════════════════════════════════════════════════════════════════
//
// Le virement partait avec une clé d'idempotence FIXE, `payout-{mission}`.
// Stripe conserve 24 h la réponse associée à une clé — erreur comprise — et la
// rejoue à toute nouvelle demande portant la même clé. Un virement refusé
// (solde insuffisant, compte du prestataire à corriger) était donc « réessayé »
// pendant une journée sans que Stripe le tente réellement, et le bouton
// « Relancer » du back-office semblait ne rien faire (relecture du 01/10/2026).
//
// Changer de clé à chaque essai ouvrirait l'autre risque : une réponse perdue
// alors que le virement est parti, et un second virement. D'où l'ordre :
//   1. demander à Stripe si un virement existe déjà pour cette prestation
//      (`metadata[mission_id]`, posé sur tous les virements depuis l'origine) ;
//   2. seulement s'il n'en existe aucun, émettre — avec une clé qui change
//      d'une heure à l'autre. Deux essais rapprochés (double passage) gardent
//      la même clé ; l'essai suivant en prend une neuve.
// ═══════════════════════════════════════════════════════════════════════════

/** Clé d'idempotence d'un essai de virement : stable une heure, neuve ensuite. */
export function cleVersement(missionId, nowMs = Date.now()) {
  return `payout-${missionId}-${Math.floor(nowMs / 3600000)}`;
}

/**
 * Un virement non repris existe-t-il déjà pour cette prestation ?
 *
 * @returns {Promise<{ok:true, id:string|null} | {ok:false, detail:string}>}
 *          `ok:false` : on ne SAIT pas — l'appelant ne doit pas émettre.
 */
export async function virementDejaEmis({ destination, missionId, stripeKey, pagesMax = 10 }) {
  let apres = null;
  for (let page = 0; page < pagesMax; page++) {
    const q = new URLSearchParams({ destination, limit: "100", ...(apres ? { starting_after: apres } : {}) });
    let r, d;
    try {
      r = await fetch(`https://api.stripe.com/v1/transfers?${q}`, { headers: { "Authorization": `Bearer ${stripeKey}` } });
      d = await r.json().catch(() => null);
    } catch (e) {
      return { ok: false, detail: e.message };
    }
    if (!r.ok || !Array.isArray(d?.data)) return { ok: false, detail: `lecture des virements refusée (${r.status})` };
    const trouve = d.data.find(t => t?.metadata?.mission_id === missionId && !t.reversed);
    if (trouve) return { ok: true, id: trouve.id };
    if (!d.has_more || d.data.length === 0) return { ok: true, id: null };
    apres = d.data[d.data.length - 1].id;
  }
  // Trop de virements pour tout parcourir : on ne sait pas, on n'émet pas.
  return { ok: false, detail: `plus de ${pagesMax * 100} virements vers ${destination} — vérification incomplète` };
}
