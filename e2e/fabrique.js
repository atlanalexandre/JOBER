// Fabrique de comptes de recette, par les VRAIES fonctions de l'application.
//
// Les parcours d'écran (inscription, backoffice) sont testés pour eux-mêmes dans
// 02 à 04. Pour tester une réservation, on a besoin d'un prestataire déjà prêt :
// le refaire à la main à chaque scénario prendrait trois minutes et mêlerait les
// échecs. On passe donc par les mêmes points d'entrée que l'écran — l'API d'auth
// Supabase, /api/bo-action, /api/missions — sans jamais écrire directement en base
// ce que l'application sait écrire elle-même.
import { expect, request } from "@playwright/test";
import { RECETTE_REF, RECETTE_URL, BYPASS, sql, emailTest, MOT_DE_PASSE } from "./outils.js";

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const SUPABASE = `https://${RECETTE_REF}.supabase.co`;
let ctx;
let cleAnon;

async function http() {
  if (!ctx) ctx = await request.newContext({ proxy });
  return ctx;
}

/** La clé publique (anon) de la recette, lue sur le code déployé — comme le ferait un navigateur. */
async function anon() {
  if (cleAnon) return cleAnon;
  const c = await http();
  const h = { "x-vercel-protection-bypass": BYPASS };
  const html = await (await c.get(`${RECETTE_URL}/`, { headers: h })).text();
  for (const s of html.match(/\/assets\/[\w.-]+\.js/g) || []) {
    const code = await (await c.get(`${RECETTE_URL}${s}`, { headers: h })).text();
    const m = code.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)?.find((j) => {
      try { return JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString()).role === "anon"; }
      catch { return false; } // un autre jeton du code : on continue la recherche
    });
    if (m) return (cleAnon = m);
  }
  throw new Error("[fabrique] clé anon introuvable dans le code déployé");
}

/** Appel d'une fonction /api de la Preview. */
export async function api(chemin, corps, jeton) {
  const c = await http();
  const res = await c.post(`${RECETTE_URL}${chemin}`, {
    headers: { "x-vercel-protection-bypass": BYPASS, ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    data: corps,
  });
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* réponse non JSON : on garde le texte */ }
  return { statut: res.status(), json, texte };
}

/** Crée un compte comme le fait l'écran d'inscription (même `signUp`, mêmes métadonnées). */
export async function inscrire({ role, prenom, metadonnees = {}, email = emailTest(role) }) {
  const c = await http();
  const res = await c.post(`${SUPABASE}/auth/v1/signup`, {
    headers: { apikey: await anon() },
    data: { email, password: MOT_DE_PASSE, data: { role, prenom, nom: "Recette", ...metadonnees } },
  });
  const j = await res.json();
  expect(res.ok(), `inscription ${role} : ${JSON.stringify(j).slice(0, 200)}`).toBeTruthy();
  return { email, id: j.user?.id, jeton: j.access_token };
}

/** Reconnexion (le jeton d'inscription expire au bout d'une heure). */
export async function jetonDe(email) {
  const c = await http();
  const res = await c.post(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: await anon() },
    data: { email, password: MOT_DE_PASSE },
  });
  const j = await res.json();
  expect(res.ok(), `connexion ${email} : ${JSON.stringify(j).slice(0, 200)}`).toBeTruthy();
  return j.access_token;
}

let jetonBO;
/** Session backoffice, par la même fonction que l'écran de connexion. */
export async function bo(action, champs = {}) {
  if (!jetonBO) {
    const r = await api("/api/bo-verify-pin", { pin: process.env.RECETTE_BO_PASSWORD });
    expect(r.json?.ok, "RECETTE_BO_PASSWORD refusé par la Preview").toBe(true);
    jetonBO = r.json.token;
  }
  return api("/api/bo-action", { action, ...champs }, jetonBO);
}

/**
 * Un prestataire prêt à travailler : inscrit, approuvé, mandats signés, dossier
 * complet, accès aux prestations ouvert. Chaque étape passe par l'application et
 * son résultat est vérifié : si l'une échoue, c'est un défaut à signaler, pas un
 * détail de préparation.
 */
export async function prestataireOperationnel({ metier = "Agent de propreté", secteur = "proprete", tarif = 15 } = {}) {
  const p = await inscrire({
    role: "prestataire", prenom: "Sam",
    metadonnees: {
      telephone: "0698765432", adresse: "5 rue de Lyon", code_postal: "75012", ville: "Paris", zone_km: 50,
      statut_pro: "auto-entrepreneur", siret: null,
      metiers_list: [{ sector: secteur, metier, niveau: "Confirmé", experienceAns: 3, tarifNet: tarif }],
      secteurs: [secteur], metiers: [metier], tarif_net: tarif,
      disponibilites: Object.fromEntries(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"].map((j) => [j, ["matin", "apres_midi", "soir"]])),
    },
  });
  // L'écran complète le profil juste après le signUp (completerProfil).
  await sql(`update profiles set adresse='5 rue de Lyon', code_postal='75012', ville='Paris', rib='FR7630006000011234567890189' where id='${p.id}'`);

  const approbation = await bo("approve", { profileId: p.id });
  expect(approbation.statut, `approbation : ${approbation.texte.slice(0, 200)}`).toBe(200);

  for (const action of ["accepter_mandat_encaissement", "accepter_mandat_facturation"]) {
    const r = await api("/api/missions", { action }, p.jeton);
    expect(r.statut, `${action} : ${r.texte.slice(0, 200)}`).toBe(200);
  }

  const docs = await bo("seed_docs", { profileId: p.id });
  expect(docs.statut, `dossier : ${docs.texte.slice(0, 200)}`).toBe(200);

  const ouverture = await bo("enable_missions", { profileId: p.id });
  p.ouverture = ouverture;
  return p;
}

/** Un client inscrit (validé d'office depuis le 23/09/2026). */
export async function client() {
  return inscrire({
    role: "client", prenom: "Camille",
    metadonnees: { telephone: "0612345678", adresse: "10 rue de Rivoli", code_postal: "75004", ville: "Paris", type_compte: "particulier" },
  });
}
