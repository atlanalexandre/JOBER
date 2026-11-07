// ═══════════════════════════════════════════════════════════════════════════
// « Invitez vos clients » — la récompense (décision d'Alexandre du 02/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Un prestataire envoie son lien à un client. Si ce client, NOUVEAU sur ALANE,
// fait une prestation d'au moins 50 € qui se termine sans litige :
//
//   • le client reçoit en CASHBACK le montant des frais de service qu'il a
//     payés — crédit non convertible en espèces (CGPS 5B.4), utilisable sur sa
//     prochaine réservation ;
//   • le prestataire qui l'a invité reçoit UN MOIS d'abonnement offert : un
//     avoir chez Stripe s'il est abonné, un mois Premium sinon — comme le
//     parrainage entre prestataires (stripe-webhook.js).
//
// POURQUOI APRÈS LA PRESTATION, ET EN CRÉDIT
//
// Retirer les frais du paiement touchait une dizaine de calculs : le montant
// prélevé, chaque remboursement, les litiges, la facture, l'export comptable,
// le contrôle du paiement par Stripe. Un seul oubli, et un client invité qui
// annule était mal remboursé. Le crédit après coup ne touche à aucun d'eux
// (choix d'Alexandre, option A). Et un crédit qui ne s'encaisse pas ne
// s'extrait pas par de faux comptes.
//
// LES GARDE-FOUS
//
//   • la prestation est TERMINÉE (`completed`), sa fenêtre de contestation de
//     48 h est close, et son versement n'est pas retenu pour litige ;
//   • elle vaut au moins 50 € hors frais (MONTANT_MIN, décision d'Alexandre) ;
//   • une fois par client, jamais deux : la réservation de la récompense est
//     une écriture conditionnelle sur `invitation_recompensee_at IS NULL` ;
//   • six mois offerts au plus par prestataire sur douze mois glissants ;
//   • la carte du client n'est pas une carte du prestataire. Un prestataire
//     qui se réserverait lui-même par un faux compte récupère l'argent — c'est
//     lui qui est payé — : le minimum de 50 € ne l'arrête pas seul. Le
//     contrôle n'est possible que si le prestataire a une carte chez Stripe ;
//     le plafond reste la limite sinon.
//
// Le traitement tourne toutes les deux heures (`cron-reset-monthly`) : il
// rattrape seul une récompense manquée, quel que soit le chemin de validation
// (client, validation automatique, back-office).
// ═══════════════════════════════════════════════════════════════════════════

import { echeanceVersementMs } from "./_temps.js";
import { nombreDeJours } from "./_montant.js";
import { lireTout } from "./_lignes.js";
import { notifier } from "./_push.js";
import { euros } from "./_email.js";

import { MONTANT_MIN, PLAFOND_MOIS_PAR_AN } from "./_invitation_regles.js";
export { MONTANT_MIN, PLAFOND_MOIS_PAR_AN };
/** Garde-fou : des frais de service au-delà sont une donnée aberrante. */
export const FRAIS_OFFERTS_MAX = 50;

const UN_AN_MS = 365 * 86400000;
/**
 * Lancement du programme (mise en production du 03/11/2026). Un client inscrit
 * AVANT par un lien de parrainage (le rattachement existe depuis le 24/09)
 * n'a reçu aucune promesse : le récompenser serait verser pour rien — et il
 * n'est pas « nouveau » au sens de l'offre (relecture du 04/11/2026).
 */
export const LANCEMENT = "2026-11-03T00:00:00Z";
const arrondi = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** Part de la prestation hors frais de service, en euros. */
export function partPrestation(m) {
  if (m?.payout_amount != null && Number.isFinite(Number(m.payout_amount))) return arrondi(m.payout_amount);
  return arrondi(Number(m?.tarif_horaire || 0) * Number(m?.hours || 0) * nombreDeJours(m));
}

/** Un paiement par carte Stripe (`pi_…`), le seul dont on lit la carte. */
const PAIEMENT_CARTE = /^pi_[A-Za-z0-9]{8,}$/;

