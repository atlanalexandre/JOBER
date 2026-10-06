// ═══════════════════════════════════════════════════════════════════════════
// Rembourser depuis le back-office
// ═══════════════════════════════════════════════════════════════════════════
//
// « Rembourser » et « Annuler avec remboursement » (api/bo-action.js)
// appelaient Stripe sans rien regarder autour. Relecture du 30/09/2026 :
//
//   - un prestataire DÉJÀ PAYÉ ne l'était pas moins : le client était
//     remboursé et le virement restait acquis — ALANE payait deux fois ;
//   - un virement EN COURS d'émission pouvait partir juste après ;
//   - sans clé d'idempotence, un double clic tentait deux remboursements, et
//     le second affichait l'erreur brute de Stripe, en anglais.
//
// L'ordre compte : le virement est repris AVANT le remboursement. Si la
// reprise échoue, rien n'est remboursé — l'administrateur le sait, et l'argent
// n'est pas parti deux fois.
// ═══════════════════════════════════════════════════════════════════════════

import { messageErreurStripe } from "./_stripe_erreur.js";

/**
 * @param {object} m  la prestation : id, stripe_payment_intent, payout_status, stripe_transfer_id
 * @returns {Promise<{ok:true, refundId:string|null, virementRepris:boolean}
 *                  | {ok:false, code:number, message:string}>}
 */
