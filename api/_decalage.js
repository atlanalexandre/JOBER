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
  // Le retard se mesure au démarrage, pointé une seule fois : il ne concerne
  // qu'UNE journée, même sur une prestation de plusieurs jours. Multiplié par le
  // nombre de jours, il rendait au client — et retirait au prestataire — le
  // retard du lundi sur chaque journée de la série (étude du 13/10/2026).
  const ecart = partHoraire(m, avant, 1) - partHoraire(m, apres, 1);
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
export async function rembourserHeuresRetirees({ mission, euros, supabaseUrl, headers, contexte, suffixeCle = "" }) {
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
        // Un second remboursement (retard aggravé après un refus) porte sa propre
        // clé : la même clé avec un autre montant, Stripe la refuse.
        "Idempotency-Key": `refund-decalage-${mission.id}${suffixeCle ? `-${suffixeCle}` : ""}`,
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

/**
 * Heures de retard à NE PAS compter comme faites le jour d'une interruption.
 *
 * L'interruption (`cancel_in_progress`) compte les heures faites depuis l'heure
 * de début PRÉVUE. Quand le prestataire a commencé en retard, ce retard passait
 * pour du travail fait (étude d'octobre 2026, `e2e/81`) :
 *   - décalage ACCEPTÉ : la fin est repoussée, les heures courent du démarrage
 *     réel — le client payait le retard comme une heure faite ;
 *   - décalage REFUSÉ sur une prestation d'un jour : la durée retenue
 *     (`actual_hours`) l'exclut déjà, et il a été rendu au refus — il était
 *     facturé une seconde fois.
 * Deux cas où il ne faut rien retrancher :
 *   - refusé sur PLUSIEURS jours : le retard est déjà dans `heures_perdues`,
 *     et `hours` (durée d'une journée) le contient ; le retrancher ici le
 *     compterait deux fois ;
 *   - jamais arbitré : la clôture plafonne et rend le retard elle-même
 *     (`montantsDeCloture`, puis `rembourserHeuresRetirees`).
 * Et seulement le jour du démarrage : le retard ne concerne qu'une journée.
 *
 * @param {object} m           la prestation (arrival_delay_minutes, delay_status, started_at)
 * @param {string} aujourdHui  date du jour, heure de Paris (AAAA-MM-JJ)
 * @param {boolean} plusieursJours
 * @param {(ms:number)=>string} jourParis  date de Paris d'un instant
 * @returns {number} heures à retrancher du temps écoulé
 */
export function retardADeduireDuJour(m, aujourdHui, plusieursJours, jourParis) {
  const retardH = (Number(m?.arrival_delay_minutes) || 0) / 60;
  if (!(retardH > 0) || !m?.started_at) return 0;
  const demarrage = Date.parse(m.started_at);
  if (!Number.isFinite(demarrage) || jourParis(demarrage) !== aujourdHui) return 0;
  if (m.delay_status === "approved") return retardH;
  if (m.delay_status === "rejected" && !plusieursJours) return retardH;
  return 0;
}

/**
 * Décalage déjà REFUSÉ, puis démarrage plus tardif encore que l'arrivée.
 *
 * Le démarrage rouvrait la question au client (`delay_status` repassait en
 * attente) avec le retard total. Accepté, il effaçait la réduction déjà rendue :
 * le prestataire était payé pour des minutes remboursées au client. Refusé de
 * nouveau, il retirait le retard total une seconde fois, avec la même clé
 * Stripe et un autre montant — remboursement refusé (étude du 14/10/2026).
 *
 * Le client a déjà dit non : la fin reste celle prévue. Seul l'écart entre le
 * nouveau retard et celui déjà arbitré est déduit, et rendu.
 *
 * @returns {null | {maj:object, aRendre:number, ecartMin:number}}
 */
export function retardAggraveApresRefus(m, retardDemarrageMin) {
  if (m?.delay_status !== "rejected") return null;
  const deja = Number(m.arrival_delay_minutes) || 0;
  const ecartMin = Math.round(Number(retardDemarrageMin) || 0) - deja;
  if (!(ecartMin > 0)) return null;
  const reserve = Number(m.hours) || 0;
  const ecartH = ecartMin / 60;
  const maj = { arrival_delay_minutes: deja + ecartMin };
  if (nombreDeJours(m) > 1) {
    maj.heures_perdues = Math.round((Number(m.heures_perdues || 0) + ecartH) * 10000) / 10000;
  } else {
    const avant = m.actual_hours != null ? Number(m.actual_hours) : reserve;
    maj.actual_hours = Math.max(0, Math.round((avant - ecartH) * 10000) / 10000);
  }
  const aRendre = valeurHeuresRetirees(m, reserve, Math.max(0, reserve - ecartH));
  return { maj, aRendre, ecartMin };
}
