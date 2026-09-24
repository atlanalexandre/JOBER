// Fabrique de comptes de recette, par les VRAIES fonctions de l'application.
//
// Les parcours d'écran (inscription, backoffice) sont testés pour eux-mêmes dans
// 02 à 04. Pour tester une réservation, on a besoin d'un prestataire déjà prêt :
// le refaire à la main à chaque scénario prendrait trois minutes et mêlerait les
// échecs. On passe donc par les mêmes points d'entrée que l'écran — l'API d'auth
// Supabase, /api/bo-action, /api/missions — sans jamais écrire directement en base
// ce que l'application sait écrire elle-même.
import { expect, request } from "@playwright/test";
import { RECETTE_REF, RECETTE_URL, BYPASS, sql, emailTest, MOT_DE_PASSE, avecReprise } from "./outils.js";
import { calculerFrais } from "../api/_montant.js";

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const SUPABASE = `https://${RECETTE_REF}.supabase.co`;
let ctx;
let cleAnon;

async function http() {
  if (!ctx) ctx = await request.newContext({ proxy });
  return ctx;
}

/** La clé publique (anon) de la recette, lue sur le code déployé — comme le ferait un navigateur. */
export async function anon() {
  if (cleAnon) return cleAnon;
  const c = await http();
  const h = { "x-vercel-protection-bypass": BYPASS };
  const html = await avecReprise(async () => (await c.get(`${RECETTE_URL}/`, { headers: h })).text(), "page d'accueil");
  for (const s of html.match(/\/assets\/[\w.-]+\.js/g) || []) {
    const code = await avecReprise(async () => (await c.get(`${RECETTE_URL}${s}`, { headers: h })).text(), s);
    const m = code.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)?.find((j) => {
      try { return JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString()).role === "anon"; }
      catch { return false; } // un autre jeton du code : on continue la recherche
    });
    if (m) return (cleAnon = m);
  }
  throw new Error("[fabrique] clé anon introuvable dans le code déployé");
}

let clePublique;
/** La clé publiable Stripe de la Preview, lue sur le code déployé. */
async function pkStripe() {
  if (clePublique) return clePublique;
  const c = await http();
  const h = { "x-vercel-protection-bypass": BYPASS };
  const html = await avecReprise(async () => (await c.get(`${RECETTE_URL}/`, { headers: h })).text(), "accueil");
  for (const s of html.match(/\/assets\/[\w.-]+\.js/g) || []) {
    const code = await avecReprise(async () => (await c.get(`${RECETTE_URL}${s}`, { headers: h })).text(), s);
    const m = code.match(/pk_test_[A-Za-z0-9]+/);
    if (m) return (clePublique = m[0]);
  }
  throw new Error("[fabrique] clé publiable Stripe introuvable dans le code déployé");
}

/**
 * Paie une prestation exactement comme l'écran de paiement, sans afficher le
 * formulaire de carte (bloqué par le filtre réseau de l'environnement de test) :
 *   1. /api/stripe-intent crée le paiement, montant revérifié par le serveur ;
 *   2. Stripe le confirme avec une carte de test, par la clé PUBLIABLE — ce que
 *      fait stripe.js dans le navigateur ;
 *   3. /api/missions « assign_after_payment », comme App.jsx après un succès.
 */
export async function payerPrestation({ jetonClient, missionId, montant, prestataireId, carte = "pm_card_visa", delaiMinutes = 240 }) {
  const intent = await api("/api/stripe-intent",
    { amount: montant, currency: "eur", mission_id: missionId, metadata: { prestataire: prestataireId } }, jetonClient);
  if (!intent.json?.clientSecret) return { etape: "creation du paiement", statut: intent.statut, detail: intent.texte.slice(0, 300) };

  const secret = intent.json.clientSecret;
  const pi = secret.split("_secret_")[0];
  const c = await http();
  const pk = await pkStripe();
  const conf = await avecReprise(() => c.post(`https://api.stripe.com/v1/payment_intents/${pi}/confirm`, {
    headers: { Authorization: `Bearer ${pk}` },
    form: { client_secret: secret, payment_method: carte, return_url: `${RECETTE_URL}/dashboard` },
  }), "confirmation Stripe");
  const pj = await conf.json();
  if (pj.status !== "succeeded" && pj.status !== "requires_capture") {
    return { etape: "confirmation Stripe", statut: conf.status(), detail: JSON.stringify(pj.error || pj.status).slice(0, 300), paymentIntent: pi };
  }

  const affectation = await api("/api/missions", {
    action: "assign_after_payment", mission_id: missionId, prestataire_id: prestataireId,
    acceptance_deadline: new Date(Date.now() + delaiMinutes * 60000).toISOString(),
    stripe_payment_intent: pi, retractation_renoncee: true,
  }, jetonClient);
  return { etape: affectation.statut === 200 ? "ok" : "affectation", statut: affectation.statut, detail: affectation.texte.slice(0, 300),
    paymentIntent: pi, statutStripe: pj.status, centimesPreleves: pj.amount };
}

