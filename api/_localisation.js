// ═══════════════════════════════════════════════════════════════════════════
// Le prestataire est-il bien sur place quand il pointe son arrivée ?
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI (29/09/2026)
//
// Le téléphone du prestataire pointait automatiquement à moins de 150 m de
// l'adresse, mais le serveur ne voyait jamais de position : un bouton de
// secours permettait de pointer de n'importe où, et rien ne distinguait les
// deux cas. Question posée par un traiteur, décision d'Alexandre : vérifier,
// sans bloquer.
//
// CE QUI EST GARDÉ
//
// Un constat et une distance, jamais les coordonnées. La position est lue une
// fois, au pointage, puis oubliée. Pas de suivi continu : l'article 10C.3 des
// CGPS exclut tout « dispositif de contrôle des horaires », et un suivi
// ressemblerait au contrôle d'un salarié.
//
// POURQUOI NE PAS BLOQUER
//
// Un GPS en immeuble peut se tromper de plusieurs centaines de mètres. Bloquer
// empêcherait un prestataire honnête de travailler, et le client attendrait
// devant sa porte. Le constat renseigne le client et le back-office ; il ne
// décide de rien.

/** Distance tolérée entre la position relevée et l'adresse, en mètres. */
export const SEUIL_SUR_PLACE_M = 300;

/**
 * Au-delà de cette imprécision annoncée par le téléphone, le relevé ne prouve
 * rien : on ne la retranche que jusqu'à ce plafond. Sans lui, un téléphone
 * qui annonce « 5 km près » serait toujours « sur place ».
 */
export const PRECISION_MAX_M = 500;

/** Les constats possibles — les seuls que la contrainte de la base accepte. */
export const CONSTATS_ARRIVEE = ["sur_place", "eloignee", "position_absente", "adresse_introuvable"];

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Une position lisible, ou null. Tout ce qui vient du navigateur se contrôle. */
export function lirePosition(corps) {
  const lat = Number(corps?.lat);
  const lng = Number(corps?.lng);
  if (corps?.lat == null || corps?.lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const p = Number(corps?.precision);
  return { lat, lng, precision: Number.isFinite(p) && p >= 0 ? p : 0 };
}

/**
 * Le constat d'arrivée.
 *
 * @param {{lat:number,lng:number,precision:number}|null} position  relevé du téléphone
 * @param {{lat:number,lon:number}|null} adresse  coordonnées de l'adresse de la prestation
 * @returns {{ constat: string, distance_m: number|null }}
 */
export function constatArrivee(position, adresse) {
  if (!position) return { constat: "position_absente", distance_m: null };
  if (!adresse || !Number.isFinite(adresse.lat) || !Number.isFinite(adresse.lon)) {
    return { constat: "adresse_introuvable", distance_m: null };
  }
  const brute = distanceM(position.lat, position.lng, adresse.lat, adresse.lon);
  const corrigee = Math.max(0, brute - Math.min(position.precision || 0, PRECISION_MAX_M));
  return {
    constat: corrigee <= SEUIL_SUR_PLACE_M ? "sur_place" : "eloignee",
    distance_m: Math.round(brute),
  };
}

/** La phrase qui accompagne le constat, pour le client et le back-office. */
export function libelleConstat(constat, distanceM) {
  switch (constat) {
    case "sur_place":           return "Position vérifiée : sur place.";
    case "eloignee":            return `Position relevée à ${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1).replace(".", ",")} km` : `${distanceM} m`} de l'adresse.`;
    case "position_absente":    return "Position non transmise par le téléphone du prestataire.";
    case "adresse_introuvable": return "Position non vérifiable : adresse introuvable.";
    default:                    return "";
  }
}
