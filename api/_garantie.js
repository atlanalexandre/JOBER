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
// LES GARDE-FOUS, PENDANT TOUT LE MOIS (relevé quotidien, 05/11/2026) : la
// première version ne les vérifiait que le jour du contrôle — une suspension
// levée avant le 1er, ou un rayon d'1 km remis à 20 km le 31, passaient.
// Chaque matin, `noterReleves()` note pour chaque abonné s'il est disponible :
//   • abonnement Stripe ACTIF (« past_due », paiement en échec : non) ;
//   • profil validé et accès aux prestations ouvert ;
//   • des jours de disponibilité, et un rayon d'au moins ZONE_MIN_KM.
// Le mois n'est offert que si aucun relevé du mois n'est « indisponible », et
// s'il en compte au moins (jours du mois − RELEVES_MANQUANTS_ADMIS) : un passage
// manqué du traitement n'est pas reproché au prestataire, un mois sans relevé
// ne prouve rien.
//
// LA PREUVE DES PROPOSITIONS : `propositions_recues`, que seul le serveur écrit
// (api/_propositions.js). Premier mois examiné : PREMIER_MOIS.
// ═══════════════════════════════════════════════════════════════════════════

import { bornesMois } from "./_journal_comptable.js";
import { lireTout } from "./_lignes.js";
import { notifier } from "./_push.js";
import { euros } from "./_email.js";
import { frenchOffsetMs } from "./_temps.js";

/** Premier mois examiné : le premier mois civil entier après la mise en place des registres. */
export const PREMIER_MOIS = "2026-12";
/** Rayon d'intervention minimal pour être « réellement disponible ». */
export const ZONE_MIN_KM = 10;
/** Relevés quotidiens manquants tolérés sur un mois (passage du traitement manqué). */
export const RELEVES_MANQUANTS_ADMIS = 2;

/** Date du jour à Paris, « 2026-12-03 ». */
export function jourParis(maintenantMs = Date.now()) {
  return new Date(maintenantMs - frenchOffsetMs(new Date(maintenantMs))).toISOString().slice(0, 10);
}

/** Le mois civil qui vient de s'achever, heure de Paris : « 2026-12 ». */
export function moisEcoule(maintenantMs = Date.now()) {
  const paris = new Date(maintenantMs - frenchOffsetMs(new Date(maintenantMs)));
  const a = paris.getUTCFullYear(), m = paris.getUTCMonth(); // mois courant, 0-11
  const annee = m === 0 ? a - 1 : a, mois = m === 0 ? 12 : m;
  return `${annee}-${String(mois).padStart(2, "0")}`;
}

/** Les trois premiers jours du mois, heure de Paris : la garantie s'examine alors. */
export function estDebutDeMois(maintenantMs = Date.now()) {
  return Number(jourParis(maintenantMs).slice(8, 10)) <= 3;
}

/** Nombre de jours du mois « 2026-12 ». */
export const joursDuMois = (mois) => new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).getUTCDate();

/**
 * L'abonné est-il disponible AUJOURD'HUI ? Fonction pure, appliquée chaque matin.
 * @returns {{disponible:boolean, raison:string|null}}
 */
export function etatDuJour({ profil, meta = {}, statutAbonnement }) {
  const non = (raison) => ({ disponible: false, raison });
  if (statutAbonnement !== "active") return non(`abonnement ${statutAbonnement || "illisible"}`);
  if (profil?.status !== "approved" || profil?.missions_enabled !== true) return non("accès aux prestations fermé");
  if (!(Array.isArray(meta.dispon_jours) && meta.dispon_jours.length > 0)) return non("aucun jour de disponibilité");
  if (!(Number(meta.zone_km) >= ZONE_MIN_KM)) return non(`rayon inférieur à ${ZONE_MIN_KM} km`);
  return { disponible: true, raison: null };
}

/**
 * Le prestataire a-t-il droit au mois offert ? Fonction pure.
 * @param {{profil:object, abonnement:{statut:string, debutMs:number}, propositions:number,
 *          releves:{total:number, indisponibles:number}, mois:string}} o
 * @returns {{ok:true} | {ok:false, raison:string}}
 */
export function droitGarantie({ profil, abonnement, propositions, releves, mois }) {
  const non = (raison) => ({ ok: false, raison });
  if (!(mois >= PREMIER_MOIS)) return non("mois antérieur aux registres");
  const bornes = bornesMois(mois);
  if (!bornes) return non("mois illisible");
  if (profil?.garantie_mois_offert_at) return non("mois déjà offert une fois");
  if (!["premium", "elite"].includes(profil?.plan_abonnement)) return non("pas d'abonnement payant");
  if (!Number.isFinite(propositions)) return non("propositions illisibles");
  if (propositions > 0) return non(`${propositions} prestation(s) proposée(s)`);
  if (!releves || !Number.isFinite(releves.total) || !Number.isFinite(releves.indisponibles)) return non("relevés illisibles");
  if (releves.indisponibles > 0) return non(`${releves.indisponibles} jour(s) sans être disponible`);
  if (releves.total < joursDuMois(mois) - RELEVES_MANQUANTS_ADMIS) return non(`relevés incomplets (${releves.total} jours)`);
  if (!abonnement || abonnement.statut !== "active") return non("abonnement Stripe inactif");
  if (!(abonnement.debutMs > 0 && abonnement.debutMs <= bornes.gte * 1000)) return non("abonné après le début du mois");
  return { ok: true };
}

