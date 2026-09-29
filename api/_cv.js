// ═══════════════════════════════════════════════════════════════════════════
// Le CV du prestataire : obligatoire, et confronté aux métiers déclarés
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI (29/09/2026)
//
// Le CV était facultatif : le client ne voyait un « Parcours » que si le
// prestataire avait pris la peine de le remplir. Décision d'Alexandre : le
// rendre obligatoire, et avertir quand aucune expérience ne correspond à un
// métier pour lequel le prestataire s'est inscrit.
//
// OÙ IL VIT
//
// `profiles.cv`, et non plus `user_metadata.cv`. Ce dernier est encodé dans le
// jeton de connexion, envoyé à chaque requête et plafonné à 16 Ko par
// Cloudflare (CLAUDE.md, règle 1.1). Un CV devenu obligatoire, avec ses
// descriptions libres, n'a rien à y faire.
//
// CE QUE L'AVERTISSEMENT EST, ET N'EST PAS
//
// Un rapprochement de mots entre le libellé du métier et les postes déclarés.
// Il renseigne celui qui valide le compte et le prestataire lui-même ; il ne
// bloque rien et n'est jamais montré au client. Un débutant peut être sérieux :
// l'absence d'expérience se regarde, elle ne disqualifie pas.

/** Longueurs maximales — un CV reste une fiche, pas un roman. */
export const CV_LIMITES = { titre: 80, accroche: 400, poste: 80, entreprise: 80, periode: 30, desc: 300, diplome: 100, etablissement: 80, annee: 10, permis: 80, experiences: 8, formations: 6 };

const texte = (v, max) => String(v ?? "").slice(0, max);

/** Le CV tel qu'on l'enregistre : listes normalisées, longueurs bornées, lignes vides retirées. */
export function nettoyerCv(cv) {
  const c = cv && typeof cv === "object" ? cv : {};
  const exps = (Array.isArray(c.experiences) ? c.experiences : [])
    .map(e => ({ poste: texte(e?.poste, CV_LIMITES.poste).trim(), entreprise: texte(e?.entreprise, CV_LIMITES.entreprise).trim(),
                 periode: texte(e?.periode, CV_LIMITES.periode).trim(), desc: texte(e?.desc, CV_LIMITES.desc).trim() }))
    .filter(e => e.poste || e.entreprise || e.desc)
    .slice(0, CV_LIMITES.experiences);
  const forms = (Array.isArray(c.formations) ? c.formations : [])
    .map(f => ({ diplome: texte(f?.diplome, CV_LIMITES.diplome).trim(), etablissement: texte(f?.etablissement, CV_LIMITES.etablissement).trim(),
                 annee: texte(f?.annee, CV_LIMITES.annee).trim() }))
    .filter(f => f.diplome || f.etablissement)
    .slice(0, CV_LIMITES.formations);
  return {
    titre: texte(c.titre, CV_LIMITES.titre).trim(),
    accroche: texte(c.accroche, CV_LIMITES.accroche).trim(),
    experiences: exps,
    formations: forms,
    permis: texte(c.permis, CV_LIMITES.permis).trim(),
  };
}

/**
 * Ce qui manque pour que le CV compte comme rempli. Tableau vide = rempli.
 *
 * Exigé : un titre, une accroche, et au moins une expérience OU une formation.
 * Pas forcément une expérience : un débutant a un parcours, pas un passé
 * professionnel — l'avertissement ci-dessous le signale sans l'exclure.
 */
export function manquesCv(cv) {
  const c = nettoyerCv(cv);
  const manques = [];
  if (!c.titre) manques.push("un titre professionnel");
  if (c.accroche.length < 20) manques.push("une accroche de quelques mots");
  if (!c.experiences.some(e => e.poste) && !c.formations.some(f => f.diplome)) manques.push("au moins une expérience ou une formation");
  return manques;
}

export const cvRempli = (cv) => manquesCv(cv).length === 0;

// ── Rapprochement métier ↔ expériences ─────────────────────────────────────

function normaliser(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

// Mots trop génériques pour prouver quoi que ce soit : « agent » se retrouve
// dans « agent de sécurité » comme dans « agent immobilier ».
const MOTS_VIDES = new Set(["agent", "agente", "employe", "employee", "aide", "chef", "commis", "assistant", "assistante",
  "de", "des", "du", "la", "le", "les", "en", "et", "au", "aux", "a", "d", "l", "domicile", "gms", "magasin", "service", "services"]);

/**
 * Racine grossière, quatre lettres : « livreuse », « livraison » et
 * « livreur » se retrouvent, « serveuse » et « serveur » aussi. Elle
 * rapproche parfois trop (« service » et « serveur ») : c'est un
 * avertissement, pas un jugement, et mieux vaut se taire à tort que crier à
 * tort — un avertissement qui sonne pour rien finit ignoré.
 */
const racine = (m) => m.slice(0, 4);

function motsDuMetier(libelle) {
  return normaliser(libelle).split(" ").filter(m => m.length >= 4 && !MOTS_VIDES.has(m)).map(racine);
}

/**
 * Les métiers déclarés dont aucune expérience du CV ne porte trace.
 *
 * @param {object} cv
 * @param {Array<string|{metier:string}>} metiers  `metiers_list` ou libellés
 * @returns {string[]} libellés sans expérience correspondante
 */
export function metiersSansExperience(cv, metiers) {
  const c = nettoyerCv(cv);
  const corpus = c.experiences.map(e => normaliser(`${e.poste} ${e.desc}`)).join(" ");
  const motsCorpus = new Set(corpus.split(" ").filter(Boolean).map(racine));
  const libelles = [...new Set((Array.isArray(metiers) ? metiers : [])
    .map(m => (typeof m === "string" ? m : m?.metier)).filter(Boolean))];
  return libelles.filter(l => {
    const mots = motsDuMetier(l);
    if (mots.length === 0) return false; // libellé sans mot distinctif : on ne conclut rien
    return !mots.some(m => motsCorpus.has(m));
  });
}
