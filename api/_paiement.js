// ═══════════════════════════════════════════════════════════════════════════
// Vérification d'un paiement de réservation auprès de Stripe
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// `assign_after_payment` et `affecter_tiers` recevaient du navigateur
// l'identifiant du paiement et le délai de réponse du prestataire, et les
// écrivaient tels quels. Constaté le 24/09/2026 par le scénario de recette
// `e2e/07` :
//
//   - sans aucun paiement, la prestation était proposée au prestataire ;
//   - avec un identifiant inventé (`pi_invente_…`), aussi ;
//   - le délai de réponse pouvait être fixé à un an.
//
// Le prestataire se déplaçait donc pour une prestation que personne n'avait
// payée, et c'est sur ce paiement fictif qu'il aurait été rémunéré. Pire : les
// refus qui suivent (secteur fermé, prestataire indisponible…) remboursaient
// l'identifiant reçu — celui du paiement d'un AUTRE client pouvait être
// transmis, et remboursé à son insu.
//
// COMMENT
//
// Le paiement est relu chez Stripe, avec la clé secrète, AVANT toute autre
// opération. Il doit :
//   - avoir abouti (`succeeded`), en euros, sans remboursement ;
//   - avoir été créé par /api/stripe-intent pour CETTE prestation et CE client
//     (`metadata[mission]`, `metadata[client]`) — et pas pour un complément
//     d'heures ni une recharge ;
//   - porter le montant de la prestation.
// Un identifiant « wallet_ » est refusé : le paiement par portefeuille a été
// retiré (api/wallet.js supprimé le 23/09/2026), aucune réservation nouvelle
// ne peut plus en porter un. Les prestations anciennes réglées ainsi restent
// remboursables par leurs propres chemins.
// ═══════════════════════════════════════════════════════════════════════════

import { calculerFrais, nombreDeJours } from "./_montant.js";
import { dateDuJourFr } from "./_temps.js";

/** Délais de réponse du prestataire, en minutes — ceux qu'annonçait le tunnel. */
export const DELAI_REPONSE_MIN = { urgent: 20, memeJour: 60, standard: 240 };

/** Format d'un identifiant de PaymentIntent Stripe. */
const FORMAT_PI = /^pi_[A-Za-z0-9]{8,}$/;

/**
 * Prix de la prestation et montant attendu sur la carte, en centimes.
 *
 * Même règle que /api/stripe-intent : `montant_total`, à défaut tarif × heures ;
 * puis la réduction de cashback retenue. On admet tout montant entre le prix
 * réduit et le prix plein : si l'inscription de la réduction a échoué,
 * stripe-intent a encaissé le prix plein — le client n'a rien payé en moins.
 */
export function bornesMontant(mission) {
  const prix = Number(mission?.montant_total)
    || Number(mission?.tarif_horaire || 0) * Number(mission?.hours || 0);
  const reduction = Math.max(0, Number(mission?.cashback_applique || 0));
  const plein = Math.round(prix * 100);
  const reduit = Math.round(Math.round((prix - reduction) * 100) / 100 * 100);
  return { min: Math.min(reduit, plein), max: plein };
}

/**
 * Contrôle un PaymentIntent déjà relu chez Stripe. Fonction pure.
 *
 * @param {object} pi           réponse de GET /v1/payment_intents/{id}?expand[]=latest_charge
 * @param {{missionId:string, clientId:string, mission:object}} attendu
 * @returns {{ok:true} | {ok:false, code:number, raison:string, message:string}}
 */
export function controlerPaiement(pi, { missionId, clientId, mission }) {
  const refus = (code, raison, message) => ({ ok: false, code, raison, message });
  if (!pi || pi.object !== "payment_intent") {
    return refus(402, "introuvable", "Paiement introuvable. Aucune somme n'a été enregistrée pour cette prestation.");
  }
  const meta = pi.metadata || {};
  if (meta.mission !== missionId || meta.client !== clientId) {
    return refus(403, "autre_prestation", "Ce paiement ne correspond pas à cette prestation.");
  }
  if (meta.type) {
    // `heures_supp` (complément d'heures) ou `wallet_topup` (recharge) : un
    // paiement réel, mais qui ne règle pas une réservation.
    return refus(403, `type_${meta.type}`, "Ce paiement ne correspond pas à cette prestation.");
  }
  if (pi.status !== "succeeded") {
    return refus(402, `statut_${pi.status}`, "Le paiement n'a pas abouti. Aucune somme n'a été prélevée pour cette prestation.");
  }
  if (String(pi.currency || "").toLowerCase() !== "eur") {
    return refus(403, "devise", "Ce paiement ne correspond pas à cette prestation.");
  }
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (charge && (charge.refunded || Number(charge.amount_refunded) > 0)) {
    return refus(409, "rembourse", "Ce paiement a déjà été remboursé.");
  }
  const recu = Number(pi.amount_received ?? pi.amount);
  const { min, max } = bornesMontant(mission);
  if (!(max > 0) || recu < min - 1 || recu > max + 1) {
    return refus(409, `montant_${recu}_attendu_${min}-${max}`,
      "Le montant réglé ne correspond pas à cette prestation.");
  }
  return { ok: true };
}

