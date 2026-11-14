// ═══════════════════════════════════════════════════════════════════════════
// Le SIRET déclaré par le prestataire lui-même (13/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Il ne se saisissait qu'à l'inscription : 91 inscrits sans SIRET devaient
// l'envoyer par e-mail, et l'équipe le recopier à la main. Le prestataire le
// déclare désormais dans son espace — UNE fois, quand il n'en a pas encore.
//
// Pourquoi une seule fois : remplacer un SIRET par celui d'une entreprise toute
// neuve repoussait l'échéance de l'attestation URSSAF (comptée depuis
// l'immatriculation lue dans SIRENE), autant de fois que voulu — d'où la
// colonne fermée au navigateur le 14/10/2026 (migration
// secu_profils_siret_non_modifiable). Un premier SIRET ne repousse rien ; un
// changement passe par le support, qui vérifie.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format et clé de contrôle d'un SIRET (14 chiffres). Algorithme de Luhn, sauf
 * pour les établissements de La Poste (SIREN 356000000), dont la somme des
 * chiffres est un multiple de 5 (l'un ou l'autre suffit).
 * @returns {{ok:true, siret:string} | {ok:false, erreur:string}}
 */
export function validerSiret(saisie) {
  const s = String(saisie ?? "").replace(/[\s.-]/g, "");
  if (!/^\d{14}$/.test(s)) return { ok: false, erreur: "Le SIRET compte 14 chiffres." };
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let c = Number(s[i]);
    if (i % 2 === 0) { c *= 2; if (c > 9) c -= 9; }
    somme += c;
  }
  const laPoste = s.startsWith("356000000") && [...s].reduce((t, c) => t + Number(c), 0) % 5 === 0;
  return somme % 10 === 0 || laPoste ? { ok: true, siret: s } : { ok: false, erreur: "Ce numéro SIRET n'est pas valide : vérifiez les 14 chiffres." };
}
