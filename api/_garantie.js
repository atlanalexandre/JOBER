// ═══════════════════════════════════════════════════════════════════════════
// Garantie « mois sans proposition » (décision d'Alexandre du 04/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Un prestataire abonné (Premium ou Elite) à qui AUCUNE prestation n'a été
// proposée pendant un mois civil entier reçoit le mois suivant offert : un
// avoir d'un mois de son abonnement chez Stripe, déduit de son prochain
// prélèvement (un douzième du prix pour un abonnement annuel).
//
// UNE SEULE FOIS par prestataire (décision d'Alexandre : « uniquement 1 mois
// offert »). Une prestation proposée — même refusée ou laissée sans réponse —
// suffit à ne rien offrir.
//
// LES GARDE-FOUS : le prestataire doit avoir été réellement disponible, sans
// quoi la garantie se détourne (aucune disponibilité, rayon minuscule) :
//   • abonné payant pendant TOUT le mois (abonnement Stripe actif, souscrit
//     avant le 1er) ;
//   • accès aux prestations ouvert avant le 1er, toujours ouvert, profil validé
//     — une pièce périmée ferme l'accès, elle exclut donc la garantie ;
//   • des jours de disponibilité renseignés, et un rayon d'au moins ZONE_MIN_KM.
//
// LA PREUVE : `propositions_recues`, que seul le serveur écrit
// (api/_propositions.js). Le premier mois examiné est PREMIER_MOIS : le
// registre n'existe pas avant, et un mois sans registre paraîtrait vide.
//
// Le traitement tourne le 1er de chaque mois (`cron-reset-monthly`, passage
// mensuel), pour le mois écoulé, heure de Paris.
// ═══════════════════════════════════════════════════════════════════════════

import { bornesMois } from "./_journal_comptable.js";
import { prixMensuelCentimes } from "./_invitation.js";
import { notifier } from "./_push.js";
import { euros } from "./_email.js";
import { frenchOffsetMs } from "./_temps.js";

/** Premier mois examiné : le premier mois civil entier après la mise en place du registre. */
export const PREMIER_MOIS = "2026-12";
/** Rayon d'intervention minimal pour être « réellement disponible ». */
export const ZONE_MIN_KM = 10;

/** Le mois civil qui vient de s'achever, heure de Paris : « 2026-12 ». */
export function moisEcoule(maintenantMs = Date.now()) {
  const paris = new Date(maintenantMs - frenchOffsetMs(new Date(maintenantMs)));
  const a = paris.getUTCFullYear(), m = paris.getUTCMonth(); // mois courant, 0-11
  const annee = m === 0 ? a - 1 : a, mois = m === 0 ? 12 : m;
  return `${annee}-${String(mois).padStart(2, "0")}`;
}

/** Les trois premiers jours du mois, heure de Paris : la garantie s'examine alors. */
export function estDebutDeMois(maintenantMs = Date.now()) {
  return new Date(maintenantMs - frenchOffsetMs(new Date(maintenantMs))).getUTCDate() <= 3;
}

/**
 * Le prestataire a-t-il droit au mois offert ? Fonction pure.
 * @param {{profil:object, meta:object, abonnement:{statut:string, debutMs:number}, propositions:number, mois:string}} o
 * @returns {{ok:true} | {ok:false, raison:string}}
 */
export function droitGarantie({ profil, meta = {}, abonnement, propositions, mois }) {
  const non = (raison) => ({ ok: false, raison });
  if (!(mois >= PREMIER_MOIS)) return non("mois antérieur au registre des propositions");
  const bornes = bornesMois(mois);
  if (!bornes) return non("mois illisible");
  const debutMs = bornes.gte * 1000;
  if (profil?.garantie_mois_offert_at) return non("mois déjà offert une fois");
  if (!["premium", "elite"].includes(profil?.plan_abonnement)) return non("pas d'abonnement payant");
  if (!abonnement || !["active", "past_due"].includes(abonnement.statut)) return non("abonnement Stripe inactif");
  if (!(abonnement.debutMs > 0 && abonnement.debutMs <= debutMs)) return non("abonné après le début du mois");
  if (profil.status !== "approved" || profil.missions_enabled !== true) return non("accès aux prestations fermé");
  const ouvertMs = Date.parse(profil.missions_enabled_at || "");
  if (!(ouvertMs <= debutMs)) return non("accès ouvert après le début du mois");
  const jours = Array.isArray(meta.dispon_jours) ? meta.dispon_jours.length : 0;
  if (jours === 0) return non("aucun jour de disponibilité");
  if (!(Number(meta.zone_km) >= ZONE_MIN_KM)) return non(`rayon d'intervention inférieur à ${ZONE_MIN_KM} km`);
  if (!Number.isFinite(propositions)) return non("propositions illisibles");
  if (propositions > 0) return non(`${propositions} prestation(s) proposée(s)`);
  return { ok: true };
}

/** L'abonnement Stripe : statut et date de souscription. LÈVE si Stripe ne répond pas. */
async function lireAbonnement(subscriptionId, stripeKey) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`abonnement ${subscriptionId} illisible (${r.status})`);
  return { statut: d.status, debutMs: Number(d.start_date || d.created || 0) * 1000 };
}