/**
 * L'abonnement Stripe en UNE lecture : statut, souscription et prix d'un mois.
 * Rend null s'il a disparu (404) ; LÈVE sur une panne passagère.
 */
async function lireAbonnement(subscriptionId, stripeKey) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } });
  if (r.status === 404) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`abonnement ${subscriptionId} illisible (${r.status})`);
  const prix = d?.items?.data?.[0]?.price;
  const mensuel = prix?.recurring?.interval === "year" ? Number(prix.unit_amount) / 12 : Number(prix?.unit_amount);
  return { statut: d.status, debutMs: Number(d.start_date || d.created || 0) * 1000,
    centimes: Math.round(Number.isFinite(mensuel) ? mensuel : 0) };
}

/** Les abonnés payants, lus EN ENTIER (PostgREST plafonne à 1 000 lignes). */
const lireAbonnes = (supabaseUrl, lecture, filtre = "") => lireTout(`${supabaseUrl}/rest/v1/profiles?role=eq.prestataire`
  + `&plan_abonnement=in.(premium,elite)&stripe_subscription_id=not.is.null&stripe_customer_id=not.is.null${filtre}`
  + "&select=id,status,missions_enabled,plan_abonnement,stripe_subscription_id,stripe_customer_id,garantie_mois_offert_at", lecture);

/**
 * Le relevé du matin : l'état de chaque abonné aujourd'hui. Une ligne par
 * abonné et par jour — un second passage le même jour la remplace.
 * @returns {Promise<{releves:number}>}
 */