/** Appel d'une fonction /api de la Preview. */
export async function api(chemin, corps, jeton) {
  const c = await http();
  const res = await avecReprise(() => c.post(`${RECETTE_URL}${chemin}`, {
    headers: { "x-vercel-protection-bypass": BYPASS, ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    data: corps,
  }), chemin);
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* réponse non JSON : on garde le texte */ }
  return { statut: res.status(), json, texte };
}

/** Crée un compte comme le fait l'écran d'inscription (même `signUp`, mêmes métadonnées). */
export async function inscrire({ role, prenom, metadonnees = {}, email = emailTest(role) }) {
  const c = await http();
  const res = await avecReprise(async () => c.post(`${SUPABASE}/auth/v1/signup`, {
    headers: { apikey: await anon() },
    data: { email, password: MOT_DE_PASSE, data: { role, prenom, nom: "Recette", ...metadonnees } },
  }), "inscription");
  const j = await res.json();
  expect(res.ok(), `inscription ${role} : ${JSON.stringify(j).slice(0, 200)}`).toBeTruthy();
  return { email, id: j.user?.id, jeton: j.access_token };
}

/** Reconnexion (le jeton d'inscription expire au bout d'une heure). */
export async function jetonDe(email) {
  const c = await http();
  const cle = await anon();
  const res = await avecReprise(() => c.post(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: cle },
    data: { email, password: MOT_DE_PASSE },
  }), "connexion");
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
export async function prestataireOperationnel({ metier = "Femme/Valet de chambre", secteur = "hotellerie", tarif = 13 } = {}) {
  // Hôtellerie : c'est le seul secteur ouvert aux clients tant qu'un secteur n'a pas
  // 20 prestataires (réglages `forced_open_sectors` et `sector_min_prestataires`).
  const metiers = [{ sector: secteur, metier, niveau: "Confirmé", experienceAns: 3, tarifNet: tarif, certifs: "" }];
  const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const creneaux = Object.fromEntries(jours.map((j) => [j, ["Matin (6h-13h)", "Après-midi (13h-20h)", "Soir/Nuit (20h-6h)"]]));
  const p = await inscrire({
    role: "prestataire", prenom: "Sam",
    // Mêmes clés que le signUp de l'écran d'inscription (auth.jsx).
    metadonnees: {
      telephone: "0698765432", date_naissance: "1990-05-15",
      adresse: "5 rue de Lyon", code_postal: "75012", ville: "Paris", zone_km: 50,
      secteur, metier, tarif_net: tarif, metiers_list: metiers,
      niveau: "Confirmé", experience_ans: 3, competences: [], langues: ["Français"],
      dispon_jours: jours, dispon_jours_creneaux: creneaux, dispo_immediat: true,
      statut_pro: "auto-entrepreneur", siret: null,
      plan_souhaite: "free", plan_abonnement: "free",
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

/**
 * Déclenche une tâche planifiée de la Preview, comme le fait Vercel en production
 * (Vercel ne lance pas les tâches planifiées sur les Preview). Secret : RECETTE_CRON_SECRET.
 */
export async function tachePlanifiee(chemin = "/api/cron-reset-monthly?action=reminders") {
  const secret = (process.env.RECETTE_CRON_SECRET || "").replace(/\s/g, "");
  if (!secret) throw new Error("RECETTE_CRON_SECRET absent : impossible de déclencher les tâches planifiées de la recette.");
  const c = await http();
  const res = await avecReprise(() => c.get(`${RECETTE_URL}${chemin}`, {
    headers: { "x-vercel-protection-bypass": BYPASS, Authorization: `Bearer ${secret}` },
    timeout: 120_000,
  }), chemin);
  const texte = await res.text();
  return { statut: res.status(), texte };
}

/**
 * Une réservation PAYÉE et affectée, par les mêmes points d'entrée que l'écran :
 *   1. insertion de la prestation avec le jeton du client (ce que fait App.jsx —
 *      la RLS et le verrou de création s'appliquent donc comme en vrai) ;
 *   2. paiement par carte de test, puis affectation (payerPrestation).
 * Le tunnel d'écran lui-même est éprouvé par 06 : le rejouer ici ajouterait une
 * minute et des échecs sans rapport à chaque scénario.
 *
 * `dansJours` et `heure` fixent le début de la prestation, en heure de Paris.
 */
export async function reservationPayee({ prestataire, client: c, dansJours = 5, heure = "09:00", debutMs = null, heures = 8, tarif = 13 }) {
  const id = crypto.randomUUID();
  // `debutMs` (instant précis) l'emporte sur `dansJours` + `heure` : utile pour
  // une prestation qui commence dans quelques heures.
  const paris = { timeZone: "Europe/Paris" };
  const date = new Date(debutMs ?? Date.now() + dansJours * 864e5).toLocaleDateString("fr-CA", paris);
  if (debutMs) heure = new Date(debutMs).toLocaleTimeString("fr-FR", { ...paris, hour: "2-digit", minute: "2-digit" });
  const [reglage] = await sql("select value from platform_settings where key = 'frais_service'");
  const montant = Math.round((tarif * heures + calculerFrais("single", tarif * heures, 1, reglage?.value)) * 100) / 100;

  const h = await http();
  const ins = await avecReprise(async () => h.post(`${SUPABASE}/rest/v1/missions`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${c.jeton}`, Prefer: "return=minimal" },
    data: {
      id, client_id: c.id, prestataire_id: null,
      sector: "hotellerie", metier: "Femme/Valet de chambre",
      date, hours: heures, heure_debut: heure, tarif_horaire: tarif, montant_total: montant,
      description: "Scénario de recette", adresse: "10 rue de Rivoli", ville: "Paris",
      status: "pending_acceptance",
    },
  }), "création de la prestation");
  expect(ins.ok(), `création de la prestation : ${ins.status()} ${(await ins.text()).slice(0, 200)}`).toBeTruthy();

  const r = await payerPrestation({ jetonClient: c.jeton, missionId: id, montant, prestataireId: prestataire.id });
  expect(r.etape, `paiement et affectation : ${JSON.stringify(r)}`).toBe("ok");
  return { id, date, montant, paymentIntent: r.paymentIntent };
}

/**
 * Le paiement tel que Stripe le voit — seule preuve qu'un remboursement a eu lieu.
 * Clé : STRIPE_SECRET_KEY (clé restreinte de la recette, lecture seule ici).
 */
export async function paiementStripe(pi) {
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) throw new Error("STRIPE_SECRET_KEY absente : impossible de lire le paiement chez Stripe.");
  const h = await http();
  const r = await avecReprise(() => h.get(`https://api.stripe.com/v1/payment_intents/${pi}?expand[]=latest_charge`,
    { headers: { Authorization: `Bearer ${cle}` } }), "lecture Stripe");
  const p = await r.json();
  return { statut: p.status, preleve: p.amount_received, rembourse: p.latest_charge?.amount_refunded || 0 };
}

/**
 * Crée une prestation DIRECTEMENT, avec le jeton du client et la clé publique —
 * exactement ce que peut faire n'importe qui depuis la console de son navigateur.
 * Sert à vérifier ce que la base refuse, indépendamment de l'écran.
 */
export async function creerPrestationBrute(c, champs = {}) {
  const h = await http();
  const r = await avecReprise(async () => h.post(`${SUPABASE}/rest/v1/missions`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${c.jeton}`, Prefer: "return=minimal" },
    data: {
      id: crypto.randomUUID(), client_id: c.id, sector: "hotellerie", metier: "Femme/Valet de chambre",
      date: new Date(Date.now() + 5 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }),
      hours: 8, heure_debut: "09:00", tarif_horaire: 13, montant_total: 110.98,
      adresse: "10 rue de Rivoli", ville: "Paris", status: "pending_acceptance", ...champs,
    },
  }), "création brute");
  return { statut: r.status(), texte: (await r.text()).slice(0, 200) };
}
