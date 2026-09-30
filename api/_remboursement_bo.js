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
    if (r.ok && d?.id) return { ok: true, refundId: d.id, virementRepris };
    // Déjà entièrement remboursé (par un autre chemin) : l'état voulu est atteint.
    if (d?.error?.code === "charge_already_refunded") return { ok: true, refundId: null, virementRepris };
    return { ok: false, code: 502, message: messageErreurStripe(d.error, `${contexte}/remboursement`)
      + (virementRepris ? " Attention : le virement au prestataire a, lui, été repris." : "") };
  } catch (e) {
    console.error(`[${contexte}] remboursement impossible sur ${m.id} :`, e.message);
    return { ok: false, code: 502, message: "Le service de paiement ne répond pas : rien n'a été remboursé. Réessayez."
      + (virementRepris ? " Attention : le virement au prestataire a, lui, été repris." : "") };
  }
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