/**
 * Délai laissé au prestataire pour répondre, en minutes.
 *
 * C'était le navigateur qui le fixait (20 min en urgence, 60 le jour même,
 * 240 sinon) et le serveur l'écrivait sans le lire. La règle est la même,
 * appliquée ici sur ce que la base connaît de la prestation.
 *
 * L'urgence ne se stocke pas en colonne : elle se lit dans les frais de service
 * encaissés, qui sont ceux du tarif « urgent » (contrôlés par verifierMontant).
 */
export function delaiReponseMinutes(mission, frais, nowMs = Date.now()) {
  const partHoraire = Number(mission?.tarif_horaire || 0) * Number(mission?.hours || 0);
  const nbJours = nombreDeJours(mission);
  if (partHoraire > 0 && Number(mission?.montant_total) > 0) {
    const constates = Math.round((Number(mission.montant_total) - partHoraire * nbJours) * 100);
    const urgent = Math.round(calculerFrais("urgent", partHoraire * nbJours, nbJours, frais) * 100);
    const single = Math.round(calculerFrais("single", partHoraire * nbJours, nbJours, frais) * 100);
    if (Math.abs(constates - urgent) <= 1 && Math.abs(constates - single) > 1) return DELAI_REPONSE_MIN.urgent;
  }
  const jour = mission?.date || mission?.date_debut;
  if (!jour || String(jour).slice(0, 10) === dateDuJourFr(nowMs)) return DELAI_REPONSE_MIN.memeJour;
  return DELAI_REPONSE_MIN.standard;
}

/**
 * Relit le paiement chez Stripe et le confronte à la prestation.
 * À appeler AVANT toute autre opération de l'affectation.
 *
 * La prestation relue est rendue : elle sert au calcul du délai de réponse.
 *
 * @returns {Promise<{ok:true, intentId:string, mission:object} | {ok:false, code:number, raison:string, message:string}>}
 */
export async function verifierPaiementReservation({ intentId, missionId, clientId, supabaseUrl, headers, contexte }) {
  const refus = (code, raison, message) => {
    console.error(`[${contexte}] paiement refusé pour ${missionId} (client ${clientId}) : ${raison}`);
    return { ok: false, code, raison, message };
  };

  const id = String(intentId || "").trim();
  if (!id) return refus(402, "aucun_paiement", "Aucun paiement n'est enregistré pour cette prestation.");
  if (id.startsWith("wallet_")) {
    return refus(400, "wallet", "Le paiement par portefeuille n'est plus accepté. Réglez la prestation par carte.");
  }
  if (!FORMAT_PI.test(id)) return refus(402, "format", "Paiement introuvable. Aucune somme n'a été enregistrée pour cette prestation.");

  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) {
    return refus(503, "cle_stripe_absente", "Le paiement ne peut pas être vérifié pour le moment. Il est bien enregistré : réessayez dans quelques minutes ou contactez-nous.");
  }

  // La prestation, pour le montant. Le cashback est lu à part : une colonne
  // manquante ferait échouer toute la requête (voir stripe-intent).
  let mission;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${missionId}&select=montant_total,tarif_horaire,hours,date,date_debut,date_fin,stripe_payment_intent`, { headers });
    const d = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(d)) throw new Error(`lecture ${r.status}`);
    mission = d[0];
    if (!mission) return refus(404, "prestation_introuvable", "Prestation introuvable");
    const rc = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${missionId}&select=cashback_applique`, { headers });
    const dc = await rc.json().catch(() => null);
    if (rc.ok && Array.isArray(dc) && dc[0]) mission.cashback_applique = dc[0].cashback_applique;
    else console.error(`[${contexte}] cashback illisible sur ${missionId} — contrôle du montant au prix plein`);
  } catch (e) {
    console.error(`[${contexte}] prestation ${missionId} illisible :`, e.message);
    return refus(503, "base_illisible", "Le paiement ne peut pas être vérifié pour le moment. Il est bien enregistré : réessayez dans quelques minutes ou contactez-nous.");
  }

  // Une prestation déjà rattachée à un paiement n'en change pas.
  if (mission.stripe_payment_intent && mission.stripe_payment_intent !== id) {
    return refus(409, "autre_paiement_deja_rattache", "Un autre paiement est déjà rattaché à cette prestation.");
  }

  let pi;
  try {
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`, {
      headers: { "Authorization": `Bearer ${cle}` },
    });
    pi = await r.json().catch(() => null);
    if (r.status === 404) return refus(402, "inconnu_de_stripe", "Paiement introuvable. Aucune somme n'a été enregistrée pour cette prestation.");
    if (!r.ok) {
      console.error(`[${contexte}] Stripe répond ${r.status} pour ${id} :`, JSON.stringify(pi?.error || pi).slice(0, 200));
      return refus(502, `stripe_${r.status}`, "Le paiement ne peut pas être vérifié pour le moment. Il est bien enregistré : réessayez dans quelques minutes ou contactez-nous.");
    }
  } catch (e) {
    console.error(`[${contexte}] Stripe injoignable pour ${id} :`, e.message);
    return refus(502, "stripe_injoignable", "Le paiement ne peut pas être vérifié pour le moment. Il est bien enregistré : réessayez dans quelques minutes ou contactez-nous.");
  }

  const c = controlerPaiement(pi, { missionId, clientId, mission });
  if (!c.ok) return refus(c.code, c.raison, c.message);
  return { ok: true, intentId: id, mission };
}