/**
 * Le traitement du 1er du mois.
 * @returns {Promise<{examines:number, offerts:number}>}
 */
export async function appliquerGarantie({ supabaseUrl, headers, stripeKey, maintenantMs = Date.now() }) {
  const bilan = { examines: 0, offerts: 0 };
  const mois = moisEcoule(maintenantMs);
  if (mois < PREMIER_MOIS) return bilan;
  if (!stripeKey) { console.error("[garantie] clé Stripe absente — aucun mois examiné."); return bilan; }
  const bornes = bornesMois(mois);
  const debutIso = new Date(bornes.gte * 1000).toISOString(), finIso = new Date(bornes.lt * 1000).toISOString();

  const lecture = { apikey: headers.apikey, Authorization: headers.Authorization };
  const r = await fetch(`${supabaseUrl}/rest/v1/profiles?role=eq.prestataire&plan_abonnement=in.(premium,elite)`
    + "&stripe_subscription_id=not.is.null&stripe_customer_id=not.is.null&garantie_mois_offert_at=is.null"
    + "&select=id,status,missions_enabled,missions_enabled_at,plan_abonnement,stripe_subscription_id,stripe_customer_id,garantie_mois_offert_at",
  { headers: lecture });
  const abonnes = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(abonnes)) {
    // Avant la migration 2026-11-04_garantie_mois_sans_proposition.sql : la colonne manque.
    console.error(`[garantie] abonnés illisibles (${r.status}) — migration 2026-11-04_garantie_mois_sans_proposition.sql passée ?`);
    return bilan;
  }

  for (const profil of abonnes) {
    bilan.examines++;
    try {
      const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users/${profil.id}`, { headers: lecture });
      const u = await ur.json().catch(() => ({}));
      if (!ur.ok) throw new Error(`compte illisible (${ur.status})`);
      const cr = await fetch(`${supabaseUrl}/rest/v1/propositions_recues?prestataire_id=eq.${profil.id}`
        + `&created_at=gte.${encodeURIComponent(debutIso)}&created_at=lt.${encodeURIComponent(finIso)}&select=id`,
      { method: "HEAD", headers: { ...lecture, "Prefer": "count=exact" } });
      if (!cr.ok) throw new Error(`propositions illisibles (${cr.status})`);
      const propositions = parseInt((cr.headers.get("content-range") || "").split("/")[1], 10);
      const abonnement = await lireAbonnement(profil.stripe_subscription_id, stripeKey);

      const droit = droitGarantie({ profil, meta: u.user_metadata || {}, abonnement, propositions, mois });
      if (!droit.ok) { console.log(`[garantie] ${profil.id} — ${mois} : pas de mois offert (${droit.raison})`); continue; }

      // Le prix est lu AVANT la réservation : une panne Stripe reporte, ne perd rien.
      const centimes = await prixMensuelCentimes(profil, stripeKey);
      if (!centimes) { console.log(`[garantie] ${profil.id} — ${mois} : rien à déduire chez Stripe (abonnement disparu ou gratuit)`); continue; }

      const rv = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profil.id}&garantie_mois_offert_at=is.null`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ garantie_mois_offert_at: new Date(maintenantMs).toISOString(), garantie_mois_offert_mois: mois }),
      });
      const rvl = await rv.json().catch(() => []);
      if (!rv.ok) throw new Error(`réservation refusée (${rv.status})`);
      if (!Array.isArray(rvl) || rvl.length === 0) continue; // déjà offert par un autre passage

      const ar = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(profil.stripe_customer_id)}/balance_transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `garantie-${profil.id}` },
        body: new URLSearchParams({ amount: String(-centimes), currency: "eur", description: `ALANE : mois offert, aucune prestation proposée en ${mois}` }).toString(),
      });
      const ad = await ar.json().catch(() => ({}));
      if (!ar.ok || !ad?.id) {
        console.error(`[garantie] AVOIR NON CRÉÉ pour ${profil.id} (${centimes} c, client Stripe ${profil.stripe_customer_id}) : `
          + `${ad?.error?.message || ar.status} — garantie marquée : créer l'avoir à la main (Stripe, Clients → le client → Solde → Ajuster).`);
        continue;
      }
      bilan.offerts++;
      await notifier({ user_id: profil.id, type: "system",
        title: "🎁 Votre prochain mois vous est offert",
        body: `Aucune prestation ne vous a été proposée le mois dernier : un avoir de ${euros(centimes / 100)} sera déduit de votre prochain prélèvement. Cette garantie s'applique une fois.` },
      supabaseUrl, headers).catch(e => console.error("[garantie] prestataire non prévenu :", e?.message));
    } catch (e) {
      console.error(`[garantie] ${profil.id} — ${mois} : examen reporté, à reprendre :`, e.message);
    }
  }
  console.log(`[garantie] ${mois} : ${bilan.examines} abonné(s) examiné(s), ${bilan.offerts} mois offert(s)`);
  return bilan;
}