/** Les frais de service payés sur cette prestation, à offrir. 0 si illisibles. */
export function fraisAOffrir(m) {
  const total = Number(m?.montant_total);
  if (!(total > 0)) return 0;
  const frais = arrondi(total - partPrestation(m));
  return frais > 0 && frais <= FRAIS_OFFERTS_MAX ? frais : 0;
}

/**
 * La prestation ouvre-t-elle la récompense ? Fonction pure.
 * @returns {{ok:true} | {ok:false, raison:string}}
 */
export function prestationQualifiante(m, maintenantMs = Date.now()) {
  if (!m || m.status !== "completed") return { ok: false, raison: "non terminée" };
  if (!m.stripe_payment_intent) return { ok: false, raison: "sans paiement" };
  // Un ancien paiement par portefeuille (`wallet_…`) n'a pas de carte à lire :
  // Stripe refusait la lecture, et le client était reporté à chaque passage,
  // indéfiniment (relecture du 04/11/2026).
  if (!PAIEMENT_CARTE.test(m.stripe_payment_intent)) return { ok: false, raison: "paiement hors carte" };
  // La part du prestataire est celle fixée à la clôture. Sans elle, une
  // estimation tarif × heures ignore les heures réelles et les prolongations :
  // on ne devine pas un montant d'argent (relecture du 04/11/2026).
  if (m.payout_amount == null || !Number.isFinite(Number(m.payout_amount))) return { ok: false, raison: "part du prestataire inconnue" };
  if (["held", "annule", "failed"].includes(m.payout_status)) return { ok: false, raison: `versement ${m.payout_status}` };
  if (echeanceVersementMs(m, maintenantMs) > maintenantMs) return { ok: false, raison: "contestation encore ouverte" };
  if (partPrestation(m) < MONTANT_MIN) return { ok: false, raison: `moins de ${MONTANT_MIN} €` };
  return { ok: true };
}

/**
 * Pour chaque client, sa PREMIÈRE prestation qualifiante (la plus ancienne).
 * @returns {Map<string, object>} client_id → prestation
 */
export function premieresQualifiantes(missions, maintenantMs = Date.now()) {
  const tri = [...(Array.isArray(missions) ? missions : [])]
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const parClient = new Map();
  for (const m of tri) {
    if (!m.client_id || parClient.has(m.client_id)) continue;
    if (prestationQualifiante(m, maintenantMs).ok) parClient.set(m.client_id, m);
  }
  return parClient;
}

/**
 * Le prestataire reçoit-il son mois offert ? Fonction pure.
 * @param {{parrain:object, dejaOffertsSurUnAn:number, carteClient:string|null, cartesPresta:string[]}} o
 */
export function decisionMoisOffert({ parrain, dejaOffertsSurUnAn, carteClient, cartesPresta }) {
  if (!parrain || parrain.role !== "prestataire") return { offrir: false, raison: "parrain non prestataire" };
  if (dejaOffertsSurUnAn >= PLAFOND_MOIS_PAR_AN) return { offrir: false, raison: `plafond de ${PLAFOND_MOIS_PAR_AN} mois atteint` };
  if (carteClient && (cartesPresta || []).includes(carteClient)) return { offrir: false, raison: "carte du client = carte du prestataire" };
  return { offrir: true };
}

const lots = (liste, taille = 100) => {
  const out = [];
  for (let i = 0; i < liste.length; i += taille) out.push(liste.slice(i, i + taille));
  return out;
};

/** Empreinte de la carte qui a payé la prestation. null si sans carte ; lève sur une panne. */
async function empreinteCarteClient(pi, stripeKey) {
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=latest_charge`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`paiement ${pi} illisible (${r.status})`);
  return d?.latest_charge?.payment_method_details?.card?.fingerprint || null;
}

/** Empreintes des cartes enregistrées du prestataire. [] sans client Stripe ; lève sur une panne. */
async function empreintesCartesPresta(customerId, stripeKey) {
  if (!customerId) return [];
  const r = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=100`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`cartes du client Stripe ${customerId} illisibles (${r.status})`);
  return (d?.data || []).map(pm => pm?.card?.fingerprint).filter(Boolean);
}

