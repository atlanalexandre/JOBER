// Lecture, côté serveur, des justificatifs de qualification — pour savoir quels
// métiers réglementés un prestataire peut réellement exercer (voir
// `peutExercer()` de api/_qualifications.js).
import { peutExercer, qualificationRequise } from "./_qualifications.js";

/**
 * Les justificatifs (`documents` de type diplomes) de plusieurs prestataires.
 *
 * @returns {Promise<Map<string, {verified:boolean, titres_couverts:string[]|null}>|null>}
 *          null si la lecture échoue : l'appelant refuse alors les métiers
 *          réglementés — on ne propose pas un agent de sécurité sans savoir.
 */
export async function justificatifsDe(ids, supabaseUrl, headers) {
  const liste = [...new Set((ids || []).filter(Boolean))];
  const carte = new Map();
  if (liste.length === 0) return carte;
  try {
    // Par lots de 100 identifiants : tous dans un seul `in.(…)`, l'adresse
    // dépassait la longueur admise au-delà de quelques centaines de
    // prestataires, la lecture échouait — et, par prudence, TOUS les métiers
    // réglementés disparaissaient pour tout le monde (relecture du 30/09/2026).
    for (let i = 0; i < liste.length; i += 100) {
      const lot = liste.slice(i, i + 100);
      const r = await fetch(`${supabaseUrl}/rest/v1/documents?type=eq.diplomes`
        + `&prestataire_id=in.(${lot.join(",")})&select=prestataire_id,verified,titres_couverts`, { headers });
      const lignes = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(lignes)) {
        console.error(`[habilitations] justificatifs illisibles (${r.status}) — métiers réglementés refusés.`);
        return null;
      }
      for (const l of lignes) carte.set(l.prestataire_id, l);
    }
    return carte;
  } catch (e) {
    console.error("[habilitations] justificatifs illisibles :", e.message, "— métiers réglementés refusés.");
    return null;
  }
}

/**
 * Ce prestataire peut-il exercer ce métier ? Une lecture seulement si le métier
 * est réglementé — les autres ne coûtent rien.
 */
export async function habilitePour(prestataireId, metier, supabaseUrl, headers) {
  if (!metier || !qualificationRequise(metier)) return true;
  const carte = await justificatifsDe([prestataireId], supabaseUrl, headers);
  if (!carte) return false;
  return peutExercer(metier, carte.get(prestataireId) || null);
}

/** Même question, la carte des justificatifs déjà lue (listes de prestataires). */
export function habiliteDans(carte, prestataireId, metier) {
  if (!metier || !qualificationRequise(metier)) return true;
  if (!carte) return false;
  return peutExercer(metier, carte.get(prestataireId) || null);
}
