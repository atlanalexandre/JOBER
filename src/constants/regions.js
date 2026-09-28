// Régions françaises, à partir du code postal — pour trier les comptes du
// back-office par zone (demande d'Alexandre du 28/09/2026 : « Île-de-France
// avec Paris et les banlieues »). Le filtre par ville seul obligeait à cocher
// une à une Paris, Montreuil, Boulogne-Billancourt, Saint-Denis…
//
// Le département vient des deux premiers chiffres du code postal (trois pour
// l'outre-mer). Faute de code postal, quelques grandes villes sont reconnues
// par leur nom ; sinon la région est « non renseignée » — jamais devinée.
import { cleVille } from "./data.js";

export const REGIONS = {
  idf:  { libelle: "Île-de-France",              deps: ["75", "77", "78", "91", "92", "93", "94", "95"] },
  ara:  { libelle: "Auvergne-Rhône-Alpes",       deps: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"] },
  bfc:  { libelle: "Bourgogne-Franche-Comté",    deps: ["21", "25", "39", "58", "70", "71", "89", "90"] },
  bre:  { libelle: "Bretagne",                   deps: ["22", "29", "35", "56"] },
  cvl:  { libelle: "Centre-Val de Loire",        deps: ["18", "28", "36", "37", "41", "45"] },
  cor:  { libelle: "Corse",                      deps: ["20"] },
  ges:  { libelle: "Grand Est",                  deps: ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"] },
  hdf:  { libelle: "Hauts-de-France",            deps: ["02", "59", "60", "62", "80"] },
  nor:  { libelle: "Normandie",                  deps: ["14", "27", "50", "61", "76"] },
  naq:  { libelle: "Nouvelle-Aquitaine",         deps: ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"] },
  occ:  { libelle: "Occitanie",                  deps: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] },
  pdl:  { libelle: "Pays de la Loire",           deps: ["44", "49", "53", "72", "85"] },
  pac:  { libelle: "Provence-Alpes-Côte d'Azur", deps: ["04", "05", "06", "13", "83", "84"] },
  om:   { libelle: "Outre-mer",                  deps: ["971", "972", "973", "974", "975", "976", "977", "978", "986", "987", "988"] },
};

const DEP_VERS_REGION = Object.fromEntries(
  Object.entries(REGIONS).flatMap(([id, r]) => r.deps.map(d => [d, id]))
);

// Grandes villes reconnues sans code postal (préfecture de région et plus
// grandes communes d'Île-de-France). Liste courte, volontairement : au-delà,
// il faut le code postal.
const VILLES = {
  paris: "idf", boulogne: "idf", "boulogne-billancourt": "idf", montreuil: "idf", "saint-denis": "idf",
  argenteuil: "idf", versailles: "idf", nanterre: "idf", creteil: "idf", vitry: "idf", "vitry-sur-seine": "idf",
  marseille: "pac", nice: "pac", toulon: "pac", lyon: "ara", grenoble: "ara", toulouse: "occ", montpellier: "occ",
  bordeaux: "naq", nantes: "pdl", strasbourg: "ges", lille: "hdf", rennes: "bre", rouen: "nor", dijon: "bfc",
  orleans: "cvl", ajaccio: "cor",
};

/** Identifiant de région (clé de REGIONS) d'un compte, ou null s'il est impossible à établir. */
export function regionDe({ code_postal, cp, ville } = {}) {
  const code = String(code_postal || cp || "").replace(/\s/g, "");
  if (/^\d{5}$/.test(code)) {
    const outreMer = DEP_VERS_REGION[code.slice(0, 3)];
    if (code.startsWith("97") || code.startsWith("98")) return outreMer || null;
    return DEP_VERS_REGION[code.slice(0, 2)] || null;
  }
  const v = cleVille(ville || "");
  if (!v) return null;
  // « Paris 15e », « Lyon 3ème », « Marseille 8 » : le premier mot suffit.
  const premier = v.split(/[\s,]+/)[0];
  return VILLES[v] || VILLES[premier] || null;
}