/**
 * Offre un mois d'abonnement au prestataire. Même règle que le parrainage
 * (`stripe-webhook.js`) : abonné payant → avoir chez Stripe d'un mois de son
 * abonnement, déduit de sa prochaine facture ; sinon un mois Premium, qui
 * prolonge sans jamais déclasser.
 * @returns {Promise<{ok:boolean, texte:string}>}
 */
/** Le prestataire paie-t-il un abonnement Stripe ? Son mois offert est alors un avoir. */
export const estAbonnePayant = (parrain) => !!(parrain?.stripe_subscription_id && parrain?.stripe_customer_id
  && parrain?.plan_abonnement && parrain.plan_abonnement !== "free");

/**
 * Prix d'un mois, en centimes, lu dans un abonnement Stripe déjà relu : un
 * douzième du prix annuel pour un abonnement annuel. Fonction pure, SEULE
 * règle — partagée avec la garantie (api/_garantie.js, 06/11/2026).
 */
export function prixMensuelDepuisAbonnement(abonnement) {
  const prix = abonnement?.items?.data?.[0]?.price;
  const mensuel = prix?.recurring?.interval === "year" ? Number(prix.unit_amount) / 12 : Number(prix?.unit_amount);
  return Math.round(Number.isFinite(mensuel) ? mensuel : 0);
}

/**
 * Prix d'un mois de son abonnement, en centimes. LÈVE si Stripe ne répond pas :
 * lu AVANT la réservation, une panne reporte la récompense au passage suivant.
 * Lu après, elle perdait le mois — compté pourtant dans le plafond (relecture
 * du 04/11/2026).
 */
export async function prixMensuelCentimes(parrain, stripeKey) {
  const sr = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(parrain.stripe_subscription_id)}`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } });
  const sd = await sr.json().catch(() => ({}));
  // Abonnement disparu chez Stripe : rien à déduire, définitivement. Rendre
  // null — et non lever — évite de reporter à l'infini, chaque passage, une
  // récompense qui ne viendra jamais, et avec elle le cashback du client
  // invité (relecture du 05/11/2026).
  if (sr.status === 404) return null;
  if (!sr.ok) throw new Error(`prix de l'abonnement illisible (${sr.status})`);
  const centimes = prixMensuelDepuisAbonnement(sd);
  // Prix nul (remise à 100 %) : il ne paie rien, un avoir n'aurait pas de sens.
  return centimes > 0 ? centimes : null;
}

export async function offrirMoisAbonnement(parrain, cle, { supabaseUrl, headers, stripeKey, centimes }) {
  if (estAbonnePayant(parrain)) {
    if (!(centimes > 0)) return { ok: false, texte: "prix de l'abonnement non lu" };
    const ar = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(parrain.stripe_customer_id)}/balance_transactions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": cle },
      body: new URLSearchParams({ amount: String(-centimes), currency: "eur", description: "ALANE : 1 mois offert, client invité" }).toString(),
    });
    const ad = await ar.json().catch(() => ({}));
    if (!ar.ok || !ad?.id) return { ok: false, texte: ad?.error?.message || `avoir refusé (${ar.status})` };
    return { ok: true, texte: `Un avoir de ${euros(centimes / 100)} sera déduit de votre prochain prélèvement.` };
  }
  const fin = parrain.subscription_end_date ? new Date(parrain.subscription_end_date).getTime() : 0;
  const nouvelleFin = new Date(Math.max(Number.isFinite(fin) ? fin : 0, Date.now()) + 30 * 86400000);
  const plan = parrain.plan_abonnement && parrain.plan_abonnement !== "free" ? parrain.plan_abonnement : "premium";
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${parrain.id}`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify({ plan_abonnement: plan, subscription_end_date: nouvelleFin.toISOString().split("T")[0] }),
  });
  const lignes = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(lignes) || lignes.length === 0) return { ok: false, texte: `prolongation refusée (${r.status})` };
  return { ok: true, texte: `Votre abonnement ${parrain.plan_abonnement === "elite" ? "Elite" : "Premium"} court jusqu'au ${nouvelleFin.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.` };
}

