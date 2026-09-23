/**
 * Lecture de la date d'immatriculation dans la base SIRENE.
 *
 * Pourquoi c'est ici et pas dans `api/verify-docs.js` : ce dernier interroge
 * déjà le même service, mais pour un autre besoin (l'entreprise existe-t-elle,
 * est-elle active) et au moment de l'inscription seulement. Le délai de dépôt
 * de l'attestation URSSAF, lui, se recalcule à chaque balayage. Les deux
 * usages n'ont ni le même appelant ni le même cycle de vie : un module à part
 * évite de faire dépendre le cron d'un handler HTTP.
 *
 * Le service est public, gratuit et sans clé. Il est limité à quelques appels
 * par seconde, d'où l'espacement ci-dessous : un balayage nocturne n'est pas
 * pressé.
 */

const BASE = "https://recherche-entreprises.api.gouv.fr/search";

// Le service annonce 7 requêtes/seconde. On reste largement en dessous :
// rien ne dépend de la vitesse de ce balayage, et se faire limiter
// reviendrait à perdre la date, donc à ne pas suspendre du tout.
const ESPACEMENT_MS = 250;

/** Cache par invocation : un même SIRET n'est interrogé qu'une fois. */
const cache = new Map();

function attendre(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * La date d'immatriculation d'une entreprise, au format AAAA-MM-JJ.
 *
 * Renvoie `null` si le SIRET est absent, illisible, introuvable, ou si le
 * service ne répond pas. L'appelant DOIT traiter `null` comme « date
 * inconnue » et non comme « pas d'immatriculation » : à défaut de savoir, on
 * ne sanctionne pas.
 */
export async function dateImmatriculation(siret) {
  const clean = String(siret || "").replace(/[\s.-]/g, "");
  if (!/^\d{9}$/.test(clean) && !/^\d{14}$/.test(clean)) return null;
  if (cache.has(clean)) return cache.get(clean);

  let date = null;
  try {
    const rep = await fetch(`${BASE}?q=${clean}&page=1&per_page=1`, {
      headers: { Accept: "application/json" },
    });
    if (!rep.ok) {
      console.warn(`[sirene] réponse ${rep.status} pour ${clean} — date d'immatriculation inconnue`);
    } else {
      const data = await rep.json();
      const ent = data.results?.[0];
      const brut = ent?.date_creation || ent?.siege?.date_creation || null;
      // Le service renvoie déjà AAAA-MM-JJ ; on ne garde que ça, et on refuse
      // tout ce qui n'a pas cette forme plutôt que de deviner.
      if (brut && /^\d{4}-\d{2}-\d{2}$/.test(String(brut))) date = String(brut);
      else if (ent) console.warn(`[sirene] pas de date_creation exploitable pour ${clean}`);
    }
  } catch (err) {
    console.warn(`[sirene] échec d'appel pour ${clean} : ${err.message} — date d'immatriculation inconnue`);
  }

  cache.set(clean, date);
  return date;
}

/**
 * La même chose pour une liste de SIRET, en série et espacés.
 * Renvoie une Map SIRET nettoyé → date (ou null).
 */
export async function datesImmatriculation(sirets) {
  const out = new Map();
  const uniques = [...new Set(sirets.filter(Boolean).map(s => String(s).replace(/[\s.-]/g, "")))];
  for (let i = 0; i < uniques.length; i++) {
    if (i > 0 && !cache.has(uniques[i])) await attendre(ESPACEMENT_MS);
    out.set(uniques[i], await dateImmatriculation(uniques[i]));
  }
  return out;
}
