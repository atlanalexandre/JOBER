// ═══════════════════════════════════════════════════════════════════════════
// L'offre de lancement : quand elle se déclenche, et jusqu'à quand elle dure
// ═══════════════════════════════════════════════════════════════════════════
//
// CE QUE C'EST
//
// Les 100 premiers prestataires bénéficient du quota Premium — 8 prestations
// par mois au lieu de 2 — sans payer l'abonnement.
//
// D'OÙ ELLE VIENT, ET POURQUOI ELLE A ENCORE BOUGÉ
//
// La place s'est d'abord attribuée à l'INSCRIPTION : un compte refusé la
// gardait, un compte sans documents aussi, et cinquante inscriptions fantômes
// auraient consommé la moitié de l'offre.
//
// Le 24/08/2026, elle est passée à l'OUVERTURE DE L'ACCÈS AUX PRESTATIONS.
// C'était mieux — le dossier est alors complet et vérifié — mais le défaut de
// fond restait : un prestataire validé qui ne travaille jamais consommait une
// place, et l'offre s'épuisait sans avoir produit une seule prestation.
//
// Décision d'Alexandre du 15/09/2026 : elle se déclenche à la PREMIÈRE
// PRESTATION ACCEPTÉE. Seul quelqu'un qui travaille réellement consomme une
// place — c'est le sens même d'une offre de lancement.
//
// COMBIEN DE TEMPS ELLE DURE
//
// Jusqu'à la fin du mois civil du déclenchement, et pas au-delà. Un prestataire
// qui accepte sa première prestation le 3 septembre a ses 8 prestations
// jusqu'au 30 septembre, puis revient à 2.
//
// ⚠️ Effet à connaître, assumé par Alexandre : celui qui accepte sa première
// prestation le 28 n'a que trois jours d'offre, pour la même place consommée
// qu'un autre. La règle est délibérée, elle n'est pas un oubli — ne pas la
// « corriger » sans le lui demander.
//
// LA PLACE, ELLE, RESTE PRISE
//
// Les 100 places sont un plafond cumulatif : une fois déclenchée, la place
// n'est pas rendue à la fin du mois. Cent prestataires en bénéficient, une
// fois chacun. Rendre les places ferait redeviendrait l'offre permanente, ce
// qui n'est pas ce qui est annoncé.
// ═══════════════════════════════════════════════════════════════════════════

/** Nombre de places de l'offre de lancement. */
export const PLACES_OFFRE = 100;

/**
 * Le mois civil d'un horodatage, en heure de PARIS, au format « AAAA-MM ».
 *
 * Vercel tourne en UTC : le 1er octobre à 00 h 30 heure française est encore
 * le 30 septembre en UTC. Comparer des mois sur `toISOString()` prolongerait
 * l'offre de deux heures pour les uns et l'amputerait pour les autres.
 */
export function moisFr(instant) {
  const d = instant ? new Date(instant) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit",
  }).format(d).slice(0, 7);
}

/**
 * L'offre est-elle active pour ce prestataire, en ce moment ?
 *
 * Deux conditions, toutes deux nécessaires : elle a été déclenchée, et on est
 * encore dans le mois civil du déclenchement.
 *
 * Être dans les 100 premiers ne se vérifie pas ici : cela demande un classement
 * en base, que fait `quotaPrestations`.
 */
export function offreActive(offreLancementAt, maintenant = Date.now()) {
  if (!offreLancementAt) return false;
  const mois = moisFr(offreLancementAt);
  return mois !== null && mois === moisFr(maintenant);
}

/**
 * Déclenche l'offre pour ce prestataire, si elle ne l'est pas déjà.
 *
 * Appelée à CHAQUE prestation acceptée, par tous les chemins d'affectation :
 * c'est volontaire. La fonction est idempotente — elle n'écrit que si la
 * colonne est vide — et cela évite d'avoir à se demander, à chaque nouveau
 * chemin d'affectation, s'il faut penser à l'appeler. Un oubli ici priverait
 * quelqu'un de son offre en silence.
 *
 * Elle ne vérifie PAS s'il reste des places : le classement des 100 premiers se
 * fait à la lecture, par horodatage. Quelqu'un qui déclenche en 101ᵉ position
 * porte donc une date sans effet, et c'est sans conséquence — alors qu'un
 * décompte fait ici serait sujet aux courses entre deux acceptations
 * simultanées.
 *
 * Ne lève jamais : une offre non déclenchée ne doit pas faire échouer
 * l'acceptation d'une prestation. Mais elle se journalise.
 *
 * @returns {Promise<boolean>} true si l'offre vient d'être déclenchée
 */
export async function declencherOffreLancement(prestataireId, supabaseUrl, headers) {
  if (!prestataireId) return false;
  try {
    // `offre_lancement_at=is.null` dans le filtre : c'est la base qui garantit
    // qu'on n'écrase pas une date existante, et non une lecture préalable qui
    // laisserait une fenêtre entre le test et l'écriture.
    const r = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${prestataireId}&offre_lancement_at=is.null`,
      {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ offre_lancement_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`[offre] déclenchement refusé pour ${prestataireId} (${r.status}) : ${detail.slice(0, 200)}`
        + " — vérifier que la migration 2026-09-15_offre_lancement_a_la_premiere_prestation.sql est appliquée.");
      return false;
    }
    const lignes = await r.json().catch(() => []);
    const declenchee = Array.isArray(lignes) && lignes.length > 0;
    if (declenchee) {
      console.log(`[offre] déclenchée pour ${prestataireId} — première prestation acceptée`);
    }
    return declenchee;
  } catch (e) {
    console.error(`[offre] déclenchement impossible pour ${prestataireId} :`, e.message);
    return false;
  }
}