/**
 * Le traitement : trouve les clients invités dont la première prestation
 * qualifiante vient de se terminer, et verse les deux récompenses.
 * @returns {Promise<{clients:number, mois:number, ignores:number}>}
 */
export async function recompenserInvitations({ supabaseUrl, headers, stripeKey, maintenantMs = Date.now() }) {
  const bilan = { clients: 0, mois: 0, ignores: 0 };
  const lecture = { apikey: headers.apikey, Authorization: headers.Authorization };

  let invites;
  try {
    invites = await lireTout(`${supabaseUrl}/rest/v1/profiles?role=eq.client&referred_by=not.is.null`
      + `&invitation_recompensee_at=is.null&created_at=gte.${encodeURIComponent(LANCEMENT)}&select=id,referred_by`, lecture);
  } catch (e) {
    // Avant la migration 2026-11-02_invitation_clients.sql, la colonne
    // n'existe pas : la lecture est refusée, et rien n'est versé. On le dit.
    console.error("[invitation] clients invités illisibles — migration 2026-11-02_invitation_clients.sql passée ? :", e.message);
    return bilan;
  }
  if (!invites.length) return bilan;
  const parrainDe = new Map(invites.map(p => [p.id, String(p.referred_by)]));

  // Leurs prestations terminées, par lots : un seul `in.(…)` dépasse la
  // longueur d'adresse admise au-delà de quelques centaines d'identifiants.
  const missions = [];
  for (const lot of lots(invites.map(p => p.id))) {
    try {
      missions.push(...await lireTout(`${supabaseUrl}/rest/v1/missions?client_id=in.(${lot.join(",")})&status=eq.completed`
        + "&stripe_payment_intent=not.is.null&select=id,client_id,status,payout_status,payout_amount,montant_total,tarif_horaire,"
        + "hours,actual_hours,date,date_debut,date_fin,heure_debut,started_at,stripe_payment_intent,created_at", lecture));
    } catch (e) {
      console.error("[invitation] prestations illisibles — lot reporté au prochain passage :", e.message);
    }
  }
  const aRecompenser = premieresQualifiantes(missions, maintenantMs);
  if (!aRecompenser.size) return bilan;

  // Les prestataires qui ont invité.
  const idsParrains = [...new Set([...aRecompenser.keys()].map(c => parrainDe.get(c)).filter(Boolean))];
  const parrains = new Map();
  for (const lot of lots(idsParrains)) {
    try {
      const l = await lireTout(`${supabaseUrl}/rest/v1/profiles?id=in.(${lot.join(",")})`
        + "&select=id,role,plan_abonnement,subscription_end_date,stripe_customer_id,stripe_subscription_id", lecture);
      for (const p of l) parrains.set(p.id, p);
    } catch (e) {
      console.error("[invitation] prestataires invitants illisibles — reporté :", e.message);
      return bilan;
    }
  }

  for (const [clientId, m] of aRecompenser) {
    try {
      const parrain = parrains.get(parrainDe.get(clientId)) || null;
      // Le programme est celui des PRESTATAIRES : un client parrainé par un
      // autre client, ou par un compte disparu, n'ouvre rien. Il est marqué
      // quand même, pour ne pas être relu à chaque passage.
      const frais = parrain?.role === "prestataire" ? fraisAOffrir(m) : 0;

      // La décision est prise AVANT de réserver la récompense : une lecture
      // impossible reporte tout au passage suivant, sans rien perdre.
      let decision = { offrir: false, raison: "parrain introuvable" };
      if (parrain) {
        const depuis = new Date(maintenantMs - UN_AN_MS).toISOString();
        const cr = await fetch(`${supabaseUrl}/rest/v1/profiles?referred_by=eq.${parrain.id}&invitation_mois_offert=is.true`
          + `&invitation_recompensee_at=gte.${encodeURIComponent(depuis)}&select=id`,
          { method: "HEAD", headers: { ...lecture, "Prefer": "count=exact" } });
        if (!cr.ok) throw new Error(`plafond illisible (${cr.status})`);
        const dejaOffertsSurUnAn = parseInt((cr.headers.get("content-range") || "").split("/")[1], 10) || 0;
        const carteClient = stripeKey ? await empreinteCarteClient(m.stripe_payment_intent, stripeKey) : null;
        const cartesPresta = stripeKey ? await empreintesCartesPresta(parrain.stripe_customer_id, stripeKey) : [];
        decision = decisionMoisOffert({ parrain, dejaOffertsSurUnAn, carteClient, cartesPresta });
        if (decision.offrir && estAbonnePayant(parrain)) {
          decision.centimes = await prixMensuelCentimes(parrain, stripeKey);
          // Rien à déduire chez Stripe : le mois est offert comme à un
          // prestataire non abonné, en prolongeant sa formule.
          if (decision.centimes === null) decision.sansAvoir = true;
        }
      }

      // Réservation : une seule fois par client, quelles que soient les
      // livraisons concurrentes.
      const rv = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${clientId}&invitation_recompensee_at=is.null`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ invitation_recompensee_at: new Date(maintenantMs).toISOString(), invitation_mission_id: m.id,
          invitation_frais_offerts: frais, invitation_mois_offert: decision.offrir }),
      });
      const rvl = await rv.json().catch(() => []);
      if (!rv.ok) throw new Error(`réservation refusée (${rv.status}) : ${JSON.stringify(rvl).slice(0, 160)}`);
      if (!Array.isArray(rvl) || rvl.length === 0) continue; // déjà récompensé par un autre passage

      // 1. Le client : ses frais de service, en cashback.
      if (frais > 0) {
        const cb = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_cashback`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
          body: JSON.stringify({ p_user_id: clientId, p_delta: frais, p_missions: 0 }),
        });
        if (cb.ok) {
          bilan.clients++;
          await notifier({ user_id: clientId, type: "cashback", ref_id: m.id,
            title: "🎁 Vos frais de service vous sont offerts",
            body: `Bienvenue sur ALANE : ${euros(frais)} crédités sur votre cashback, utilisables au paiement de votre prochaine réservation.` },
          supabaseUrl, headers).catch(e => console.error("[invitation] client non prévenu :", e?.message));
        } else {
          console.error(`[invitation] CASHBACK NON CRÉDITÉ au client ${clientId} (${frais} €, prestation ${m.id}) : `
            + `${cb.status} — récompense marquée : ajouter ${frais} € à son cashback_balance à la main.`);
        }
      }

      // 2. Le prestataire : un mois offert, sauf plafond ou carte suspecte.
      if (!decision.offrir) {
        bilan.ignores++;
        console.log(`[invitation] pas de mois offert pour le client ${clientId} : ${decision.raison}`);
        continue;
      }
      const parrainOffre = decision.sansAvoir ? { ...parrain, stripe_subscription_id: null } : parrain;
      const offert = await offrirMoisAbonnement(parrainOffre, `invitation-${clientId}`, { supabaseUrl, headers, stripeKey, centimes: decision.centimes });
      if (!offert.ok) {
        console.error(`[invitation] MOIS NON OFFERT au prestataire ${parrain.id} (client ${clientId}) : ${offert.texte} `
          + "— récompense marquée : l'accorder à la main (Stripe, Clients → le client → Solde → Ajuster, ou un mois Premium).");
        continue;
      }
      bilan.mois++;
      await notifier({ user_id: parrain.id, type: "system", ref_id: m.id,
        title: "🎁 1 mois offert — client invité",
        body: `Un client que vous avez invité a terminé sa première prestation. ${offert.texte}` },
      supabaseUrl, headers).catch(e => console.error("[invitation] prestataire non prévenu :", e?.message));
    } catch (e) {
      console.error(`[invitation] client ${clientId} reporté au prochain passage :`, e.message);
    }
  }
  if (bilan.clients || bilan.mois || bilan.ignores) {
    console.log(`[invitation] ${bilan.clients} client(s) crédité(s), ${bilan.mois} mois offert(s), ${bilan.ignores} sans mois offert`);
  }
  return bilan;
}