export async function rembourserDepuisLeBO(m, contexte) {
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) return { ok: false, code: 500, message: "Stripe n'est pas configuré : rien n'a été remboursé." };
  const h = { "Authorization": `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded" };

  if (m.payout_status === "processing") {
    return { ok: false, code: 409, message: "Un virement au prestataire est en cours d'émission sur cette prestation. "
      + "Réessayez dans quelques minutes : il faut d'abord savoir s'il est parti." };
  }

  let virementRepris = false;
  if (m.payout_status === "transferred") {
    if (!m.stripe_transfer_id) {
      return { ok: false, code: 409, message: "Le prestataire a déjà été payé, mais le virement n'est pas identifié : "
        + "rien n'a été remboursé. Reprenez le virement dans Stripe, puis remboursez." };
    }
    try {
      const r = await fetch(`https://api.stripe.com/v1/transfers/${encodeURIComponent(m.stripe_transfer_id)}/reversals`, {
        method: "POST", headers: { ...h, "Idempotency-Key": `bo-reprise-${m.id}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        messageErreurStripe(d.error, `${contexte}/reprise`);
        return { ok: false, code: 502, message: "Le prestataire a déjà été payé et son virement n'a pas pu être repris : "
          + "rien n'a été remboursé au client, pour ne pas payer deux fois. Voir le tableau de bord Stripe." };
      }
      virementRepris = true;
      console.log(`[${contexte}] virement ${m.stripe_transfer_id} repris (${d.id}) sur ${m.id}`);
    } catch (e) {
      console.error(`[${contexte}] reprise du virement impossible sur ${m.id} :`, e.message);
      return { ok: false, code: 502, message: "Le virement déjà versé au prestataire n'a pas pu être repris : rien n'a été remboursé." };
    }
  }

  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      // Un double clic ne rembourse pas deux fois.
      headers: { ...h, "Idempotency-Key": `bo-refund-${m.id}` },
      body: new URLSearchParams({ payment_intent: m.stripe_payment_intent, reason: "requested_by_customer" }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    // Déjà entièrement remboursé (par un autre chemin) : l'état voulu est atteint.
    if ((r.ok && d?.id) || d?.error?.code === "charge_already_refunded") {
      const heuresSupp = await rembourserHeuresSupp(m.id, cle, contexte);
      return { ok: true, refundId: d?.id || null, virementRepris, heuresSupp };
    }
    return { ok: false, code: 502, message: messageErreurStripe(d.error, `${contexte}/remboursement`)
      + (virementRepris ? " Attention : le virement au prestataire a, lui, été repris." : "") };
  } catch (e) {
    console.error(`[${contexte}] remboursement impossible sur ${m.id} :`, e.message);
    return { ok: false, code: 502, message: "Le service de paiement ne répond pas : rien n'a été remboursé. Réessayez."
      + (virementRepris ? " Attention : le virement au prestataire a, lui, été repris." : "") };
  }
}

/**
 * Rembourse les paiements d'HEURES SUPPLÉMENTAIRES d'une prestation.
 *
 * Une prolongation est un paiement distinct (`metadata[type]=heures_supp`), que
 * seul `extra_hours_payment_intent` référence — et une seconde prolongation
 * écrase la référence de la première. Le remboursement complet ne rendait que le
 * paiement de la réservation : ALANE gardait le prix des heures ajoutées, alors
 * que le virement au prestataire, qui les incluait, était repris (relecture du
 * 04/10/2026). Ils sont retrouvés chez Stripe par la prestation, et chacun
 * remboursé une seule fois (clé d'idempotence par paiement).
 *
 * Ne lève jamais : le remboursement principal a eu lieu. Un échec est journalisé
 * et compté, pour que l'appelant le dise.
 * @returns {Promise<{rembourses:number, echecs:number}>}
 */
export async function rembourserHeuresSupp(missionId, cle, contexte) {
  const bilan = { rembourses: 0, echecs: 0 };
  let paiements;
  try {
    const q = encodeURIComponent(`metadata['mission']:'${missionId}' AND metadata['type']:'heures_supp'`);
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/search?query=${q}&limit=20`,
      { headers: { "Authorization": `Bearer ${cle}` } });
    const d = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(d?.data)) throw new Error(`recherche refusée (${r.status})`);
    paiements = d.data.filter(pi => pi.status === "succeeded");
  } catch (e) {
    console.error(`[${contexte}] heures supplémentaires de ${missionId} NON vérifiées — à rembourser à la main s'il y en a :`, e.message);
    bilan.echecs++;
    return bilan;
  }
  for (const pi of paiements) {
    try {
      const r = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: { "Authorization": `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `bo-refund-supp-${pi.id}` },
        body: new URLSearchParams({ payment_intent: pi.id, reason: "requested_by_customer" }).toString(),
      });
      const d = await r.json().catch(() => ({}));
      if ((r.ok && d?.id) || d?.error?.code === "charge_already_refunded") bilan.rembourses++;
      else {
        bilan.echecs++;
        console.error(`[${contexte}] heures supplémentaires ${pi.id} de ${missionId} NON remboursées :`, JSON.stringify(d?.error || d).slice(0, 200));
      }
    } catch (e) {
      bilan.echecs++;
      console.error(`[${contexte}] heures supplémentaires ${pi.id} de ${missionId} NON remboursées :`, e.message);
    }
  }
  if (bilan.rembourses) console.log(`[${contexte}] ${bilan.rembourses} paiement(s) d'heures supplémentaires remboursé(s) sur ${missionId}`);
  return bilan;
}

/**
 * Le versement encore à venir de cette prestation doit-il être annulé ?
 * Oui s'il n'est pas parti (en attente, retenu, échoué). Un versement déjà
 * parti (`transferred`) garde sa trace : il est repris par
 * rembourserDepuisLeBO, pas réécrit.
 */
export function versementAAnnuler(m) {
  return ["pending", "held", "failed"].includes(m?.payout_status);
}

/**
 * Rend au client les heures ajoutées qui ne seront pas faites — sur le
 * paiement de prolongation qui les avait réglées (06/10/2026).
 *
 * `parPaiement` : { pi_… : euros }, tel que le calcule `ajoutsNonFaits()`.
 * Chaque remboursement est plafonné à ce qui reste remboursable sur son
 * paiement. La clé d'idempotence (`suffixe` : le jour et l'issue) fait qu'un
 * nouvel essai ne rembourse pas deux fois.
 *
 * Retourne { ok, centimes } — ok à false au premier échec : l'appelant
 * n'enregistre alors pas l'interruption.
 */
export async function rembourserAjoutsNonFaits(parPaiement, cle, suffixe, contexte) {
  let centimes = 0;
  for (const [pi, euros] of Object.entries(parPaiement || {})) {
    const voulu = Math.round(Number(euros) * 100);
    if (!(voulu > 0)) continue;
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=latest_charge`,
        { headers: { "Authorization": `Bearer ${cle}` } });
      const p = await r.json().catch(() => null);
      if (!r.ok || !p?.id) throw new Error(`paiement illisible (${r.status})`);
      const reste = Math.max(0, (Number(p.amount_received) || 0) - (Number(p.latest_charge?.amount_refunded) || 0));
      const montant = Math.min(voulu, reste);
      if (montant < voulu) console.warn(`[${contexte}] ${pi} : ${voulu} c voulus, ${reste} c encore remboursables.`);
      if (montant <= 0) continue;
      const rf = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: { "Authorization": `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `refund-ajout-${pi}-${suffixe}` },
        body: new URLSearchParams({ payment_intent: pi, amount: String(montant), reason: "requested_by_customer" }).toString(),
      });
      const d = await rf.json().catch(() => ({}));
      if (!rf.ok || !d?.id) throw new Error(JSON.stringify(d?.error || d).slice(0, 200));
      centimes += montant;
    } catch (e) {
      console.error(`[${contexte}] heures ajoutées NON remboursées sur ${pi} :`, e.message);
      return { ok: false, centimes };
    }
  }
  return { ok: true, centimes };
}
