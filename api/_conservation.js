// ═══════════════════════════════════════════════════════════════════════════
// Durées de conservation des documents — CGPS art. 14.4 et 19.1
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Les règles de conservation sont des durées, et une durée mal écrite se
// remarque des mois plus tard — soit on a gardé des pièces d'identité qu'on
// avait promis de supprimer, soit on a supprimé trop tôt un document dont on
// avait besoin. Elles vivent donc ici, seules, vérifiables sans base ni réseau.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pièces relevant de la purge de l'article 14.4.
 *
 * L'article nomme « CNI, Kbis ». Le justificatif de domicile est de même
 * nature — une donnée personnelle qui n'a plus d'objet une fois le compte
 * vérifié — et le garder alors qu'on supprime la CNI n'aurait aucun sens.
 *
 * Ne sont PAS purgés : le RIB (nécessaire aux versements), l'attestation RC Pro
 * et l'URSSAF (leur validité doit pouvoir être justifiée à tout moment), la
 * photo de profil (affichée), les diplômes et la TVA (rattachés à la
 * qualification, pas à l'identité).
 */
export const TYPES_A_PURGER = ["cni", "kbis", "domicile"];

/** Délai après vérification, avant suppression de la pièce. */
export const DELAI_APRES_VERIFICATION_JOURS = 30;

/** Plafond absolu depuis le dépôt, vérification ou non. */
export const PLAFOND_DEPUIS_DEPOT_MOIS = 12;

/** Préavis avant expiration d'une attestation RC Pro (art. 19.1). */
export const PREAVIS_RC_PRO_JOURS = 30;

/** Délai après expiration au terme duquel le compte peut être suspendu. */
export const TOLERANCE_RC_PRO_JOURS = 30;

const JOUR_MS = 86400000;

/**
 * Un document doit-il être purgé maintenant ?
 *
 * Deux causes indépendantes, comme les écrit l'article : « supprimés après
 * vérification du compte OU au plus tard 12 mois après leur dépôt ». La
 * seconde ne dépend pas de la première — une pièce jamais vérifiée, donc
 * jamais utile, part elle aussi au bout de douze mois.
 *
 * @returns {{ purger:boolean, cause?:"verification"|"plafond" }}
 */
export function aPurger(doc, nowMs = Date.now()) {
  if (!doc || doc.purged_at) return { purger: false };
  if (!TYPES_A_PURGER.includes(doc.type)) return { purger: false };

  const depotMs = doc.created_at ? new Date(doc.created_at).getTime() : NaN;
  if (Number.isFinite(depotMs)) {
    // Douze mois comptés en mois calendaires, pas en 365 jours : « douze mois
    // après le dépôt » du 29 février tombe le 28 février suivant, pas le 1er mars.
    const plafond = new Date(depotMs);
    plafond.setMonth(plafond.getMonth() + PLAFOND_DEPUIS_DEPOT_MOIS);
    if (nowMs >= plafond.getTime()) return { purger: true, cause: "plafond" };
  }

  if (doc.verified && doc.verified_at) {
    const verifMs = new Date(doc.verified_at).getTime();
    if (Number.isFinite(verifMs) && nowMs >= verifMs + DELAI_APRES_VERIFICATION_JOURS * JOUR_MS) {
      return { purger: true, cause: "verification" };
    }
  }

  return { purger: false };
}

/**
 * État d'une attestation RC Pro au regard de l'article 19.1.
 *
 * @returns {"valide"|"bientot_expiree"|"expiree"|"suspendable"|"inconnue"}
 */
export function etatRcPro(expiresAt, nowMs = Date.now()) {
  if (!expiresAt) return "inconnue";
  // Une date sans heure est lue à minuit UTC ; l'attestation vaut pour toute
  // sa dernière journée, on compte donc à partir de la fin de celle-ci.
  const finMs = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59Z`).getTime();
  if (!Number.isFinite(finMs)) return "inconnue";

  if (nowMs > finMs + TOLERANCE_RC_PRO_JOURS * JOUR_MS) return "suspendable";
  if (nowMs > finMs) return "expiree";
  if (nowMs > finMs - PREAVIS_RC_PRO_JOURS * JOUR_MS) return "bientot_expiree";
  return "valide";
}