export async function noterReleves({ supabaseUrl, headers, stripeKey, maintenantMs = Date.now() }) {
  const bilan = { releves: 0 };
  if (!stripeKey) { console.error("[garantie] clé Stripe absente — relevé du jour non fait."); return bilan; }
  const lecture = { apikey: headers.apikey, Authorization: headers.Authorization };
  const jour = jourParis(maintenantMs);
  let abonnes;
  try { abonnes = await lireAbonnes(supabaseUrl, lecture); }
  catch (e) { console.error("[garantie] abonnés illisibles — relevé du jour non fait :", e.message); return bilan; }
  const lignes = [];
  for (const profil of abonnes) {
    try {
      const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users/${profil.id}`, { headers: lecture });
      const u = await ur.json().catch(() => ({}));
      if (!ur.ok) throw new Error(`compte illisible (${ur.status})`);
      const abonnement = await lireAbonnement(profil.stripe_subscription_id, stripeKey);
      const etat = etatDuJour({ profil, meta: u.user_metadata || {}, statutAbonnement: abonnement?.statut || "disparu" });
      lignes.push({ prestataire_id: profil.id, jour, disponible: etat.disponible, raison: etat.raison });
    } catch (e) {
      // Pas de relevé ce jour-là pour lui : la tolérance de RELEVES_MANQUANTS_ADMIS l'absorbe.
      console.error(`[garantie] relevé du ${jour} manqué pour ${profil.id} :`, e.message);
    }
  }
  if (!lignes.length) return bilan;
  const w = await fetch(`${supabaseUrl}/rest/v1/garantie_releves`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(lignes),
  });
  if (!w.ok) {
    const t = await w.text().catch(() => "");
    console.error(`[garantie] relevé du ${jour} NON écrit (${w.status}) — migration 2026-11-05_garantie_releve_quotidien.sql passée ? ${t.slice(0, 160)}`);
    return bilan;
  }
  bilan.releves = lignes.length;
  return bilan;
}

const compter = async (url, lecture) => {
  const r = await fetch(url, { method: "HEAD", headers: { ...lecture, "Prefer": "count=exact" } });
  if (!r.ok) throw new Error(`comptage refusé (${r.status})`);
  return parseInt((r.headers.get("content-range") || "").split("/")[1], 10);
};

/**
 * L'examen du début de mois.
 * @returns {Promise<{examines:number, offerts:number}>}
 */
export async function appliquerGarantie({ supabaseUrl, headers, stripeKey, maintenantMs = Date.now() }) {
  const bilan = { examines: 0, offerts: 0 };
  const mois = moisEcoule(maintenantMs);
  if (mois < PREMIER_MOIS) return bilan;
  if (!stripeKey) { console.error("[garantie] clé Stripe absente — aucun mois examiné."); return bilan; }
  const bornes = bornesMois(mois);
  const debutIso = new Date(bornes.gte * 1000).toISOString(), finIso = new Date(bornes.lt * 1000).toISOString();
  const premierJour = `${mois}-01`, dernierJour = `${mois}-${String(joursDuMois(mois)).padStart(2, "0")}`;

  const lecture = { apikey: headers.apikey, Authorization: headers.Authorization };
  let abonnes;
  try { abonnes = await lireAbonnes(supabaseUrl, lecture, "&garantie_mois_offert_at=is.null"); }
  catch (e) {
    console.error("[garantie] abonnés illisibles — migration 2026-11-04_garantie_mois_sans_proposition.sql passée ? :", e.message);
    return bilan;
  }

  for (const profil of abonnes) {
    bilan.examines++;
    try {
      // D'abord ce qui ne coûte qu'une lecture de la base : la plupart des
      // abonnés s'arrêtent là, sans appel à Stripe (relecture du 05/11/2026).
      const propositions = await compter(`${supabaseUrl}/rest/v1/propositions_recues?prestataire_id=eq.${profil.id}`
        + `&created_at=gte.${encodeURIComponent(debutIso)}&created_at=lt.${encodeURIComponent(finIso)}&select=id`, lecture);
      if (propositions > 0) continue;
      const base = `${supabaseUrl}/rest/v1/garantie_releves?prestataire_id=eq.${profil.id}&jour=gte.${premierJour}&jour=lte.${dernierJour}&select=jour`;
      const releves = { total: await compter(base, lecture), indisponibles: await compter(`${base}&disponible=is.false`, lecture) };
      const pre = droitGarantie({ profil, abonnement: { statut: "active", debutMs: 1 }, propositions, releves, mois });
      if (!pre.ok) { console.log(`[garantie] ${profil.id} — ${mois} : pas de mois offert (${pre.raison})`); continue; }

      // Stripe en une seule lecture : statut, souscription et prix.
      const abonnement = await lireAbonnement(profil.stripe_subscription_id, stripeKey);
      const droit = droitGarantie({ profil, abonnement: abonnement || { statut: "disparu" }, propositions, releves, mois });
      if (!droit.ok) { console.log(`[garantie] ${profil.id} — ${mois} : pas de mois offert (${droit.raison})`); continue; }
      if (!(abonnement.centimes > 0)) { console.log(`[garantie] ${profil.id} — ${mois} : rien à déduire (abonnement gratuit)`); continue; }

      const marque = (corps, filtre) => fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profil.id}${filtre}`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(corps),
      });
      const rv = await marque({ garantie_mois_offert_at: new Date(maintenantMs).toISOString(), garantie_mois_offert_mois: mois }, "&garantie_mois_offert_at=is.null");
      const rvl = await rv.json().catch(() => []);
      if (!rv.ok) throw new Error(`réservation refusée (${rv.status})`);
      if (!Array.isArray(rvl) || rvl.length === 0) continue; // déjà offert par un autre passage

      const ar = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(profil.stripe_customer_id)}/balance_transactions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `garantie-${profil.id}` },
        body: new URLSearchParams({ amount: String(-abonnement.centimes), currency: "eur", description: `ALANE : mois offert, aucune prestation proposée en ${mois}` }).toString(),
      });
      const ad = await ar.json().catch(() => ({}));
      if (!ar.ok || !ad?.id) {
        // La garantie ne se joue qu'une fois : un avoir refusé ne doit pas la
        // consommer. La réservation est rendue, le passage suivant réessaie —
        // la clé d'idempotence empêche tout double avoir (relecture du 05/11/2026).
        const rendu = await marque({ garantie_mois_offert_at: null, garantie_mois_offert_mois: null }, "").catch(() => null);
        console.error(`[garantie] avoir refusé pour ${profil.id} (${abonnement.centimes} c) : ${ad?.error?.message || ar.status} — `
          + (rendu?.ok ? "réservation rendue, nouvel essai au passage suivant."
            : "réservation NON rendue : créer l'avoir à la main (Stripe, Clients → le client → Solde → Ajuster)."));
        continue;
      }
      bilan.offerts++;
      await notifier({ user_id: profil.id, type: "system",
        title: "🎁 Votre prochain mois vous est offert",
        body: `Aucune prestation ne vous a été proposée le mois dernier : un avoir de ${euros(abonnement.centimes / 100)} sera déduit de votre prochain prélèvement. Cette garantie s'applique une fois.` },
      supabaseUrl, headers).catch(e => console.error("[garantie] prestataire non prévenu :", e?.message));
    } catch (e) {
      console.error(`[garantie] ${profil.id} — ${mois} : examen reporté au passage suivant :`, e.message);
    }
  }
  console.log(`[garantie] ${mois} : ${bilan.examines} abonné(s) examiné(s), ${bilan.offerts} mois offert(s)`);
  return bilan;
}
