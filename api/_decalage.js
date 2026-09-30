// ═══════════════════════════════════════════════════════════════════════════
// Démarrage décalé : les heures non faites reviennent au client
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Quand le prestataire commence en retard, la prestation finit à l'heure
// convenue : « X h seront facturées au lieu de Y h », annonce la notification.
// Le prestataire était bien payé X heures — mais le client, qui en avait réglé
// Y, n'était jamais remboursé de la différence. Mesuré sur la Preview le
// 30/09/2026 : 110,98 € payés pour 8 h, 7 h facturées, prestataire payé 91 €,
// 0 € rendu ; les 13 € de l'heure non faite restaient à ALANE, et la facture
// les présentait comme des frais de service (19,98 € au lieu de 6,98 €).
//
// Deux moments réduisent les heures, et tous deux passent par ici :
//   - le client refuse le décalage (`respond_delay`, api/missions.js) ;
//   - il n'a jamais répondu, et la clôture plafonne (validation par le client,
//     ou validation automatique du traitement planifié).
//
// La réduction porte sur la part de BASE, comme dans montantsDeCloture() :
// le retard concerne le début de la prestation, pas une prolongation acceptée.
// Les frais de service ne bougent pas : ils rémunèrent la mise en relation.
// ═══════════════════════════════════════════════════════════════════════════

import { partHoraire, nombreDeJours } from "./_cloture.js";
import { plafonnerRemboursement } from "./_cashback.js";

/**
 * Ce que valent les heures retirées, en euros.
 * @param {object} m          la prestation
 * @param {number} avant      heures prévues
 * @param {number} apres      heures retenues
 */
export function valeurHeuresRetirees(m, avant, apres) {
  const jours = nombreDeJours(m);
  const ecart = partHoraire(m, avant, jours) - partHoraire(m, apres, jours);
  return Math.max(0, Math.round(ecart * 100) / 100);
}

/**
 * Rend au client la valeur des heures retirées. À appeler APRÈS avoir
 * enregistré la réduction (écriture conditionnelle, qui ne réussit qu'une
 * fois) : une réduction non enregistrée ne doit rien rembourser.
 *
 * Ne lève jamais : la réduction est acquise, un échec de remboursement se
 * rattrape à la main — et il est journalisé pour cela.
 *
 * @returns {Promise<{ok:boolean, centimes:number, refundId?:string}>}
 */
export async function rembourserHeuresRetirees({ mission, euros, supabaseUrl, headers, contexte }) {
  const voulu = Math.round((Number(euros) || 0) * 100);
  if (!(voulu > 0)) return { ok: true, centimes: 0 };
  const intent = String(mission?.stripe_payment_intent || "");
  if (!intent.startsWith("pi_")) {
    console.error(`[${contexte}] ${(voulu / 100).toFixed(2)} € d'heures non faites à rendre sur ${mission?.id}, `
      + `mais aucun paiement par carte (${intent || "aucun"}) — à rembourser à la main.`);
    return { ok: false, centimes: voulu };
  }
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) {
    console.error(`[${contexte}] clé Stripe absente — ${(voulu / 100).toFixed(2)} € à rendre à la main sur ${mission.id}.`);
    return { ok: false, centimes: voulu };
  }
  const centimes = await plafonnerRemboursement(voulu, mission, supabaseUrl, headers);
  if (!(centimes > 0)) return { ok: true, centimes: 0 };
  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cle}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Une prestation ne connaît qu'une réduction pour décalage.
        "Idempotency-Key": `refund-decalage-${mission.id}`,
      },
      body: new URLSearchParams({
        payment_intent: intent, amount: String(centimes), reason: "requested_by_customer",
        "metadata[motif]": "heures_non_faites", "metadata[mission]": mission.id,
      }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.id) {
      console.log(`[${contexte}] ${(centimes / 100).toFixed(2)} € d'heures non faites rendus au client de ${mission.id} (${d.id})`);
      return { ok: true, centimes, refundId: d.id };
    }
    console.error(`[${contexte}] remboursement des heures non faites REFUSÉ sur ${mission.id} `
      + `(${(centimes / 100).toFixed(2)} €) : ${d?.error?.message || r.status} — à rembourser à la main.`);
    return { ok: false, centimes };
  } catch (e) {
    console.error(`[${contexte}] remboursement des heures non faites impossible sur ${mission.id} `
      + `(${(centimes / 100).toFixed(2)} €) :`, e.message, "— à rembourser à la main.");
    return { ok: false, centimes };
  }
}
