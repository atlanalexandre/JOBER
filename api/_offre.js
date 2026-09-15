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
// Décision d'Alexandre du 15/09/2026, en deux temps :
//
//   • L'ÉLIGIBILITÉ tient à l'ancienneté. Elle est réservée aux 100 premiers
//     prestataires dont l'accès aux prestations a été ouvert, classés par leur
//     DATE D'INSCRIPTION. C'est la promesse faite depuis le début — « les 100
//     premiers inscrits » — et le filtre sur l'accès ouvert la protège des
//     inscriptions fantômes : cent faux comptes créés en une soirée ne peuvent
//     pas fermer l'offre, puisqu'ils ne passeront jamais la validation.
//
//   • LE DÉCLENCHEMENT tient au travail. L'offre ne s'active qu'à la première
//     prestation acceptée. Un prestataire éligible qui ne travaille jamais ne
//     consomme donc rien : il garde son éligibilité tant que son ancienneté le
//     place dans les 100, et l'offre l'attend.
//
// L'ÉLIGIBILITÉ NE S'ÉVALUE QU'UNE FOIS
//
// Au moment du déclenchement, et jamais après. C'est ce qui rend le classement
// stable : ouvrir l'accès à quelqu'un inscrit de longue date le fait entrer
// dans les 100 et en pousse un autre dehors. Si l'on réévaluait à chaque
// lecture, ce dernier perdrait en cours de mois une offre déjà accordée et déjà
// utilisée. Une fois `offre_lancement_at` posée, le mois est acquis.
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
// ET APRÈS ?
//
// À la fin du mois, le prestataire repasse au quota du plan Gratuit — 2
// prestations — SAUF s'il a souscrit un abonnement. C'est automatique et il n'y
// a rien à coder pour cela : `quotaPrestations` rend directement la limite du
// plan dès qu'il n'est plus `free`, sans même consulter l'offre. Un abonné
// Premium ou Elite n'est donc jamais concerné par tout ce qui précède.
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
 * Ce prestataire fait-il partie des 100 premiers inscrits dont l'accès aux
 * prestations est ouvert ?
 *
 * Le filtre porte sur l'accès ouvert, le tri sur la date d'INSCRIPTION. Les
 * deux comptent : l'ancienneté est ce qui a été promis, l'accès ouvert est ce
 * qui empêche des inscriptions fantômes de consommer l'offre.
 *
 * En cas de doute — lecture impossible, migration non passée —, renvoie `false`
 * plutôt que `true` : accorder l'offre à tort est une promesse qu'il faudra
 * retirer, ce qui est pire que de ne pas l'accorder.
 */
export async function estEligible(prestataireId, supabaseUrl, headers) {
  if (!prestataireId) return false;
  const r = await fetch(
    `${supabaseUrl}/rest/v1/profiles?role=eq.prestataire&missions_enabled=is.true`
    + `&select=id&order=created_at.asc&limit=${PLACES_OFFRE}`,
    { headers }
  );
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error(`[offre] classement d'éligibilité illisible (${r.status}) : ${detail.slice(0, 200)}`);
    return false;
  }
  const lignes = await r.json().catch(() => null);
  if (!Array.isArray(lignes)) {
    console.error("[offre] classement d'éligibilité illisible : réponse inattendue");
    return false;
  }
  return lignes.some(p => p.id === prestataireId);
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
 * L'éligibilité est vérifiée ICI, et une seule fois dans la vie du compte :
 * quelqu'un qui n'est pas dans les 100 premiers inscrits ne reçoit pas de date,
 * et le quota ne consulte donc plus le classement à chaque lecture. C'est ce
 * qui rend l'offre stable une fois accordée.
 *
 * Ne lève jamais : une offre non déclenchée ne doit pas faire échouer
 * l'acceptation d'une prestation. Mais elle se journalise.
 *
 * @returns {Promise<boolean>} true si l'offre vient d'être déclenchée
 */
export async function declencherOffreLancement(prestataireId, supabaseUrl, headers) {
  if (!prestataireId) return false;
  try {
    // L'ancienneté d'abord : inutile d'écrire une date à quelqu'un qui n'y a
    // pas droit. Et on ne la vérifie qu'ici, jamais à la lecture.
    if (!(await estEligible(prestataireId, supabaseUrl, headers))) {
      console.log(`[offre] ${prestataireId} hors des ${PLACES_OFFRE} premiers inscrits — offre non déclenchée`);
      return false;
    }

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
