// ═══════════════════════════════════════════════════════════════════════════
// Validation des prestataires par vagues (demande d'Alexandre du 20/10/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// À l'ouverture, 179 profils attendent. La méthode (document « Méthode de
// validation des prestataires à l'ouverture ») les traite par vagues de 20 à
// 40, filtrées par zone et secteur, et ne fait passer un dossier à l'étape
// suivante que complet. Ce module dit, pour chaque prestataire :
//   - où en est son dossier de pièces (`etatDossier`) — la liste de travail
//     de la vérification ;
//   - s'il a un SIRET (`aUnSiret`) — sans immatriculation, pas d'exercice en
//     indépendant ;
// et construit, côté serveur, la relance des inscrits sans SIRET : le texte
// n'est jamais fourni par le navigateur (CLAUDE.md §4, « SMS ou e-mail au nom
// d'ALANE »).
// ═══════════════════════════════════════════════════════════════════════════
import { emailHtml } from "./_email.js";

/**
 * L'état du dossier de pièces, d'après `piecesAvantOuverture()` (les pièces
 * obligatoires qui empêchent encore d'ouvrir l'accès).
 *   - "incomplet"  : au moins une pièce n'est pas déposée, ou est expirée ;
 *   - "a_verifier" : tout est déposé, au moins une pièce attend votre contrôle ;
 *   - "pret"       : rien ne manque côté pièces ;
 *   - null         : pièces illisibles — l'écran n'affirme rien.
 */
export function etatDossier(pieces) {
  if (!Array.isArray(pieces)) return null;
  // Expirée : c'est au prestataire d'en déposer une nouvelle, pas à vous de la
  // contrôler (relecture du 21/10/2026).
  if (pieces.some(p => p.raison === "absente" || p.raison === "expirée")) return "incomplet";
  if (pieces.length > 0) return "a_verifier";
  return "pret";
}

/**
 * Le SIRET déclaré : `profiles.siret`, puis `siret` des métadonnées — les
 * mêmes sources que l'empreinte anti-recréation (`ae_siret`, que personne ne
 * renseigne, n'y est pas : il ne doit pas compter ici non plus).
 */
export function siretDeclare(profil, meta) {
  const brut = profil?.siret || meta?.siret || null;
  const s = brut ? String(brut).replace(/\s/g, "") : "";
  return s || null;
}

export const aUnSiret = (profil, meta) => siretDeclare(profil, meta) !== null;

/** Une relance par compte et par période : pas deux e-mails en un mois. */
export const DELAI_ENTRE_RELANCES_SIRET_MS = 30 * 24 * 3600 * 1000;

/**
 * Les prestataires en attente, sans SIRET, pas relancés depuis un mois.
 * `profils` : id, role, status, prenom, siret · `utilisateurs` : { id → { email, meta } }
 * · `relances` : lignes `bo_logs` (target_id, created_at) de l'action `relance_sans_siret`.
 */
export function destinatairesRelanceSiret(profils, utilisateurs, relances, maintenant = Date.now()) {
  const recentes = new Set((relances || [])
    .filter(l => maintenant - Date.parse(l.created_at) < DELAI_ENTRE_RELANCES_SIRET_MS)
    .map(l => l.target_id));
  const liste = [];
  let dejaRelances = 0;
  for (const p of profils || []) {
    if (p.role !== "prestataire" || p.status !== "pending") continue;
    const u = utilisateurs[p.id];
    if (!u?.email || aUnSiret(p, u.meta)) continue;
    if (recentes.has(p.id)) { dejaRelances++; continue; }
    liste.push({ id: p.id, email: u.email, prenom: p.prenom || u.meta?.prenom || "" });
  }
  return { liste, dejaRelances };
}

/**
 * L'e-mail de relance, construit ici et seulement ici. Le même pour tous : il
 * part par lots (`envoyerInformation`), comme les e-mails d'information.
 */
export function emailRelanceSiret() {
  return {
    sujet: "ALANE — il manque votre numéro SIRET",
    html: emailHtml(
      "<p>Bonjour,</p>"
      + "<p>Merci pour votre inscription sur <strong>ALANE</strong>. Pour exercer sur la plateforme, il faut être "
      + "immatriculé comme indépendant (micro-entreprise). Votre inscription ne comporte pas de numéro SIRET : "
      + "sans lui, votre profil ne pourra pas être validé.</p>"
      + "<p><strong>Ce qu'il vous reste à faire :</strong></p>"
      + "<ol><li>Créez votre micro-entreprise, gratuitement, sur le guichet officiel : "
      + "<a href=\"https://procedures.inpi.fr/\">procedures.inpi.fr</a>.</li>"
      + "<li>Dès que vous recevez votre numéro SIRET (14 chiffres), envoyez-le à "
      + "<a href=\"mailto:support@alane.fr\">support@alane.fr</a> : nous l'ajoutons à votre dossier.</li></ol>"
      + "<p>Si vous avez déjà un SIRET, envoyez-le simplement à la même adresse.</p>"
      + "<p style=\"color:#888;font-size:13px;\">L'équipe ALANE</p>",
    ),
  };
}
