// Journal comptable du mois (relecture du 26/10/2026).
//
// « 🧾 Export comptable » ne donnait que les prestations : ni les frais de
// service, ni les abonnements, ni les frais Stripe, ni les remboursements. Un
// comptable ne tient pas une comptabilité avec ça.
//
// La source est ici le relevé du solde Stripe (`balance_transactions`) : chaque
// euro entré ou sorti du compte y figure une fois, avec la commission Stripe et
// le net. C'est le relevé que le comptable rapprochera de la banque — on ne le
// recalcule pas depuis la base, qui ne voit pas les frais Stripe et peut
// ignorer un paiement que l'application n'a pas confirmé.
//
// La base ne sert qu'à éclairer : le nom de la prestation, et la part « frais
// de service » d'une réservation quand elle se déduit sans hypothèse des
// montants enregistrés. Sinon la case reste vide : un export qui sera repris
// tel quel ne doit rien inventer (voir le 24/10/2026, commission à 20 %).

import { frenchOffsetMs } from "./_temps.js";
import { nombreDeJours } from "./_montant.js";

/** « 2026-10 » → bornes du mois en secondes Unix, heure de Paris. null si illisible. */
export function bornesMois(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mois || ""));
  if (!m) return null;
  const annee = Number(m[1]), num = Number(m[2]);
  if (annee < 2020 || annee > 2100 || num < 1 || num > 12) return null;
  // Minuit à Paris = minuit UTC + décalage. Le décalage se lit à l'instant
  // visé : le 1er novembre est déjà à l'heure d'hiver.
  const minuitParis = (a, mo) => {
    const utc = Date.UTC(a, mo - 1, 1);
    return utc + frenchOffsetMs(new Date(utc));
  };
  const debut = minuitParis(annee, num);
  const fin = num === 12 ? minuitParis(annee + 1, 1) : minuitParis(annee, num + 1);
  return { gte: Math.floor(debut / 1000), lt: Math.floor(fin / 1000) };
}

const LIBELLES_TYPE = {
  payout: "Virement vers le compte bancaire",
  payout_cancel: "Virement bancaire annulé",
  payout_failure: "Virement bancaire échoué",
  transfer: "Versement prestataire",
  transfer_cancel: "Versement prestataire annulé",
  transfer_failure: "Versement prestataire échoué",
  transfer_refund: "Versement prestataire repris",
  stripe_fee: "Frais Stripe",
  stripe_fx_fee: "Frais Stripe (change)",
  tax_fee: "Frais Stripe (taxe)",
  adjustment: "Ajustement Stripe",
  dispute: "Contestation bancaire",
  dispute_reversal: "Contestation bancaire annulée",
  payment_failure_refund: "Paiement échoué rendu",
};

const objet = (x) => (x && typeof x === "object" ? x : null);
const idDe = (x) => (typeof x === "string" ? x : objet(x)?.id || "");

/** Ce que paie le client, d'après les repères posés sur le paiement. */
export function natureDuPaiement(charge) {
  const md = objet(charge)?.metadata || {};
  if (md.type === "heures_supp") return "Heures supplémentaires";
  if (md.type === "serie" || md.serie) return "Réservation (série)";
  if (md.mission) return "Réservation";
  if (objet(charge)?.invoice || md.plan || /^subscription/i.test(objet(charge)?.description || "")) {
    return "Abonnement prestataire";
  }
  return "Autre paiement";
}

const euros = (centimes) => Math.round(Number(centimes || 0)) / 100;

/**
 * Part « frais de service » d'une réservation, déduite des seuls montants
 * enregistrés : prix de la prestation − part horaire, comme `verifierMontant()`
 * à l'encaissement. Uniquement quand le paiement correspond au prix enregistré
 * (cashback déduit) : une prestation prolongée, interrompue ou recalculée a
 * changé de prix depuis, et la part ne se déduit plus sans hypothèse.
 */
export function fraisServiceDeduits(mission, montantPayeCentimes) {
  if (!mission) return null;
  const total = Number(mission.montant_total);
  const horaire = Number(mission.tarif_horaire || 0) * Number(mission.hours || 0) * nombreDeJours(mission);
  if (!(total > 0) || !(horaire > 0)) return null;
  const paye = Math.round(total * 100) - Math.round(Number(mission.cashback_applique || 0) * 100);
  if (Math.abs(paye - Number(montantPayeCentimes)) > 1) return null;
  const frais = Math.round((total - horaire) * 100) / 100;
  return frais >= 0 ? frais : null;
}

/** Date et heure de Paris, « 2026-10-26 14:05 ». */
function dateParis(secondes) {
  const ms = Number(secondes) * 1000;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms - frenchOffsetMs(new Date(ms))).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Une ligne du journal à partir d'un mouvement Stripe lu avec
 * `expand[]=data.source.charge`.
 *
 * @param {object} t         balance_transaction
 * @param {Map} missions     id → ligne `missions` (id, metier, montant_total, …)
 */
export function ligneJournal(t, missions = new Map()) {
  const source = objet(t.source);
  let nature, missionId, charge = null;

  if (t.type === "charge" || t.type === "payment") {
    charge = source;
    nature = natureDuPaiement(charge);
    missionId = charge?.metadata?.mission || "";
  } else if (t.type === "refund" || t.type === "payment_refund") {
    charge = objet(source?.charge);
    nature = `Remboursement — ${natureDuPaiement(charge)}`;
    missionId = source?.metadata?.mission || charge?.metadata?.mission || "";
  } else {
    nature = LIBELLES_TYPE[t.type] || `Autre (${t.type})`;
    missionId = source?.metadata?.mission_id || source?.metadata?.mission || "";
  }

  const mission = missionId ? missions.get(missionId) : null;
  const frais = t.type === "charge" && nature === "Réservation"
    ? fraisServiceDeduits(mission, t.amount) : null;

  return {
    date: dateParis(t.created),
    nature,
    montant: euros(t.amount),
    frais_stripe: euros(t.fee),
    net: euros(t.net),
    frais_service: frais,
    prestation: missionId,
    metier: mission?.metier || "",
    // En mode test, la recette et la production partagent le compte Stripe :
    // un paiement dont la prestation n'est pas dans cette base vient de l'autre.
    connue: missionId ? Boolean(mission) : null,
    description: t.description || "",
    mouvement: t.id || "",
    origine: idDe(t.source),
    paiement: charge ? idDe(charge.payment_intent) : "",
    disponible_le: dateParis(t.available_on).slice(0, 10),
  };
}

/** Totaux par nature, en euros, au centime. */
export function totauxJournal(lignes) {
  const parNature = new Map();
  for (const l of lignes) {
    const cur = parNature.get(l.nature) || { nature: l.nature, nombre: 0, montant: 0, frais_stripe: 0, net: 0 };
    cur.nombre += 1;
    cur.montant += Math.round(l.montant * 100);
    cur.frais_stripe += Math.round(l.frais_stripe * 100);
    cur.net += Math.round(l.net * 100);
    parNature.set(l.nature, cur);
  }
  return [...parNature.values()]
    .map(t => ({ ...t, montant: t.montant / 100, frais_stripe: t.frais_stripe / 100, net: t.net / 100 }))
    .sort((a, b) => a.nature.localeCompare(b.nature, "fr"));
}
