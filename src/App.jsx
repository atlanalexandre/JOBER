import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase.js";

// ── Responsive hook ───────────────────────────────────────────────
const useResponsive = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return { isMobile, isDesktop: !isMobile };
};

// ── Design System — Premium Dark ─────────────────────────────────
const C = {
  // Backgrounds
  bg:        "#0A1628",       // noir profond
  bgCard:    "#0D1B3E",       // carte dark
  bgCardAlt: "#112240",       // carte alt
  bgSurface: "#162547",       // surface élevée

  // Brand
  violet:    "#7C6FE0",       // violet principal
  violetLight:"#A29BFE",      // violet clair
  violetDark: "#5B4FCF",      // violet foncé
  violetGlow: "rgba(123,111,240,0.15)",
  violetGlowStrong: "rgba(123,111,240,0.28)",

  // Accents
  accent:    "#F25E5E",       // rouge urgence
  accentGold:"#F0B429",       // or premium
  success:   "#10D98F",       // vert succès
  warning:   "#F0B429",
  danger:    "#F25E5E",

  // Texte
  white:     "#FFFFFF",
  text:      "#F0F0F5",       // texte principal
  textSub:   "#8B8FA8",       // texte secondaire
  textMuted: "#4A4E6A",       // texte discret

  // Bordures
  border:    "rgba(255,255,255,0.10)",
  borderHover:"rgba(123,111,240,0.35)",
  borderStrong:"rgba(255,255,255,0.18)",

  // Legacy compat
  navy:      "#0A1628",
  navyMid:   "#0D1B3E",
  indigo:    "#162547",
  offWhite:  "#F0F0F5",
  grayLight: "rgba(255,255,255,0.06)",
  gray:      "#8B8FA8",
  textLight: "#8B8FA8",
};

// Typography helpers
const font = {
  display: "’Playfair Display’, Georgia, serif",
  body:    "’DM Sans’, system-ui, sans-serif",
};

// Spacing — 1 système cohérent
const r = 16; // border-radius unique

// Shadow system
const shadow = {
  sm:  "0 2px 8px rgba(0,0,0,0.4)",
  md:  "0 4px 20px rgba(0,0,0,0.5)",
  lg:  "0 8px 40px rgba(0,0,0,0.6)",
  glow:"0 0 30px rgba(123,111,240,0.25)",
  glowStrong:"0 0 50px rgba(123,111,240,0.4)",
};

// ── Modèle dual M1 ↔ Hybride ─────────────────────────────────────
const MODEL_CONFIG = {
  get currentModel() {
    try { return localStorage.getItem("jober_model") || "launch"; } catch { return "launch"; }
  },
  set currentModel(v) {
    try { localStorage.setItem("jober_model", v); } catch {}
  },
};
const isLaunchPhase = () => MODEL_CONFIG.currentModel === "launch";

const MARGES = { proprete:0.20, logistique:0.18, hotellerie:0.20, btp:0.15, restauration:0.25, commercial:0.22, distribution:0.18, divers:0.20 };
const FRAIS_MER = { single:4.90, range:2.90, urgent:9.90 };
const ABONNEMENTS_PRESTA = [
  { id:"free",    label:"Gratuit", price:0,  color:"#8B8FA8", icon:"🆓", missions:2,   popular:false, features:["2 missions/mois","Profil visible"],         locked:["Missions illimitées","Badge Vérifié","Missions urgentes"] },
  { id:"premium", label:"Premium", price:29, color:"#7C6FE0", icon:"⚡", missions:999, popular:true,  features:["Missions illimitées","Badge Vérifié","Urgences"], locked:["Manager dédié"] },
  { id:"elite",   label:"Elite",   price:59, color:"#F0B429", icon:"👑", missions:999, popular:false, features:["Missions illimitées","Badge Elite","Position #1","Manager dédié"], locked:[] },
];
const prixClient = (tarifNet, sector) =>
  isLaunchPhase()
    ? Math.round(tarifNet * (1 + (MARGES[sector]||0.20)) * 100) / 100
    : tarifNet;
const tarifInterim = (t) => Math.round(t*2.2*100)/100;
const economiePct  = (t) => Math.round(((tarifInterim(t)-t)/tarifInterim(t))*100);

const formatE = (v) => v.toFixed(2).replace(".", ",") + " €/h";

const SECTORS = [
  { id:"proprete",     label:"Propreté",        icon:"🧹", color:"#4FC3F7", bg:"#E3F7FF", count:12, banner:"🏢", marge:0.20 },
  { id:"logistique",   label:"Logistique",      icon:"📦", color:"#81C784", bg:"#E8F5E9", count:18, banner:"🏭", marge:0.18 },
  { id:"hotellerie",   label:"Hôtellerie",      icon:"🏨", color:"#FFB74D", bg:"#FFF3E0", count:9,  banner:"🏨", marge:0.20 },
  { id:"btp",          label:"BTP",             icon:"🏗️", color:"#FF8A65", bg:"#FBE9E7", count:24, banner:"🏗️", marge:0.15 },
  { id:"restauration", label:"Restauration",    icon:"🍽️", color:"#F06292", bg:"#FCE4EC", count:15, banner:"🍴", marge:0.25 },
  { id:"commercial",   label:"Commercial",      icon:"💼", color:"#BA68C8", bg:"#F3E5F5", count:11, banner:"📊", marge:0.22 },
  { id:"distribution", label:"Grande Distrib.", icon:"🛒", color:"#4DB6AC", bg:"#E0F2F1", count:8,  banner:"🏬", marge:0.18 },
  { id:"divers",       label:"Divers",          icon:"✨", color:"#7986CB", bg:"#E8EAF6", count:6,  banner:"🎯", marge:0.20 },
];

// Met à jour les counts dynamiquement après chargement des PROVIDERS
// (sera appelé après la définition de PROVIDERS)


// Fourchettes tarifaires nettes par métier (ce que le prestataire encaisse)
// Le client voit toujours prixClient(tarifNet, sector)
const METIERS_TARIFS = {
  proprete:{
    "Agent de propreté":          { min:11.5, max:13.5, default:12 },
    "Chef d’équipe":              { min:14,   max:17,   default:15 },
    "Technicien de surface":      { min:13,   max:16,   default:14 },
    "Laveur de vitres":           { min:13,   max:16,   default:14 },
    "Agent multiservice":         { min:11.5, max:14,   default:12 },
  },
  logistique:{
    "Préparateur de commandes":   { min:11.5, max:13.5, default:12 },
    "Cariste CACES 1":            { min:13,   max:16,   default:14 },
    "Cariste CACES 3":            { min:14,   max:17,   default:15 },
    "Agent de quai":              { min:11.5, max:14,   default:12 },
    "Responsable logistique":     { min:18,   max:26,   default:21 },
  },
  hotellerie:{
    "Réceptionniste":             { min:12,   max:15,   default:13 },
    "Femme/Valet de chambre":     { min:11.5, max:14,   default:12.5 },
    "Concierge":                  { min:14,   max:18,   default:15 },
    "Chef de réception":          { min:17,   max:23,   default:19 },
    "Night Auditor":              { min:14,   max:18,   default:16 },
  },
  btp:{
    "Manœuvre":                   { min:12,   max:15,   default:13 },
    "Maçon":                      { min:15,   max:22,   default:17 },
    "Électricien":                { min:17,   max:25,   default:20 },
    "Plombier":                   { min:16,   max:24,   default:19 },
    "Chef de chantier":           { min:22,   max:35,   default:27 },
    "Peintre":                    { min:13,   max:18,   default:15 },
    "Carreleur":                  { min:14,   max:20,   default:16 },
  },
  restauration:{
    "Serveur(se)":                { min:11.5, max:14,   default:12 },
    "Cuisinier":                  { min:13,   max:17,   default:14.5 },
    "Chef de partie":             { min:15,   max:21,   default:17 },
    "Plongeur":                   { min:11.5, max:13,   default:11.8 },
    "Barman":                     { min:12,   max:16,   default:13 },
    "Maître d’hôtel":             { min:17,   max:24,   default:19 },
  },
  commercial:{
    "Commercial terrain":         { min:13,   max:19,   default:15 },
    "Télévendeur":                { min:12,   max:15,   default:13 },
    "Chargé de clientèle":        { min:14,   max:19,   default:16 },
    "Manager commercial":         { min:20,   max:30,   default:24 },
  },
  distribution:{
    "Hôte(sse) de caisse":        { min:11.5, max:13,   default:11.8 },
    "Employé de rayon":           { min:11.5, max:13.5, default:12 },
    "Chef de rayon":              { min:15,   max:21,   default:17 },
    "Inventoriste":               { min:11.5, max:14,   default:12 },
  },
  divers:{
    "Agent de sécurité":          { min:12,   max:16,   default:13.5 },
    "Animateur(trice)":           { min:12,   max:15,   default:13 },
    "Assistant(e) admin":         { min:13,   max:17,   default:14 },
    "Chauffeur VTC":              { min:14,   max:20,   default:16 },
  },
};

const METIERS = Object.fromEntries(
  Object.entries(METIERS_TARIFS).map(([k,v]) => [k, Object.keys(v)])
);

// tarifNet = ce que le prestataire encaisse
// hourlyRate = prix affiché au CLIENT (tarifNet × (1+marge)) — jamais montré au prestataire
const _mkP = (base) => ({ ...base,
  hourlyRate: formatE(prixClient(base.tarifNet, base.sector)),
  rateNum:    prixClient(base.tarifNet, base.sector),
  cv: base.cv || null, // CV optionnel
});

// CV simulés pour quelques prestataires (les autres n'en ont pas)
const CV_DATA = {
  1: { // Thomas Saumur
    titre:"Logisticien Senior — Cariste CACES 1/3/5",
    accroche:"Expert en gestion d’entrepôt avec 8 ans d’expérience dans la logistique industrielle. Spécialisé dans les opérations de manutention lourde et la gestion de stocks.",
    experiences:[
      { poste:"Cariste Polyvalent", entreprise:"Amazon Logistique France", periode:"2021 – 2025", desc:"Conduite chariots CACES 1,3,5 · Gestion zone stockage · Préparation 400+ commandes/jour" },
      { poste:"Agent Logistique", entreprise:"DHL Supply Chain", periode:"2018 – 2021", desc:"Réception marchandises · Contrôle qualité · Formation nouveaux agents" },
      { poste:"Préparateur de commandes", entreprise:"Carrefour Supply", periode:"2017 – 2018", desc:"Picking vocal · Gestion retours · Inventaires tournants" },
    ],
    formations:[
      { diplome:"CACES R489 cat.1/3/5", etablissement:"AFTRAL Paris", annee:"2021" },
      { diplome:"CAP Magasinier Cariste", etablissement:"CFA Île-de-France", annee:"2017" },
      { diplome:"Brevet de Secouriste SST", etablissement:"Croix Rouge", annee:"2020" },
    ],
    langues:["Français (natif)","Arabe (courant)"],
    permis:"Permis B — véhiculé",
    hasCV: true,
  },
  23: { // Mariam Dubois
    titre:"Chef de rang — Service gastronomique",
    accroche:"Passionnée de gastronomie française, j’ai évolué dans les plus grands établissements parisiens. Mon expertise couvre le service en salle, la sommellerie de base et l’accueil VIP.",
    experiences:[
      { poste:"Chef de rang", entreprise:"Restaurant Le Grand Véfour ***", periode:"2022 – 2025", desc:"Service gastronomique étoilé · Gestion d’une équipe de 4 serveurs · Accueil clientèle internationale" },
      { poste:"Cheffe de rang", entreprise:"Hôtel Bristol Paris", periode:"2019 – 2022", desc:"Room service · Petit-déjeuner VIP · Coordination cuisine-salle" },
      { poste:"Serveuse", entreprise:"Brasserie Lipp", periode:"2017 – 2019", desc:"Service brasserie haut de gamme · Gestion 30 couverts/service" },
    ],
    formations:[
      { diplome:"BTS Hôtellerie-Restauration", etablissement:"Lycée Hôtelier de Paris", annee:"2017" },
      { diplome:"Formation Sommellerie niveau 1", etablissement:"CIVB Bordeaux", annee:"2020" },
    ],
    langues:["Français (natif)","Anglais (courant)","Espagnol (notions)"],
    permis:"Permis B",
    hasCV: true,
  },
  33: { // Julie Evan
    titre:"Réceptionniste Hôtelière — Bilingue",
    accroche:"Réceptionniste expérimentée en hôtellerie 4 et 5 étoiles, bilingue français-anglais. Maîtrise des logiciels Opera, Fidelio et des standards de qualité hôtelière internationale.",
    experiences:[
      { poste:"Réceptionniste", entreprise:"Hôtel Mandarin Oriental Paris", periode:"2022 – 2025", desc:"Accueil clientèle internationale · Check-in/out VIP · Gestion réclamations · Conciergerie" },
      { poste:"Night Auditor", entreprise:"Novotel Paris Centre", periode:"2020 – 2022", desc:"Clôture caisse · Rapport nuit · Supervision équipe nuit" },
      { poste:"Réceptionniste", entreprise:"Ibis Paris Gare du Nord", periode:"2019 – 2020", desc:"Accueil et renseignements · Gestion réservations · Standard téléphonique" },
    ],
    formations:[
      { diplome:"BTS Tourisme", etablissement:"IUT Paris Descartes", annee:"2019" },
      { diplome:"Certification Opera PMS", etablissement:"Oracle Hospitality", annee:"2021" },
    ],
    langues:["Français (natif)","Anglais (courant C1)","Arabe (intermédiaire)"],
    permis:"Permis B",
    hasCV: true,
  },
  60: { // Marc Durand
    titre:"Commercial Terrain B2B — Spécialiste grands comptes",
    accroche:"Commercial expérimenté en développement commercial B2B. 4 ans de terrain avec un track record éprouvé en prospection, négociation et closing. Habitué aux cycles de vente courts.",
    experiences:[
      { poste:"Commercial terrain", entreprise:"Salesforce France", periode:"2023 – 2025", desc:"Prospection grands comptes IDF · Négociation contrats 50k€+ · Taux de transformation 34%" },
      { poste:"Chargé de développement commercial", entreprise:"Doctolib", periode:"2021 – 2023", desc:"Acquisition nouveaux cabinets médicaux · Formation clients · Gestion portefeuille 200 comptes" },
    ],
    formations:[
      { diplome:"Bachelor Commerce International", etablissement:"EFAP Paris", annee:"2021" },
      { diplome:"Certification Salesforce CRM", etablissement:"Salesforce Trailhead", annee:"2022" },
    ],
    langues:["Français (natif)","Anglais (B2)"],
    permis:"Permis B — véhiculé",
    hasCV: true,
  },
};
const PROVIDERS = [
  _mkP({ id:1,  name:"Thomas Saumur",    jobTitle:"Cariste CACES 1",          tarifNet:14.0, avatar:"👨‍💼", color:"#4FC3F7", rating:4.8, reviews:47, skills:["CACES 1","CACES 3","Gestion entrepôt"],    experience:"8 ans",  available:true,  sector:"logistique",   bio:"Expert en logistique 8 ans. Certifié CACES 1,3,5.",           distance:"2,3 km", responseTime:"~10 min", missions:47, role:"Cariste CACES 1" }),
  _mkP({ id:2,  name:"Brahim Oukaci",    jobTitle:"Cariste CACES 1",          tarifNet:13.5, avatar:"🚜",  color:"#4FC3F7", rating:4.6, reviews:31, skills:["CACES 1","Chariots élév.","Stockage"],       experience:"5 ans",  available:true,  sector:"logistique",   bio:"Cariste expérimenté, disponible matin et après-midi.",        distance:"1,4 km", responseTime:"~5 min",  missions:31, role:"Cariste CACES 1" }),
  _mkP({ id:3,  name:"Kevin Moreau",     jobTitle:"Cariste CACES 1",          tarifNet:14.0, avatar:"🏭",  color:"#4FC3F7", rating:4.4, reviews:19, skills:["CACES 1","Prépa commandes","WMS"],           experience:"3 ans",  available:true,  sector:"logistique",   bio:"Polyvalent logistique, certifié CACES 1.",                    distance:"3,8 km", responseTime:"~14 min", missions:19, role:"Cariste CACES 1" }),
  _mkP({ id:13, name:"Inès Moreau",      jobTitle:"Serveur(se)",              tarifNet:12.0, avatar:"🍽️", color:"#F06292", rating:4.7, reviews:28, skills:["Service en salle","Encaissement","Accueil"],   experience:"3 ans",  available:true,  sector:"restauration", bio:"Souriante et dynamique, expérience brasseries.",              distance:"1,5 km", responseTime:"~6 min",  missions:28, role:"Serveur(se)" }),
  _mkP({ id:14, name:"Antoine Girard",   jobTitle:"Serveur(se)",              tarifNet:12.0, avatar:"🥗",  color:"#F06292", rating:4.5, reviews:18, skills:["Service en salle","Upselling","PMS"],          experience:"2 ans",  available:true,  sector:"restauration", bio:"Expérience restaurants gastronomiques et brasseries.",        distance:"0,7 km", responseTime:"~3 min",  missions:18, role:"Serveur(se)" }),
  _mkP({ id:15, name:"Camille Dupont",   jobTitle:"Serveur(se)",              tarifNet:12.5, avatar:"🫖",  color:"#F06292", rating:4.8, reviews:44, skills:["Service VIP","Anglais","Sommellerie de base"],  experience:"5 ans",  available:true,  sector:"restauration", bio:"Serveuse gastronomique, anglais courant.",                     distance:"2,2 km", responseTime:"~9 min",  missions:44, role:"Serveur(se)" }),
  _mkP({ id:33, name:"Julie Evan",       jobTitle:"Réceptionniste",           tarifNet:13.0, avatar:"🏨",  color:"#FFB74D", rating:4.6, reviews:29, skills:["Accueil","Logiciels hôteliers","Anglais"],      experience:"5 ans",  available:true,  sector:"hotellerie",   bio:"Réceptionniste bilingue, expérience 4 étoiles.",              distance:"3,2 km", responseTime:"~15 min", missions:29, role:"Réceptionniste" }),
  _mkP({ id:34, name:"Mathilde Perrin",  jobTitle:"Réceptionniste",           tarifNet:13.0, avatar:"🗝️", color:"#FFB74D", rating:4.8, reviews:52, skills:["Opera PMS","Anglais","Espagnol","Check-in"],    experience:"7 ans",  available:true,  sector:"hotellerie",   bio:"Trilingue, expérience hôtels 4 et 5 étoiles.",               distance:"1,5 km", responseTime:"~6 min",  missions:52, role:"Réceptionniste" }),
  _mkP({ id:35, name:"Sébastien Lamy",   jobTitle:"Réceptionniste",           tarifNet:12.5, avatar:"🛎️", color:"#FFB74D", rating:4.4, reviews:18, skills:["Accueil","Caisse","Réservations"],              experience:"3 ans",  available:true,  sector:"hotellerie",   bio:"Réceptionniste polyvalent, disponible nuits et week-ends.",   distance:"2,7 km", responseTime:"~10 min", missions:18, role:"Réceptionniste" }),
  _mkP({ id:46, name:"Moussa Konaté",    jobTitle:"Agent de propreté",        tarifNet:12.0, avatar:"🧹",  color:"#26C6DA", rating:4.4, reviews:18, skills:["Nettoyage bureaux","Désinfection","Tri déchets"],experience:"2 ans",  available:true,  sector:"proprete",     bio:"Consciencieux, disponible tôt le matin.",                     distance:"1,2 km", responseTime:"~4 min",  missions:18, role:"Agent de propreté" }),
  _mkP({ id:47, name:"Houda Saidi",      jobTitle:"Agent de propreté",        tarifNet:12.0, avatar:"🫧",  color:"#26C6DA", rating:4.5, reviews:24, skills:["Nettoyage sol","Désinfection","Vitres"],         experience:"3 ans",  available:true,  sector:"proprete",     bio:"Expérience bureaux et surfaces commerciales.",                distance:"0,6 km", responseTime:"~2 min",  missions:24, role:"Agent de propreté" }),
  _mkP({ id:48, name:"Jean-Paul Merci",  jobTitle:"Agent de propreté",        tarifNet:12.0, avatar:"🧽",  color:"#26C6DA", rating:4.3, reviews:11, skills:["Nettoyage industriel","Produits chimiques"],     experience:"2 ans",  available:true,  sector:"proprete",     bio:"Disponible toute la journée, efficace et discret.",           distance:"2,8 km", responseTime:"~11 min", missions:11, role:"Agent de propreté" }),
  _mkP({ id:60, name:"Marc Durand",      jobTitle:"Commercial terrain",       tarifNet:15.0, avatar:"💼",  color:"#BA68C8", rating:4.5, reviews:24, skills:["Prospection","Négociation","CRM"],               experience:"4 ans",  available:true,  sector:"commercial",   bio:"Chasseur de têtes, spécialiste B2B entreprises.",             distance:"2,1 km", responseTime:"~8 min",  missions:24, role:"Commercial terrain" }),
  _mkP({ id:61, name:"Sophie Renard",    jobTitle:"Commercial terrain",       tarifNet:15.5, avatar:"🎯",  color:"#BA68C8", rating:4.8, reviews:56, skills:["Closing","Négociation","Salesforce"],            experience:"8 ans",  available:true,  sector:"commercial",   bio:"Top performer, spécialiste grands comptes B2B.",              distance:"0,7 km", responseTime:"~3 min",  missions:56, role:"Commercial terrain" }),
  _mkP({ id:62, name:"Antoine Fleury",   jobTitle:"Commercial terrain",       tarifNet:14.5, avatar:"📈",  color:"#BA68C8", rating:4.4, reviews:19, skills:["Prospection terrain","Démo produit","CRM"],      experience:"3 ans",  available:true,  sector:"commercial",   bio:"Chasseur commercial B2B, habitué aux cycles courts.",         distance:"3,0 km", responseTime:"~12 min", missions:19, role:"Commercial terrain" }),
  _mkP({ id:70, name:"Nadia Cherif",     jobTitle:"Hôte(sse) de caisse",      tarifNet:11.8, avatar:"🛒",  color:"#4DB6AC", rating:4.4, reviews:14, skills:["Encaissement","Accueil","Gestion files"],        experience:"2 ans",  available:true,  sector:"distribution", bio:"Rapide et souriante, habituée aux grandes surfaces.",         distance:"1,0 km", responseTime:"~4 min",  missions:14, role:"Hôte(sse) de caisse" }),
  _mkP({ id:71, name:"Stéphanie Collin", jobTitle:"Hôte(sse) de caisse",      tarifNet:12.0, avatar:"💰",  color:"#4DB6AC", rating:4.6, reviews:27, skills:["Encaissement","SAV caisse","Fidélité"],          experience:"4 ans",  available:true,  sector:"distribution", bio:"Expérience hypermarchés et supermarchés.",                    distance:"0,5 km", responseTime:"~2 min",  missions:27, role:"Hôte(sse) de caisse" }),
  _mkP({ id:72, name:"Mounia Brahim",    jobTitle:"Hôte(sse) de caisse",      tarifNet:11.8, avatar:"🏷️", color:"#4DB6AC", rating:4.3, reviews:10, skills:["Caisse","Accueil","Mise en rayon légère"],       experience:"1 an",   available:true,  sector:"distribution", bio:"Disponible tôt le matin et week-ends.",                       distance:"2,2 km", responseTime:"~8 min",  missions:10, role:"Hôte(sse) de caisse" }),
  _mkP({ id:80, name:"Omar Messaoud",    jobTitle:"Agent de sécurité",        tarifNet:13.5, avatar:"🛡️", color:"#7986CB", rating:4.6, reviews:33, skills:["CQP APS","Rondes","Gestion conflits"],           experience:"6 ans",  available:true,  sector:"divers",       bio:"Agent qualifié CQP APS, calme et professionnel.",             distance:"2,9 km", responseTime:"~12 min", missions:33, role:"Agent de sécurité" }),
  _mkP({ id:81, name:"Stéphane Veron",   jobTitle:"Agent de sécurité",        tarifNet:14.0, avatar:"🔐",  color:"#7986CB", rating:4.7, reviews:45, skills:["CQP APS","SST","Surveillance vidéo"],           experience:"8 ans",  available:true,  sector:"divers",       bio:"Agent expérimenté, habilité sûreté aéroportuaire.",           distance:"1,1 km", responseTime:"~4 min",  missions:45, role:"Agent de sécurité" }),
  _mkP({ id:82, name:"Fatoumata Balde",  jobTitle:"Agent de sécurité",        tarifNet:13.5, avatar:"👮‍♀️",color:"#7986CB", rating:4.5, reviews:24, skills:["CQP APS","Contrôle accès","Prévention"],       experience:"4 ans",  available:true,  sector:"divers",       bio:"Agente de sécurité qualifiée, spécialiste contrôle accès.",   distance:"0,6 km", responseTime:"~2 min",  missions:24, role:"Agent de sécurité" })
];

const DOCS_REQUIS = [
  { id:"kbis",     label:"Extrait KBIS / INSEE",      icon:"🏢", required:true,  info:"Attestation existence légale de votre auto-entreprise" },
  { id:"urssaf",   label:"Attestation URSSAF",        icon:"📋", required:true,  info:"Prouve que vous êtes à jour de vos cotisations" },
  { id:"cni",      label:"Pièce d’identité",          icon:"🪪", required:true,  info:"CNI ou passeport en cours de validité" },
  { id:"vitale",   label:"Carte Vitale",              icon:"💚", required:true,  info:"Attestation de droits à l’Assurance Maladie" },
  { id:"domicile", label:"Justificatif de domicile",  icon:"🏠", required:true,  info:"Facture EDF ou quittance de loyer -3 mois" },
  { id:"rib",      label:"RIB / IBAN",                icon:"🏦", required:true,  info:"Pour le virement de vos paiements" },
  { id:"rc_pro",   label:"Attestation RC Pro",        icon:"🛡️", required:false, info:"Responsabilité civile professionnelle" },
  { id:"diplomes", label:"Diplômes & Certifications", icon:"🎓", required:false, info:"CACES, habilitations, diplômes pro…" },
];

const JOURS=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const PLAGES=["Matin (6h-13h)","Après-midi (13h-20h)","Soir/Nuit (20h-6h)"];
const NIVEAUX=["Débutant","Confirmé","Expert"];
const LANGUES_LIST=["Français","Anglais","Espagnol","Arabe","Portugais","Allemand","Italien","Mandarin"];

// ── Primitives ────────────────────────────────────────────────────
// ── UI Primitives — Premium Dark ─────────────────────────────────

const Stars = ({ rating, size=13 }) => (
  <span style={{ fontSize:size, letterSpacing:1 }}>
    {[1,2,3,4,5].map(i=>(
      <span key={i} style={{ color:i<=Math.floor(rating)?C.accentGold:"rgba(255,255,255,0.12)" }}>★</span>
    ))}
  </span>
);

const Badge = ({ children, color=C.violet, small }) => (
  <span style={{
    background:`${color}18`,
    color,
    border:`1px solid ${color}35`,
    borderRadius:100,
    padding: small ? "2px 9px" : "4px 14px",
    fontSize: small ? 10 : 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    whiteSpace:"nowrap",
    display:"inline-block",
  }}>{children}</span>
);

const Btn = ({ children, onClick, variant="primary", full, disabled, style:s, className="" }) => {
  const variants = {
    primary: {
      background: disabled ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
      color: disabled ? C.textMuted : C.white,
      boxShadow: disabled ? "none" : shadow.glow,
      border: "none",
    },
    secondary: {
      background: "transparent",
      color: C.text,
      border: `1px solid ${C.borderStrong}`,
      boxShadow: "none",
    },
    ghost: {
      background: "transparent",
      color: C.violet,
      border: `1px solid ${C.violet}55`,
      boxShadow: "none",
    },
    success: {
      background: `linear-gradient(135deg, ${C.success}, #0ab87a)`,
      color: C.white,
      boxShadow: `0 4px 20px ${C.success}44`,
      border: "none",
    },
    danger: {
      background: `linear-gradient(135deg, ${C.accent}, #d94848)`,
      color: C.white,
      boxShadow: `0 4px 16px ${C.accent}44`,
      border: "none",
    },
    gold: {
      background: `linear-gradient(135deg, ${C.accentGold}, #d9960a)`,
      color: "#1a1200",
      boxShadow: `0 4px 20px ${C.accentGold}44`,
      border: "none",
    },
    dark: {
      background: "#162547",
      color: C.text,
      border: `1px solid ${C.borderStrong}`,
      boxShadow: "none",
    },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`btn-hover ${className}`}
      style={{
        borderRadius: r,
        fontWeight: 600,
        fontSize: 15,
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "14px 24px",
        width: full ? "100%" : "auto",
        fontFamily: "inherit",
        opacity: disabled ? 0.5 : 1,
        letterSpacing: 0.2,
        ...variants[variant],
        ...s,
      }}
    >{children}</button>
  );
};

const Input = ({ label, type="text", placeholder, icon, value, onChange, hint, disabled=false }) => (
  <div style={{ marginBottom:16 }}>
    {label && (
      <label style={{
        display:"block", fontSize:11, color:C.textSub,
        marginBottom:7, fontWeight:600, letterSpacing:0.8,
        textTransform:"uppercase",
      }}>{label}</label>
    )}
    <div style={{ position:"relative" }}>
      {icon && (
        <span style={{
          position:"absolute", left:14, top:"50%",
          transform:"translateY(-50%)", fontSize:16, opacity:0.5,
        }}>{icon}</span>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value||""}
        onChange={onChange}
        disabled={disabled}
        style={{
          width:"100%",
          padding: icon ? "13px 14px 13px 44px" : "13px 16px",
          borderRadius: r,
          border: `1px solid ${disabled ? "rgba(255,255,255,0.04)" : C.border}`,
          fontSize:14, fontFamily:"inherit",
          color: disabled ? C.textMuted : C.text,
          background: disabled ? "rgba(255,255,255,0.03)" : "#112240",
          outline:"none",
          boxSizing:"border-box",
          transition:"border 0.2s, box-shadow 0.2s",
        }}
      />
    </div>
    {hint && <p style={{ fontSize:11, color:C.textMuted, margin:"6px 0 0 2px" }}>{hint}</p>}
  </div>
);

const Select = ({ label, options, value, onChange }) => (
  <div style={{ marginBottom:16 }}>
    {label && (
      <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>{label}</label>
    )}
    <select
      value={value||""}
      onChange={onChange}
      style={{
        width:"100%", padding:"13px 40px 13px 16px",
        borderRadius:r, border:`1px solid ${C.border}`,
        fontSize:14, fontFamily:"inherit",
        color: value ? C.text : C.textMuted,
        background: "#0D1B3E",
        outline:"none", boxSizing:"border-box",
        backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns=’http://www.w3.org/2000/svg’ width=’12’ height=’8’ viewBox=’0 0 12 8’%3E%3Cpath d=’M1 1l5 5 5-5’ stroke=’%238B8FA8’ stroke-width=’1.5’ fill=’none’/%3E%3C/svg%3E")`,
        backgroundRepeat:"no-repeat",
        backgroundPosition:"right 14px center",
        appearance:"none",
      }}
    >
      <option value="">Sélectionner…</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// Step header — dark style premium
const StepHeader = ({ title, subtitle, step, total, onBack }) => (
  <div style={{
    background: "#0D1B3E",
    padding:"52px 22px 24px",
    borderBottom:`1px solid ${C.border}`,
  }}>
    {onBack && (
      <button onClick={onBack} className="btn-hover" style={{
        background:"transparent", border:"none",
        color:C.textSub, cursor:"pointer",
        fontSize:13, fontWeight:500, padding:"0 0 14px",
        display:"flex", alignItems:"center", gap:6,
      }}>
        ← Retour
      </button>
    )}
    {total && (
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{
            flex:1, height:2, borderRadius:1,
            background: i<step ? C.violet : C.border,
            transition:"background 0.4s",
          }} />
        ))}
      </div>
    )}
    {step && total && (
      <p style={{ color:C.textMuted, fontSize:11, margin:"0 0 4px", letterSpacing:1, textTransform:"uppercase", fontWeight:600 }}>
        Étape {step} / {total}
      </p>
    )}
    <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display, lineHeight:1.2 }}>{title}</h2>
    {subtitle && <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0", lineHeight:1.6 }}>{subtitle}</p>}
  </div>
);

// Card component
const Card = ({ children, style={}, className="card-hover", onClick }) => (
  <div
    onClick={onClick}
    className={className}
    style={{
      background: "#0D1B3E",
      borderRadius: r,
      border: `1px solid ${C.border}`,
      padding: 16,
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}
  >{children}</div>
);

// Section header
const SectionHeader = ({ title, action, onAction }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
    <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:C.text }}>{title}</h3>
    {action && (
      <button onClick={onAction} style={{ background:"none", border:"none", color:C.violet, fontWeight:600, fontSize:12, cursor:"pointer", letterSpacing:0.3 }}>
        {action} →
      </button>
    )}
  </div>
);

// Divider
const Divider = () => <div style={{ height:1, background:C.border, margin:"16px 0" }} />;

// ── SCREENS ───────────────────────────────────────────────────────

function SplashScreen({ onNext, onBackoffice }) {
  const [v,setV]=useState(false);
  useEffect(()=>{ const t=setTimeout(()=>setV(true),100); return ()=>clearTimeout(t); },[]);
  return (
    <div style={{
      minHeight:"100%",
      background: `linear-gradient(160deg, #050E20 0%, #0A1628 40%, #162547 70%, #1E3A7B 100%)`,
      display:"flex", flexDirection:"column",
      padding:"0 28px 48px",
      position:"relative", overflow:"hidden",
    }}>
      {/* Ambient glow effects */}
      <div style={{ position:"absolute", top:-160, right:-160, width:420, height:420, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.25) 0%, transparent 65%)`, pointerEvents:"none" }} />
      <div style={{ position:"absolute", bottom:-100, left:-100, width:320, height:320, borderRadius:"50%", background:`radial-gradient(circle, rgba(30,58,123,0.4) 0%, transparent 65%)`, pointerEvents:"none" }} />
      <div style={{ position:"absolute", top:"40%", left:"50%", transform:"translate(-50%,-50%)", width:500, height:500, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.10) 0%, transparent 60%)`, pointerEvents:"none" }} />

      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:60, marginBottom:"auto" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:34, height:34, borderRadius:10,
            background:`linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:17, boxShadow:shadow.glow,
          }}>⚡</div>
          <span style={{ color:C.text, fontSize:18, fontWeight:700, fontFamily:font.display, letterSpacing:-0.3 }}>JOBER</span>
        </div>
        <button onClick={onBackoffice} style={{
          background:"rgba(255,255,255,0.04)",
          border:`1px solid ${C.border}`,
          borderRadius:10, padding:"6px 12px",
          color:C.textMuted, cursor:"pointer",
          fontSize:10, fontFamily:"inherit",
          fontWeight:600, letterSpacing:1, textTransform:"uppercase",
        }}>Admin</button>
      </div>

      {/* Hero content */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column",
        justifyContent:"flex-end", paddingBottom:48,
        opacity:v?1:0, transform:v?"translateY(0)":"translateY(24px)",
        transition:"all 0.8s cubic-bezier(0.22,1,0.36,1)",
      }}>
        {/* Tag */}
        <div style={{ marginBottom:20 }}>
          <Badge color={C.violet}>Plateforme de services à la demande</Badge>
        </div>

        {/* Headline */}
        <h1 style={{
          color:C.text, fontSize:42, fontWeight:800,
          margin:"0 0 16px", lineHeight:1.1,
          fontFamily:font.display, letterSpacing:-1,
        }}>
          Le bon pro,<br/>
          <span style={{
            background:`linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>au bon moment.</span>
        </h1>

        <p style={{ color:C.textSub, fontSize:15, lineHeight:1.7, marginBottom:48, maxWidth:300 }}>
          Trouvez des prestataires qualifiés et vérifiés pour vos missions ponctuelles — en quelques minutes.
        </p>

        {/* Stats pills */}
        <div style={{ display:"flex", gap:8, marginBottom:36, flexWrap:"wrap" }}>
          {[
            { v:"88+", l:"Prestataires" },
            { v:"7", l:"Secteurs" },
            { v:"<10min", l:"Réponse" },
          ].map(s=>(
            <div key={s.l} style={{
              background:"rgba(255,255,255,0.04)",
              border:`1px solid ${C.border}`,
              borderRadius:100, padding:"8px 16px",
              display:"flex", gap:8, alignItems:"center",
            }}>
              <span style={{ color:C.violet, fontWeight:800, fontSize:14 }}>{s.v}</span>
              <span style={{ color:C.textSub, fontSize:12 }}>{s.l}</span>
            </div>
          ))}
        </div>

        {isLaunchPhase() && (
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
            border:"1px solid rgba(16,217,143,0.35)",
            borderRadius:r, padding:"12px 16px", marginBottom:20,
            display:"flex", gap:12, alignItems:"center",
          }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"rgba(16,217,143,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🎉</div>
            <div>
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:13, marginBottom:2 }}>Offre de lancement — 6 mois</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.5 }}>Commission réduite · Accès illimité · Profitez-en avant la fin de la période</div>
            </div>
          </div>
        )}

        <Btn full onClick={onNext} style={{ fontSize:16, padding:"17px", borderRadius:r+4, letterSpacing:0.3 }}>
          Commencer →
        </Btn>
        <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", marginTop:14, letterSpacing:0.3 }}>
          Gratuit · Sans engagement · Résultats immédiats
        </p>
      </div>
    </div>
  );
}

function RoleScreen({ onSelect }) {
  const [hov,setHov]=useState(null);
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20 0%, #0A1628 50%, #162547 100%)`, display:"flex", flexDirection:"column", padding:"60px 24px 48px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.20) 0%, transparent 65%)`, pointerEvents:"none" }} />

      <div style={{ marginBottom:48 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${C.violet},${C.violetDark})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚡</div>
          <span style={{ color:C.text, fontSize:17, fontWeight:700, fontFamily:font.display }}>JOBER</span>
        </div>
        <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", fontWeight:600, marginBottom:10 }}>Bienvenue</p>
        <h2 style={{ color:C.text, fontSize:32, fontWeight:800, margin:0, lineHeight:1.15, fontFamily:font.display }}>Vous êtes ?</h2>
        <p style={{ color:C.textSub, fontSize:14, marginTop:8 }}>Choisissez votre profil pour commencer</p>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {[
          { role:"client",      label:"Je suis client",          sub:"Je cherche des prestataires qualifiés", emoji:"🏢", color:C.violet },
          { role:"prestataire", label:"Je suis prestataire",     sub:"Je propose mes services",               emoji:"👷", color:C.accentGold },
        ].map(({ role, label, sub, emoji, color }) => (
          <div
            key={role}
            onClick={() => onSelect(role)}
            onMouseEnter={() => setHov(role)}
            onMouseLeave={() => setHov(null)}
            className="card-hover"
            style={{
              background: hov===role ? C.bgSurface : C.bgCard,
              border: `1px solid ${hov===role ? color+"55" : C.border}`,
              borderRadius: r+4,
              padding:"22px 20px",
              cursor:"pointer",
              display:"flex", alignItems:"center", gap:16,
              transition:"all 0.2s",
            }}
          >
            <div style={{
              width:56, height:56, borderRadius:r,
              background:`${color}15`,
              border:`1px solid ${color}25`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:26, flexShrink:0,
            }}>{emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:15, marginBottom:3 }}>{label}</div>
              <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{sub}</div>
            </div>
            <div style={{ color:C.textMuted, fontSize:18, fontWeight:300 }}>›</div>
          </div>
        ))}
      </div>

      {isLaunchPhase() && (
        <div style={{
          background:"linear-gradient(135deg, rgba(16,217,143,0.10), rgba(16,217,143,0.04))",
          border:"1px solid rgba(16,217,143,0.30)",
          borderRadius:r, padding:"12px 16px", marginTop:24,
          display:"flex", gap:10, alignItems:"center",
        }}>
          <span style={{ fontSize:20, flexShrink:0 }}>🚀</span>
          <div>
            <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement — 6 mois</div>
            <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, lineHeight:1.5 }}>Clients : tarifs préférentiels · Prestataires : accès gratuit et 0% de commission</div>
          </div>
        </div>
      )}

      <p style={{ color:C.textMuted, fontSize:11, textAlign:"center", marginTop:16 }}>
        En continuant, vous acceptez nos <span style={{ color:C.violet, cursor:"pointer" }}>CGU</span>
      </p>
    </div>
  );
}


// ── AUTH SCREEN — Connexion / Inscription ────────────────────────
function AuthScreen({ role, onLogin, onRegister, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  const isClient = role === "client";
  const accentColor = isClient ? C.violet : C.accentGold;
  const emoji = isClient ? "🏢" : "👷";
  const roleLabel = isClient ? "Client" : "Prestataire";

  const handleLogin = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setLoading(false); setError(err.message); return; }

    // Vérifier le vrai rôle du compte en base
    const { data:{ user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    setLoading(false);

    if (profile?.role && profile.role !== role) {
      // Mauvais espace — on redirige vers le bon
      setError(`Ce compte est un compte ${profile.role === "prestataire" ? "Prestataire" : "Client"}. Utilisez l'espace correspondant.`);
      await supabase.auth.signOut();
      return;
    }
    onLogin();
  };

  const handleRegister = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    if (password.length < 6) { setError("Mot de passe minimum 6 caractères"); return; }
    setLoading(true); setError("");
    const { data, error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { role } },
    });
    if (err) {
      setLoading(false);
      // Email déjà utilisé → message clair
      if (err.message.includes("already") || err.message.includes("registered")) {
        setError("Un compte existe déjà avec cet email. Connectez-vous à la place.");
      } else {
        setError(err.message);
      }
      return;
    }
    // Fallback : créer le profil si le trigger ne l'a pas fait
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role, prenom: "", nom: "",
      });
    }
    setLoading(false);
    onRegister();
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>

      {/* Ambient glow */}
      <div style={{ position:"absolute", top:-100, right:-100, width:300, height:300, borderRadius:"50%", background:`radial-gradient(circle,${accentColor}18 0%,transparent 65%)`, pointerEvents:"none" }} />

      {/* Header */}
      <div style={{ padding:"54px 24px 28px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:24, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>← Retour</button>

        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <div style={{ width:48, height:48, borderRadius:r, background:`${accentColor}20`, border:`1px solid ${accentColor}35`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{emoji}</div>
          <div>
            <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 3px" }}>Espace {roleLabel}</p>
            <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>
              {mode==="login" ? "Bon retour 👋" : "Rejoignez JOBER"}
            </h2>
          </div>
        </div>

        {/* Toggle connexion / inscription */}
        <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4, border:`1px solid ${C.border}` }}>
          {[
            { id:"login",    label:"Connexion"   },
            { id:"register", label:"Inscription" },
          ].map(m => (
            <button key={m.id} onClick={()=>setMode(m.id)} style={{
              flex:1, padding:"10px", border:"none", borderRadius:10, cursor:"pointer",
              background: mode===m.id ? accentColor : "transparent",
              color: mode===m.id ? C.white : C.textSub,
              fontWeight: mode===m.id ? 700 : 500,
              fontSize:14, fontFamily:"inherit",
              boxShadow: mode===m.id ? `0 4px 16px ${accentColor}44` : "none",
              transition:"all 0.2s",
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      {isLaunchPhase() && (
        <div style={{ padding:"0 24px 8px" }}>
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.10), rgba(16,217,143,0.04))",
            border:"1px solid rgba(16,217,143,0.30)",
            borderRadius:r, padding:"11px 14px",
            display:"flex", gap:10, alignItems:"center",
          }}>
            <span style={{ fontSize:16, flexShrink:0 }}>🎉</span>
            <div style={{ flex:1 }}>
              <span style={{ fontWeight:700, color:"#10D98F", fontSize:12 }}>Offre de lancement — 6 mois offerts</span>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {role==="client" ? "Commissions réduites pendant toute la période de lancement" : "Accès illimité gratuit · 0% de commission sur vos missions"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <div style={{ padding:"0 24px 40px", flex:1 }}>
        {mode === "login" ? (
          /* ── CONNEXION ── */
          <>
            <Input label="Adresse email" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ position:"relative" }}>
              <Input label="Mot de passe" type={showPass?"text":"password"} placeholder="••••••••" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
              <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
                {showPass?"Cacher":"Voir"}
              </button>
            </div>
            <div style={{ textAlign:"right", marginTop:-8, marginBottom:20 }}>
              <button onClick={()=>{ setForgotMode(true); setError(""); }} style={{ background:"none", border:"none", color:accentColor, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                Mot de passe oublié ?
              </button>
            </div>

            {forgotMode && (
              <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"16px", marginBottom:16 }}>
                {forgotSent ? (
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>📧</div>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Email envoyé !</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>Vérifiez votre boîte mail et cliquez sur le lien pour réinitialiser votre mot de passe.</div>
                    <button onClick={()=>{ setForgotMode(false); setForgotSent(false); }} style={{ marginTop:12, background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>← Retour à la connexion</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>Réinitialiser le mot de passe</div>
                    <Input label="Votre email" type="email" placeholder="votre@email.fr" icon="✉️" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} />
                    {error && <div style={{ color:"#F25E5E", fontSize:12, marginBottom:8 }}>{error}</div>}
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn onClick={()=>setForgotMode(false)} style={{ flex:1, fontSize:13, padding:"11px", background:"transparent", border:`1px solid ${C.border}` }}>Annuler</Btn>
                      <Btn onClick={async()=>{
                        if(!forgotEmail){ setError("Email requis"); return; }
                        setLoading(true); setError("");
                        const { error:err } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
                          redirectTo: window.location.origin,
                        });
                        setLoading(false);
                        if(err){ setError(err.message); return; }
                        setForgotSent(true);
                      }} disabled={loading} style={{ flex:1, fontSize:13, padding:"11px", background:accentColor }}>
                        {loading ? "Envoi…" : "Envoyer →"}
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            )}

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
            <Btn full onClick={handleLogin} disabled={loading} style={{ fontSize:15, padding:"16px", background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, marginBottom:20 }}>
              {loading ? "Connexion…" : "Se connecter →"}
            </Btn>

            {/* Social login */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <div style={{ flex:1, height:1, background:C.border }} />
              <span style={{ color:C.textMuted, fontSize:12 }}>ou continuer avec</span>
              <div style={{ flex:1, height:1, background:C.border }} />
            </div>
            <div style={{ display:"flex", gap:10 }}>
              {[{icon:"🍎",label:"Apple"},{icon:"G",label:"Google"}].map(s=>(
                <button key={s.label} style={{ flex:1, padding:"13px", border:`1px solid ${C.border}`, borderRadius:r, background:"rgba(255,255,255,0.04)", fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600, color:C.text, display:"flex", gap:8, alignItems:"center", justifyContent:"center" }}>
                  <span>{s.icon}</span>{s.label}
                </button>
              ))}
            </div>

            <p style={{ textAlign:"center", color:C.textSub, fontSize:13, marginTop:24 }}>
              Pas encore de compte ?{" "}
              <button onClick={()=>setMode("register")} style={{ background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                S'inscrire
              </button>
            </p>
          </>
        ) : (
          /* ── INSCRIPTION ── */
          <>
            <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>ℹ️</span>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>
                Vous allez créer un compte <strong style={{ color:C.text }}>{roleLabel} JOBER</strong>.
                {isClient
                  ? " Renseignez vos informations et commencez à réserver en quelques minutes."
                  : " Vous serez guidé à travers les étapes de validation de votre dossier."
                }
              </p>
            </div>

            <Input label="Adresse email" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ position:"relative" }}>
              <Input label="Mot de passe" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
              <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
                {showPass?"Cacher":"Voir"}
              </button>
            </div>

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
            <Btn full onClick={handleRegister} disabled={loading} style={{ fontSize:15, padding:"16px", background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, marginBottom:14 }}>
              {loading ? "Création…" : "Créer mon compte →"}
            </Btn>

            <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", lineHeight:1.6 }}>
              En créant un compte vous acceptez nos{" "}
              <span style={{ color:accentColor, cursor:"pointer" }}>CGU</span>{" "}et notre{" "}
              <span style={{ color:accentColor, cursor:"pointer" }}>Politique de confidentialité</span>
            </p>

            <p style={{ textAlign:"center", color:C.textSub, fontSize:13, marginTop:20 }}>
              Déjà un compte ?{" "}
              <button onClick={()=>setMode("login")} style={{ background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Se connecter
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Ancien ClientAuthScreen — remplacé par AuthScreen
function ClientAuthScreen({ onLogin, onBack }) {
  return <AuthScreen role="client" onLogin={onLogin} onRegister={onLogin} onBack={onBack} />;
}

// ── CONTACT SUPPORT ───────────────────────────────────────────────
function ContactSupportScreen({ onBack }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  const SUBJECTS = [
    "Problème de connexion",
    "Bug dans l'application",
    "Question sur mon compte",
    "Problème de paiement",
    "Signaler un utilisateur",
    "Autre",
  ];

  const handleSend = async () => {
    if (!subject) { setError("Choisissez un sujet"); return; }
    if (!message.trim() || message.length < 20) { setError("Message trop court (20 caractères minimum)"); return; }
    setLoading(true); setError("");

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          userEmail: user?.email || "",
          userName:  user?.user_metadata?.prenom || user?.email || "Inconnu",
          userId:    user?.id || "",
        }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      setSent(true);
    } catch {
      setError("Envoi échoué. Réessayez dans quelques instants.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>🎧 Contacter le support</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Notre équipe répond sous 24h ouvrées</p>
      </div>

      <div style={{ padding:"24px 18px" }}>
        {sent ? (
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:52, marginBottom:16 }}>✅</div>
            <div style={{ fontWeight:800, color:C.text, fontSize:20, marginBottom:8 }}>Message envoyé !</div>
            <div style={{ color:C.textSub, fontSize:14, lineHeight:1.6, marginBottom:24 }}>
              Notre équipe va traiter votre demande et vous répondre par email sous 24h ouvrées.
            </div>
            <Btn onClick={onBack} style={{ background:C.violet }}>← Retour aux réglages</Btn>
          </div>
        ) : (
          <>
            <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10 }}>
              <span style={{ fontSize:18 }}>💬</span>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>
                Décrivez votre problème en détail. Votre email de compte sera joint automatiquement pour qu'on puisse vous répondre.
              </p>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Sujet *</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {SUBJECTS.map(s=>(
                  <button key={s} onClick={()=>setSubject(s)} style={{ padding:"9px 14px", borderRadius:20, border:`2px solid ${subject===s?C.violet:C.border}`, background:subject===s?`${C.violet}20`:"transparent", color:subject===s?C.violet:C.textSub, fontWeight:subject===s?700:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Votre message *</label>
              <textarea
                value={message} onChange={e=>setMessage(e.target.value)}
                placeholder="Décrivez votre problème ou question en détail : ce qui s'est passé, quand, sur quel écran…"
                style={{ width:"100%", padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:140, boxSizing:"border-box", outline:"none", color:C.text, background:"#0D1B3E", lineHeight:1.6 }}
              />
              <div style={{ textAlign:"right", color:C.textMuted, fontSize:11, marginTop:4 }}>{message.length} caractères</div>
            </div>

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

            <Btn full onClick={handleSend} disabled={loading} style={{ fontSize:15, padding:"16px", background:C.violet, boxShadow:`0 8px 24px ${C.violet}44` }}>
              {loading ? "Envoi en cours…" : "📤 Envoyer ma demande"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ── RÉGLAGES ──────────────────────────────────────────────────────
function SettingsScreen({ role, onNavigate, onBack, onLogout }) {
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName]   = useState("");

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if(!user) return;
      setUserEmail(user.email||"");
      supabase.from("profiles").select("prenom,nom").eq("id",user.id).single()
        .then(({ data:p })=>{ if(p) setUserName(`${p.prenom||""} ${p.nom||""}`.trim()); });
    });
  },[]);

  const sections = [
    {
      title:"Mon compte",
      items:[
        { icon:"👤", label:"Nom", value:userName||"—" },
        { icon:"✉️", label:"Email", value:userEmail||"—" },
        { icon:"🔑", label:"Changer le mot de passe", action:()=>onNavigate("reset_password"), chevron:true },
      ]
    },
    {
      title:"Application",
      items:[
        { icon:"🔔", label:"Notifications", value:"Activées" },
        { icon:"🌍", label:"Langue", value:"Français" },
        { icon:"📄", label:"CGU & Politique de confidentialité", action:()=>onNavigate("legal","cgu"), chevron:true },
      ]
    },
    {
      title:"Aide",
      items:[
        { icon:"🎧", label:"Contacter le support", action:()=>onNavigate("contact_support"), chevron:true, highlight:true },
        { icon:"📖", label:"FAQ", action:()=>{}, chevron:true },
      ]
    },
  ];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>⚙️ Réglages</h2>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Avatar */}
        <div style={{ display:"flex", alignItems:"center", gap:14, background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:20, border:`1px solid ${C.border}` }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:`${C.violet}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
            {role==="prestataire"?"👷":"🏢"}
          </div>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:16 }}>{userName||"Mon compte"}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{userEmail}</div>
            <div style={{ color:C.violet, fontSize:11, fontWeight:600, marginTop:4 }}>{role==="prestataire"?"Prestataire":"Client"} JOBER</div>
          </div>
        </div>

        {sections.map(section=>(
          <div key={section.title} style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:C.textMuted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:8, paddingLeft:4 }}>{section.title}</div>
            <div style={{ background:"#0D1B3E", borderRadius:r, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              {section.items.map((item, i)=>(
                <div key={item.label} onClick={item.action} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", borderBottom:i<section.items.length-1?`1px solid ${C.border}`:"none", cursor:item.action?"pointer":"default", background:item.highlight?`${C.violet}08`:"transparent" }}>
                  <div style={{ width:32, height:32, borderRadius:10, background:item.highlight?`${C.violet}20`:`${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{item.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, color:item.highlight?C.violet:C.text, fontSize:14 }}>{item.label}</div>
                    {item.value && <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>{item.value}</div>}
                  </div>
                  {item.chevron && <span style={{ color:C.textMuted, fontSize:16 }}>›</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Déconnexion */}
        <button onClick={onLogout} style={{ width:"100%", padding:"15px", borderRadius:r, border:`1px solid #F25E5E44`, background:"#F25E5E12", color:"#F25E5E", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit", marginTop:8 }}>
          🚪 Se déconnecter
        </button>

        <p style={{ textAlign:"center", color:C.textMuted, fontSize:11, marginTop:20 }}>JOBER v1.0 · Tous droits réservés</p>
      </div>
    </div>
  );
}

// ── RESET PASSWORD ────────────────────────────────────────────────
function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);

  const handleReset = async () => {
    if(!password || password.length < 6){ setError("Minimum 6 caractères"); return; }
    if(password !== confirm){ setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true); setError("");
    const { error:err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if(err){ setError(err.message); return; }
    setDone(true);
    setTimeout(()=>onDone(), 2000);
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32 }}>
      {done ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
          <div style={{ fontWeight:800, color:C.text, fontSize:20, marginBottom:8 }}>Mot de passe mis à jour !</div>
          <div style={{ color:C.textSub, fontSize:14 }}>Redirection en cours…</div>
        </div>
      ) : (
        <div style={{ width:"100%", maxWidth:380 }}>
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔑</div>
            <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:"0 0 8px", fontFamily:font.display }}>Nouveau mot de passe</h2>
            <p style={{ color:C.textSub, fontSize:14, margin:0 }}>Choisissez un mot de passe sécurisé</p>
          </div>
          <Input label="Nouveau mot de passe" type="password" placeholder="••••••••" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
          <Input label="Confirmer le mot de passe" type="password" placeholder="••••••••" icon="🔒" value={confirm} onChange={e=>setConfirm(e.target.value)} />
          {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
          <Btn full onClick={handleReset} disabled={loading} style={{ fontSize:15, padding:"16px", background:C.violet, boxShadow:`0 8px 24px ${C.violet}44` }}>
            {loading ? "Mise à jour…" : "Confirmer →"}
          </Btn>
        </div>
      )}
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────
// Refonte hi-fi v12 — Playfair Display + DM Sans, palette navy/violet
function HomeScreen({ onNavigate }) {
  const [urgentMode, setUrgentMode] = useState(false);
  const { isDesktop } = useResponsive();
  const tier = getCashbackTier(INITIAL_WALLET.missionsThisMonth);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - INITIAL_WALLET.missionsThisMonth : 0;
  const tierProgress = nextTier
    ? Math.min(100, Math.max(8, (INITIAL_WALLET.missionsThisMonth / nextTier.min) * 100))
    : 100;

  const violetLite = "#A29BFE";

  return (
    <div style={{
      minHeight:"100%",
      background:`radial-gradient(120% 80% at 50% -10%, ${C.bgCard} 0%, ${C.bg} 55%, #06101F 100%)`,
      paddingBottom:90,
      position:"relative",
      overflow:"hidden",
    }}>
      {/* Halo violet ambiant */}
      <div style={{ position:"absolute", top:-120, right:-90, width:340, height:340, borderRadius:"50%", background:`radial-gradient(circle, ${C.violet}38 0%, transparent 65%)`, pointerEvents:"none" }} />

      {/* ── Header ── */}
      <div style={{ padding:"54px 22px 8px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:38, height:38, borderRadius:12,
            background:`linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontFamily:font.display, fontWeight:800, fontSize:18, color:"#fff",
            boxShadow:`0 8px 22px ${C.violetGlow}`,
          }}>J</div>
          <div>
            <div style={{ fontSize:11, color:C.textMuted, letterSpacing:0.4, lineHeight:1.2 }}>Bonjour 👋</div>
            <div style={{ fontSize:14, fontWeight:600, color:C.text, lineHeight:1.2 }}>Camille L.</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>onNavigate("notifications")} style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, cursor:"pointer", position:"relative", color:C.text }}>
            🔔
            <div style={{ position:"absolute", top:7, right:7, width:8, height:8, borderRadius:"50%", background:C.accent, boxShadow:`0 0 6px ${C.accent}`, border:`2px solid ${C.bg}` }} />
          </button>
          <button onClick={()=>onNavigate("favorites")} style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, cursor:"pointer", color:C.text }}>❤️</button>
          <button onClick={()=>onNavigate("bo_login")} style={{ width:30, height:30, borderRadius:8, background:"transparent", border:"none", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, cursor:"pointer", opacity:0.25, marginTop:4 }}>⚙️</button>
        </div>
      </div>

      {/* ── Hero title ── */}
      <div style={{ padding:"14px 22px 18px", position:"relative", zIndex:2 }}>
        <h1 style={{
          fontFamily:font.display, fontSize:34, lineHeight:1.05, fontWeight:700,
          margin:0, color:C.text, letterSpacing:-0.5,
        }}>
          Trouvez le <em style={{ fontStyle:"italic", color:violetLite, fontWeight:600 }}>talent</em><br/>
          qu'il vous faut.
        </h1>
        <p style={{ marginTop:10, fontSize:13, color:C.textSub, lineHeight:1.5, maxWidth:300 }}>
          Plus de {PROVIDERS.length} prestataires vérifiés, prêts à intervenir aujourd'hui.
        </p>
      </div>

      {/* ── Search bar ── */}
      <div style={{ padding:"0 22px 18px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("search_filters")} style={{
          background:"rgba(255,255,255,0.04)",
          border:`1px solid ${C.borderStrong}`,
          borderRadius:r, padding:"13px 16px",
          display:"flex", alignItems:"center", gap:12,
          backdropFilter:"blur(12px)", cursor:"pointer",
        }}>
          <span style={{ fontSize:15, opacity:0.6 }}>🔍</span>
          <span style={{ flex:1, color:C.textSub, fontSize:13.5 }}>Rechercher un service, un talent…</span>
          <span style={{ padding:"4px 10px", borderRadius:8, background:`${C.violet}25`, color:violetLite, fontSize:11, fontWeight:600, letterSpacing:0.3 }}>Filtres</span>
        </div>
      </div>

      {isLaunchPhase() && <div style={{ padding:"0 22px" }}><LaunchBadge context="home" /></div>}

      {/* ── Wallet hero ── */}
      <div style={{ padding:"0 22px 18px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("cashback")} style={{
          position:"relative", borderRadius:22, padding:"20px 20px 18px",
          background:`linear-gradient(135deg, ${C.violetDark} 0%, #2D2173 55%, #1a1556 100%)`,
          overflow:"hidden", cursor:"pointer",
          boxShadow:`0 20px 40px -20px ${C.violetGlow}, 0 1px 0 rgba(255,255,255,0.05) inset`,
          border:`1px solid rgba(255,255,255,0.08)`,
        }}>
          <div style={{ position:"absolute", right:-30, top:-30, width:160, height:160, borderRadius:"50%", border:`1px solid rgba(255,255,255,0.08)` }} />
          <div style={{ position:"absolute", right:-60, top:-60, width:240, height:240, borderRadius:"50%", border:`1px solid rgba(255,255,255,0.05)` }} />
          <div style={{ position:"absolute", right:18, top:18, fontSize:28 }}>💎</div>

          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
            <span style={{ fontSize:10, letterSpacing:1.6, textTransform:"uppercase", color:"rgba(255,255,255,0.55)", fontWeight:600 }}>Cashback wallet</span>
            <span style={{ padding:"2px 7px", borderRadius:999, background:`${C.accentGold}25`, color:C.accentGold, fontSize:9, fontWeight:700, letterSpacing:0.5 }}>{tier.icon} {tier.label.toUpperCase()}</span>
          </div>

          <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:14 }}>
            <span style={{ fontFamily:font.display, fontSize:38, fontWeight:700, color:"#fff", letterSpacing:-1, lineHeight:1 }}>
              {INITIAL_WALLET.balance.toFixed(2).replace(".", ",")}
            </span>
            <span style={{ fontSize:18, color:"rgba(255,255,255,0.7)", fontWeight:500 }}>€</span>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
            <div style={{ flex:1 }}>
              <div style={{ height:5, borderRadius:99, background:"rgba(255,255,255,0.12)", overflow:"hidden" }}>
                <div style={{ width:`${tierProgress}%`, height:"100%", borderRadius:99, background:`linear-gradient(90deg, ${violetLite}, ${C.accentGold})` }} />
              </div>
              <div style={{ marginTop:6, fontSize:11, color:"rgba(255,255,255,0.6)" }}>
                {nextTier
                  ? <>{missionsToNext} mission{missionsToNext>1?"s":""} avant le palier <strong style={{ color:C.accentGold }}>{nextTier.label}</strong></>
                  : <>Vous êtes au palier maximum 🎉</>}
              </div>
            </div>
            <div style={{
              background:"rgba(255,255,255,0.12)",
              border:`1px solid rgba(255,255,255,0.18)`,
              color:"#fff", fontSize:12, fontWeight:600,
              padding:"9px 14px", borderRadius:11,
            }}>Utiliser →</div>
          </div>
        </div>
      </div>

      {/* ── Mode urgence ── */}
      <div style={{ padding:"0 22px 24px", position:"relative", zIndex:2 }}>
        <div onClick={()=>setUrgentMode(!urgentMode)} style={{
          background: urgentMode ? `${C.accent}14` : "rgba(255,255,255,0.025)",
          border:`1px solid ${urgentMode ? `${C.accent}55` : C.border}`,
          borderRadius:r, padding:"12px 14px",
          display:"flex", alignItems:"center", gap:12, cursor:"pointer",
          transition:"all .25s",
          boxShadow: urgentMode ? `0 0 24px ${C.accent}22` : "none",
        }}>
          <div style={{ width:36, height:36, borderRadius:10, background: urgentMode ? `${C.accent}25` : `${C.accent}12`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🚨</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, fontSize:13.5, color: urgentMode ? C.accent : C.text, lineHeight:1.2 }}>Mode urgence</div>
            <div style={{ fontSize:11.5, color:C.textSub, marginTop:2 }}>
              {urgentMode ? "Actif — sous 1h · +2€ HT/h" : "Trouvez un prestataire dans l’heure"}
            </div>
          </div>
          <div style={{ width:42, height:24, borderRadius:99, padding:2, background: urgentMode ? C.accent : "rgba(255,255,255,0.1)", border:`1px solid ${urgentMode ? `${C.accent}55` : C.border}`, transition:"all .25s", flexShrink:0 }}>
            <div style={{ width:18, height:18, borderRadius:"50%", background:"#fff", transform:`translateX(${urgentMode ? 18 : 0}px)`, transition:"transform .25s", boxShadow:"0 2px 6px rgba(0,0,0,0.3)" }} />
          </div>
        </div>
      </div>

      {/* ── Secteurs ── */}
      <div style={{ padding:"0 22px 26px", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:12 }}>
          <h3 style={{ margin:0, fontFamily:font.display, fontWeight:700, fontSize:20, color:C.text, lineHeight:1.1, letterSpacing:-0.2 }}>Secteurs</h3>
          <span onClick={()=>onNavigate("catalogue")} style={{ fontSize:12, color:violetLite, fontWeight:600, cursor:"pointer" }}>Voir tout ›</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isDesktop?"repeat(8,1fr)":"repeat(4,1fr)", gap:10 }}>
          {SECTORS.map(s=>(
            <div key={s.id} onClick={()=>onNavigate("sector_detail",s)}
              className="card-hover"
              style={{
                background:"rgba(255,255,255,0.025)",
                border:`1px solid ${C.border}`,
                borderRadius:r, padding:"12px 6px 10px",
                textAlign:"center", cursor:"pointer",
                position:"relative", overflow:"hidden",
              }}>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:34, background:`radial-gradient(60% 100% at 50% 0%, ${s.color}25 0%, transparent 100%)`, pointerEvents:"none" }} />
              <div style={{ fontSize:22, marginBottom:4, position:"relative" }}>{s.icon}</div>
              <div style={{ fontSize:9.5, fontWeight:600, color:C.text, letterSpacing:0.3, textTransform:"uppercase", lineHeight:1.2, position:"relative" }}>{s.label}</div>
              <div style={{ fontSize:9, color:C.textMuted, marginTop:2, position:"relative" }}>{s.count} pros</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Top prestataires ── */}
      <div style={{ padding:"0 22px 22px", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:12 }}>
          <div>
            <h3 style={{ margin:0, fontFamily:font.display, fontWeight:700, fontSize:20, color:C.text, lineHeight:1.1, letterSpacing:-0.2 }}>Top prestataires</h3>
            <div style={{ fontSize:11.5, color:C.textSub, marginTop:3 }}>Disponibles maintenant</div>
          </div>
          <span onClick={()=>onNavigate("search_filters")} style={{ fontSize:12, color:violetLite, fontWeight:600, cursor:"pointer" }}>Voir tout ›</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
          {PROVIDERS.filter(p=>p.available).slice(0,3).map((p,i)=>(
            <div key={p.id} onClick={()=>onNavigate("profile",p)}
              className="card-hover"
              style={{
                background:`linear-gradient(135deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`,
                border:`1px solid ${C.border}`,
                borderRadius:16, padding:13,
                display:"flex", gap:12, alignItems:"center",
                cursor:"pointer", position:"relative", overflow:"hidden",
                animationDelay:`${i*0.08}s`,
              }}>
              <div style={{
                width:54, height:54, borderRadius:r,
                background:`linear-gradient(135deg, ${p.color}40, ${p.color}15)`,
                border:`1px solid ${p.color}40`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:26, flexShrink:0, position:"relative",
              }}>
                {p.avatar}
                <div style={{ position:"absolute", bottom:-2, right:-2, width:14, height:14, borderRadius:"50%", background:C.success, border:`2.5px solid ${C.bgCard}`, boxShadow:`0 0 8px ${C.success}` }} />
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                  <span style={{ fontSize:14, fontWeight:600, color:C.text, lineHeight:1.2 }}>{p.name}</span>
                  <span style={{ fontSize:11, color:violetLite }}>✓</span>
                </div>
                <div style={{ fontSize:11.5, color:C.textSub, marginBottom:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.jobTitle||p.role}</div>
                <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:C.textMuted }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                    <Stars rating={p.rating} size={10}/>
                    <span style={{ color:C.text, fontWeight:600 }}>{p.rating}</span>
                    <span>({p.reviews})</span>
                  </span>
                  <span>·</span>
                  <span>{p.distance}</span>
                </div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontFamily:font.display, fontWeight:700, fontSize:15, color:violetLite, lineHeight:1 }}>{p.hourlyRate}</div>
                <div style={{ fontSize:10, color:C.textMuted, marginTop:4 }}>{p.responseTime}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Parrainage ── */}
      <div style={{ padding:"0 22px 28px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("referral")} style={{
          background:`linear-gradient(120deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`,
          border:`1px solid ${C.accentGold}30`,
          borderRadius:16, padding:"15px 16px",
          display:"flex", alignItems:"center", gap:13,
          cursor:"pointer", overflow:"hidden", position:"relative",
        }}>
          <div style={{ position:"absolute", right:-10, bottom:-15, fontSize:80, opacity:0.06 }}>🎁</div>
          <div style={{ width:42, height:42, borderRadius:12, background:`${C.accentGold}1F`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎁</div>
          <div style={{ flex:1, position:"relative" }}>
            <div style={{ fontSize:13.5, fontWeight:600, color:C.text, marginBottom:2 }}>
              Parrainez & gagnez <span style={{ color:C.accentGold }}>50 €</span>
            </div>
            <div style={{ fontSize:11.5, color:C.textSub }}>Pour vous et votre filleul</div>
          </div>
          <span style={{ color:C.accentGold, fontSize:18 }}>›</span>
        </div>
      </div>
    </div>
  );
}


// ── CATALOGUE style Uber Eats ─────────────────────────────────────
function CatalogueScreen({ onNavigate }) {
  const [activeSector, setActiveSector] = useState(null);
  const sectorRefs = useRef({});

  const scrollToSector = (id) => {
    setActiveSector(id);
    sectorRefs.current[id]?.scrollIntoView({ behavior:"smooth", block:"start" });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Tous les secteurs</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Trouvez le professionnel qu'il vous faut</p>
      </div>

      {/* Sticky sector pills */}
      <div style={{ position:"sticky", top:0, background:C.bg, zIndex:50, borderBottom:`1px solid ${C.border}`, padding:"10px 0" }}>
        <div style={{ display:"flex", gap:8, overflowX:"auto", padding:"0 18px", scrollbarWidth:"none" }}>
          {SECTORS.map(s=>(
            <button key={s.id} onClick={()=>scrollToSector(s.id)} style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px", borderRadius:20, border:"none", cursor:"pointer", whiteSpace:"nowrap", background:activeSector===s.id?`linear-gradient(135deg,${C.violet},${C.indigo})`:C.offWhite, color:activeSector===s.id?C.white:C.gray, fontWeight:activeSector===s.id?700:500, fontSize:12, fontFamily:"inherit", transition:"all 0.2s", flexShrink:0 }}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sections par secteur */}
      <div style={{ padding:"8px 0" }}>
        {SECTORS.map(sector=>{
          const sectorProviders = PROVIDERS.filter(p=>p.sector===sector.id);
          return (
            <div key={sector.id} ref={el=>sectorRefs.current[sector.id]=el} style={{ marginBottom:8 }}>
              {/* Bannière secteur */}
              <div style={{ margin:"0 18px 14px", background:`linear-gradient(135deg,${sector.color}44,${sector.color}22)`, borderRadius:18, padding:"20px 18px", position:"relative", overflow:"hidden", cursor:"pointer" }} onClick={()=>onNavigate("sector_detail",sector)}>
                <div style={{ position:"absolute", right:-10, top:-10, fontSize:64, opacity:0.25 }}>{sector.banner}</div>
                <div style={{ position:"absolute", right:14, bottom:14, fontSize:36 }}>{sector.icon}</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:18 }}>{sector.label}</div>
                <div style={{ color:C.textSub, fontSize:13, marginTop:4 }}>{sector.count} prestataires · {sectorProviders.filter(p=>p.available).length} disponibles maintenant</div>
                <div style={{ marginTop:10 }}><Badge color={sector.color} small>Voir tous les métiers →</Badge></div>
              </div>

              {/* Prestataires du secteur — style carte Uber Eats */}
              {sectorProviders.length > 0 ? (
                <div style={{ display:"flex", gap:12, overflowX:"auto", padding:"0 18px 16px", scrollbarWidth:"none" }}>
                  {sectorProviders.map(p=>(
                    <div key={p.id} onClick={()=>onNavigate("profile",p)} style={{ background:"#0D1B3E", borderRadius:16, minWidth:160, maxWidth:160, cursor:"pointer", boxShadow:"0 4px 20px rgba(0,0,0,0.5)", overflow:"hidden", flexShrink:0 }}>
                      <div style={{ height:90, background:`linear-gradient(135deg,${p.color}33,${p.color}11)`, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                        <span style={{ fontSize:36 }}>{p.avatar}</span>
                        {p.available
                          ? <div style={{ position:"absolute", top:8, right:8, background:C.success, borderRadius:8, padding:"2px 7px", fontSize:10, color:C.white, fontWeight:700 }}>Dispo</div>
                          : <div style={{ position:"absolute", top:8, right:8, background:C.gray, borderRadius:8, padding:"2px 7px", fontSize:10, color:C.white, fontWeight:700 }}>Occupé</div>}
                      </div>
                      <div style={{ padding:"10px" }}>
                        <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:2 }}>{p.name}</div>
                        <div style={{ color:C.textSub, fontSize:11, marginBottom:4 }}>{p.role}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:6 }}>
                          <Stars rating={p.rating} size={11} />
                          <span style={{ color:C.textSub, fontSize:10 }}>{p.rating}</span>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ color:C.violet, fontWeight:800, fontSize:12 }}>{p.hourlyRate} HT</span>
                          <span style={{ color:C.textSub, fontSize:10 }}>{p.distance}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Voir plus */}
                  <div onClick={()=>onNavigate("sector_detail",sector)} style={{ background:`${sector.color}15`, border:`2px dashed ${sector.color}44`, borderRadius:16, minWidth:120, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, cursor:"pointer", padding:"20px 10px", flexShrink:0 }}>
                    <span style={{ fontSize:22 }}>{sector.icon}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:sector.color, textAlign:"center" }}>Voir tout {sector.label}</span>
                  </div>
                </div>
              ) : (
                <div style={{ margin:"0 18px 16px", background:"#0D1B3E", borderRadius:r, padding:"16px", textAlign:"center", color:C.textSub, fontSize:13 }}>
                  Aucun prestataire pour ce secteur pour l'instant
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── HOOK : vrais prestataires depuis Supabase ─────────────────────
function useProviders() {
  const [providers, setProviders] = useState(PROVIDERS);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const { data, error } = await supabase
        .from("prestataires")
        .select(`id, available, bio, note_moy, nb_missions, ville, profiles(prenom, nom, avatar_url), metiers(sector, job_title, tarif_net, niveau, certifs)`);

      if(error || !data?.length){ setLoading(false); return; }

      const AVATAR_POOL = ["👷","👩‍🔧","🧑‍🍳","👩‍⚕️","🧑‍🏫","👮","🧹","🏗️"];
      const normalized = data
        .filter(p => (p.metiers||[]).length > 0)
        .map((p, i) => {
          const metier = p.metiers[0];
          return {
            id: p.id,
            name: `${p.profiles?.prenom||""} ${p.profiles?.nom||""}`.trim() || "Prestataire",
            jobTitle: metier.job_title,
            tarifNet: metier.tarif_net || 12,
            rateNum:  metier.tarif_net || 12,
            avatar:   AVATAR_POOL[i % AVATAR_POOL.length],
            color:    "#7C6FE0",
            rating:   p.note_moy  || 4.8,
            reviews:  p.nb_missions || 0,
            skills:   (p.metiers||[]).map(m=>m.job_title),
            experience: "Nouveau",
            available: p.available,
            sector:   metier.sector,
            bio:      p.bio || "",
            distance: "À proximité",
            responseTime: "~5 min",
            missions: p.nb_missions || 0,
            role:     metier.job_title,
            ville:    p.ville || "",
            isReal:   true,
          };
        });

      // Vrais prestataires en premier, puis les fictifs en fallback
      setProviders([...normalized, ...PROVIDERS]);
      setLoading(false);
    })();
  },[]);

  return { providers, loading };
}

// ── SECTOR DETAIL ─────────────────────────────────────────────────
function SectorDetailScreen({ sector, onNavigate }) {
  const s = sector || SECTORS[0];
  const [selectedJob, setSelectedJob] = useState(null);
  const [urgentMode, setUrgentMode] = useState(false);
  const SURCHARGE = 2;
  const { providers } = useProviders();

  const allServices = (METIERS[s.id]||[]).map(name => {
    const count = providers.filter(p=>p.sector===s.id && p.jobTitle===name).length;
    const availCount = providers.filter(p=>p.sector===s.id && p.jobTitle===name && p.available).length;
    const tarif = METIERS_TARIFS[s.id]?.[name];
    const base = tarif ? prixClient(tarif.default, s.id) : 12;
    const price = urgentMode ? base + SURCHARGE : base;
    return { name, rate:`${price.toFixed(2).replace(".",",")} € HT/h`, count, availCount, base, price };
  });

  const filteredProviders = providers.filter(p =>
    p.sector===s.id && (!selectedJob || p.jobTitle===selectedJob)
  );

  const basePrice = selectedJob
    ? (() => { const t = METIERS_TARIFS[s.id]?.[selectedJob]; return t ? prixClient(t.default, s.id) : 12; })()
    : 0;
  const urgentPrice = basePrice + SURCHARGE;

  // Bouton urgence réutilisable
  const UrgentToggle = ({ showBeforeJob=false }) => (
    <div onClick={()=>setUrgentMode(!urgentMode)} style={{
      background: urgentMode ? C.accent : C.white,
      border: `2px solid ${urgentMode ? C.accent : C.grayLight}`,
      borderRadius:r, padding:"13px 16px",
      marginBottom: showBeforeJob ? 20 : 16,
      cursor:"pointer", display:"flex", alignItems:"center", gap:12,
      transition:"all 0.25s",
      boxShadow: urgentMode ? `0 6px 20px ${C.accent}44` : "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      <span style={{ fontSize:22 }}>🚨</span>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:800, color:urgentMode?C.white:C.accent, fontSize:14, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          Mode Urgence
          <span style={{
            background: urgentMode ? "rgba(255,255,255,0.25)" : `${C.accent}18`,
            color: urgentMode ? C.white : C.accent,
            borderRadius:6, padding:"1px 8px", fontSize:11, fontWeight:700,
          }}>+{SURCHARGE},00 € HT/h</span>
        </div>
        <div style={{ fontSize:12, color:urgentMode?"rgba(255,255,255,0.75)":C.gray, marginTop:2 }}>
          {urgentMode
            ? "Actif — le 1er prestataire disponible accepte la mission"
            : "Prestataire disponible dans l’heure · Surcoût affiché au récapitulatif"}
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
        <span style={{ fontWeight:700, color:urgentMode?C.white:C.accent, fontSize:11 }}>{urgentMode?"Actif ✓":"Activer"}</span>
        <div style={{ width:40, height:22, borderRadius:11, background:urgentMode?"rgba(255,255,255,0.3)":C.grayLight, position:"relative", transition:"all 0.25s" }}>
          <div style={{ width:18, height:18, borderRadius:"50%", background:urgentMode?C.white:C.gray, position:"absolute", top:2, left:urgentMode?20:2, transition:"left 0.25s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>

      {/* Header secteur */}
      <div style={{ background:`linear-gradient(135deg,${s.color}88,${s.color}44)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px", position:"relative", overflow:"hidden" }}>
        <button onClick={()=>{ onNavigate("catalogue"); }} style={{ background:"rgba(255,255,255,0.3)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ position:"absolute", right:-10, bottom:-20, fontSize:100, opacity:0.15 }}>{s.banner}</div>
        <div style={{ fontSize:40, marginBottom:8 }}>{s.icon}</div>
        <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>{s.label}</h2>
        <p style={{ color:"rgba(255,255,255,0.75)", fontSize:14, margin:0 }}>
          {providers.filter(p=>p.sector===s.id).length} prestataires · {providers.filter(p=>p.sector===s.id&&p.available).length} disponibles · <strong>Prix HT</strong>
        </p>
      </div>

      <div style={{ padding:"20px 18px" }}>

        {/* ── PAS DE MÉTIER SÉLECTIONNÉ ── */}
        {!selectedJob && <>
          {/* Bouton urgence AVANT le choix du métier */}
          <UrgentToggle showBeforeJob={true} />

          {/* Bouton publier une mission */}
          <div onClick={()=>onNavigate("mission_request", s)} style={{ background:`linear-gradient(135deg,${C.violet}22,${C.indigo}15)`, border:`2px solid ${C.violet}55`, borderRadius:r+4, padding:"16px 18px", marginBottom:18, cursor:"pointer", display:"flex", alignItems:"center", gap:14, transition:"all 0.2s" }}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.violet}
            onMouseLeave={e=>e.currentTarget.style.borderColor=`${C.violet}55`}
          >
            <div style={{ width:44, height:44, borderRadius:12, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>📢</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Publier une mission</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Diffusez à tous les prestataires disponibles · Choisissez parmi ceux qui acceptent</div>
            </div>
            <span style={{ color:C.violet, fontSize:20, fontWeight:300 }}>›</span>
          </div>

          <h4 style={{ margin:"0 0 12px", color:C.text, fontWeight:800 }}>Ou choisissez directement un prestataire</h4>

          {allServices.map((svc,i) => (
            <div key={i} onClick={()=>svc.availCount>0 && setSelectedJob(svc.name)} style={{
              background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:8,
              display:"flex", alignItems:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)",
              cursor:svc.availCount>0?"pointer":"default", opacity:svc.count===0?0.5:1,
              transition:"transform 0.15s",
              border:`1.5px solid ${urgentMode && svc.availCount>0 ? C.accent+"44" : "transparent"}`,
            }}
              onMouseEnter={e=>{ if(svc.availCount>0) e.currentTarget.style.transform="translateX(4px)"; }}
              onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{svc.name}</div>
                <div style={{ display:"flex", gap:8, marginTop:3, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ color:urgentMode?C.accent:C.violet, fontWeight:700, fontSize:12 }}>{svc.rate}</span>
                  {urgentMode && <span style={{ color:C.textSub, fontSize:11, textDecoration:"line-through" }}>{`${svc.base.toFixed(2).replace(".",",")} €`}</span>}
                  <span style={{ color:C.textSub, fontSize:11 }}>· {svc.count} prestataire{svc.count>1?"s":""} ({svc.availCount} dispo)</span>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                <Badge color={svc.availCount>0?C.success:C.gray} small>{svc.availCount>0?"Disponible":"Indisponible"}</Badge>
                {svc.availCount>0 && <span style={{ fontSize:11, color:urgentMode?C.accent:C.violet, fontWeight:700 }}>Voir {svc.availCount} →</span>}
              </div>
            </div>
          ))}
        </>}

        {/* ── MÉTIER SÉLECTIONNÉ ── */}
        {selectedJob && <>

          {/* Lien retour */}
          <div onClick={()=>{ setSelectedJob(null); setUrgentMode(false); }} style={{ display:"flex", alignItems:"center", gap:6, color:C.violet, fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:14 }}>
            ← Tous les métiers
          </div>

          {/* Bouton urgence APRÈS le choix du métier */}
          <UrgentToggle showBeforeJob={false} />

          {/* Récap métier sélectionné */}
          <div style={{ background:urgentMode?`${C.accent}10`:C.offWhite, border:`1.5px solid ${urgentMode?C.accent+"44":C.grayLight}`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:urgentMode?6:0 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>{selectedJob}</span>
                {urgentMode && <Badge color={C.accent} small>🚨 Urgence</Badge>}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:urgentMode?C.accent:C.violet, fontSize:14 }}>{urgentPrice.toFixed(2).replace(".",",")} € HT/h</div>
                {urgentMode && <div style={{ color:C.textSub, fontSize:11, textDecoration:"line-through" }}>{basePrice.toFixed(2).replace(".",",")} € HT/h</div>}
              </div>
            </div>
            {urgentMode && (
              <div style={{ background:`${C.accent}15`, borderRadius:8, padding:"8px 10px", fontSize:12, color:C.text, lineHeight:1.5 }}>
                ⚡ <strong>Surcoût urgence : +{SURCHARGE},00 € HT/h</strong> — visible et accepté lors du récapitulatif de réservation avant paiement.
              </div>
            )}
          </div>

          {/* ── MODE URGENCE ACTIF → pas de liste ── */}
          {urgentMode ? (
            <div style={{ background:"#0D1B3E", borderRadius:18, padding:"28px 20px", textAlign:"center", boxShadow:"0 4px 24px rgba(0,0,0,0.5)", border:`2px solid ${C.accent}33` }}>
              <div style={{ fontSize:52, marginBottom:12 }}>⚡</div>
              <h3 style={{ color:C.text, fontSize:18, fontWeight:800, margin:"0 0 8px" }}>Mission envoyée à tous les prestataires</h3>
              <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, margin:"0 auto 20px", maxWidth:280 }}>
                Tous les <strong style={{ color:C.text }}>{filteredProviders.filter(p=>p.available).length} prestataires disponibles</strong> en <strong style={{ color:C.text }}>{selectedJob}</strong> reçoivent votre demande simultanément. <strong style={{ color:C.accent }}>Le premier qui accepte assure la mission.</strong>
              </p>

              {/* Détail surcoût */}
              <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:20, textAlign:"left" }}>
                <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:6 }}>💶 Détail du tarif urgence</div>
                {[
                  ["Tarif standard", `${basePrice.toFixed(2).replace(".",",")} € HT/h`],
                  ["Surcoût urgence", `+${SURCHARGE},00 € HT/h`],
                  ["Tarif urgence total", `${urgentPrice.toFixed(2).replace(".",",")} € HT/h`],
                ].map(([l,v],i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:i<2?`1px solid ${C.grayLight}`:"none" }}>
                    <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight: i===2?800:600, color: i===2?C.accent:C.text }}>{v}</span>
                  </div>
                ))}
                <div style={{ fontSize:11, color:C.textSub, marginTop:6 }}>Le surcoût sera affiché et confirmé avant le paiement.</div>
              </div>

              <Btn full onClick={()=>onNavigate("booking", { ...filteredProviders[0], urgentMode:true, urgentPrice, jobTitle:selectedJob })} style={{ fontSize:15, padding:"16px", marginBottom:10 }}>
                ⚡ Envoyer la mission maintenant
              </Btn>
              <button onClick={()=>setUrgentMode(false)} style={{ background:"none", border:"none", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Annuler — choisir un prestataire manuellement
              </button>
            </div>

          ) : (
            /* ── MODE NORMAL → liste des prestataires ── */
            <>
              {filteredProviders.length === 0 ? (
                <div style={{ background:"#0D1B3E", borderRadius:r, padding:"24px", textAlign:"center", border:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
                  <div style={{ fontWeight:700, color:C.text, marginBottom:4 }}>Aucun prestataire disponible</div>
                  <div style={{ color:C.textSub, fontSize:13 }}>Revenez plus tard ou activez le mode urgence</div>
                </div>
              ) : filteredProviders.map(p => {
                const hasCv = !!CV_DATA[p.id];
                return (
                  <div key={p.id} style={{
                    background:"#0D1B3E", borderRadius:r, marginBottom:11,
                    border:`1px solid ${C.border}`,
                    opacity: p.available ? 1 : 0.6,
                    overflow:"hidden",
                  }}
                    className="card-hover"
                  >
                    {/* Infos principales */}
                    <div onClick={()=>onNavigate("profile", p)} style={{ padding:"14px", display:"flex", gap:12, alignItems:"center", cursor:"pointer" }}>
                      <div style={{ width:52, height:52, borderRadius:r, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0, position:"relative" }}>
                        {p.avatar}
                        {p.available && <div style={{ position:"absolute", bottom:1, right:1, width:12, height:12, borderRadius:"50%", background:C.success, border:`2px solid #0D1B3E` }} />}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:2 }}>
                          <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</span>
                          {hasCv && <Badge color={C.violet} small>CV</Badge>}
                        </div>
                        <div style={{ color:C.textSub, fontSize:12, marginBottom:3 }}>{p.jobTitle}</div>
                        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                          <Stars rating={p.rating} size={12}/>
                          <span style={{ color:C.textSub, fontSize:11 }}>{p.rating} · {p.distance} · {p.responseTime}</span>
                        </div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{p.hourlyRate}</div>
                        <div style={{ marginTop:4, fontSize:11, fontWeight:600, color:p.available?C.success:C.textMuted }}>
                          {p.available ? "● Dispo" : "○ Occupé"}
                        </div>
                      </div>
                    </div>

                    {/* Boutons actions */}
                    <div style={{ display:"flex", gap:0, borderTop:`1px solid ${C.border}` }}>
                      {hasCv && (
                        <button onClick={()=>onNavigate("cv", p)} style={{ flex:1, padding:"10px", background:"transparent", border:"none", borderRight:`1px solid ${C.border}`, color:C.violet, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                          📄 Voir CV
                        </button>
                      )}
                      <button onClick={()=>onNavigate("profile", p)} style={{ flex:1, padding:"10px", background:"transparent", border:"none", borderRight: p.available ? `1px solid ${C.border}` : "none", color:C.textSub, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        👤 Profil
                      </button>
                      {p.available && (
                        <button onClick={()=>onNavigate("booking", p)} style={{ flex:1, padding:"10px", background:`${C.violet}15`, border:"none", color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                          📅 Réserver
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Note HT */}
          <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", marginTop:8, fontSize:11, color:C.textSub, textAlign:"center" }}>
            💡 Tous les prix sont <strong>hors taxes (HT)</strong>. TVA 20% selon votre statut fiscal.
          </div>
        </>}

      </div>
    </div>
  );
}
// ── SEARCH + FILTRES ──────────────────────────────────────────────
function SearchFiltersScreen({ onNavigate }) {
  const [search,setSearch]=useState("");
  const [ratingMin,setRatingMin]=useState(0);
  const [tarifMax,setTarifMax]=useState(50);
  const [distMax,setDistMax]=useState(20);
  const [dispoNow,setDispoNow]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [favs,setFavs]=useState([]);
  const { providers, loading } = useProviders();

  const filtered = providers.filter(p=>{
    if(search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.role.toLowerCase().includes(search.toLowerCase()) && !p.jobTitle?.toLowerCase().includes(search.toLowerCase())) return false;
    if(p.rating < ratingMin) return false;
    if(p.rateNum > tarifMax) return false;
    if(dispoNow && !p.available) return false;
    return true;
  });

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 14px", fontFamily:font.display }}>Rechercher</h2>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)" }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, métier, secteur…" style={{ width:"100%", padding:"13px 44px 13px 40px", borderRadius:13, border:"none", fontSize:14, fontFamily:"inherit", background:"rgba(255,255,255,0.15)", color:C.white, outline:"none", boxSizing:"border-box" }} />
          <button onClick={()=>setShowFilters(!showFilters)} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:showFilters?C.white:"rgba(255,255,255,0.2)", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:12, color:showFilters?C.violet:C.white, fontWeight:700 }}>⚙️</button>
        </div>
      </div>

      {showFilters && (
        <div style={{ background:"#0D1B3E", padding:"16px 18px", borderBottom:`1px solid ${C.border}`, boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>Filtres</span>
            <button onClick={()=>{setRatingMin(0);setTarifMax(50);setDispoNow(false);}} style={{ background:"none", border:"none", color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer" }}>Réinitialiser</button>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>Note minimum : {ratingMin > 0 ? `${ratingMin}★` : "Toutes"}</label>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              {[0,4,4.5,4.8].map(r=><button key={r} onClick={()=>setRatingMin(r)} style={{ padding:"6px 12px", borderRadius:20, border:"none", cursor:"pointer", background:ratingMin===r?C.violet:C.grayLight, color:ratingMin===r?C.white:C.text, fontSize:12, fontWeight:ratingMin===r?700:500, fontFamily:"inherit" }}>{r===0?"Toutes":`${r}+★`}</button>)}
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>Tarif max : {tarifMax} €/h</label>
            <input type="range" min={10} max={50} value={tarifMax} onChange={e=>setTarifMax(+e.target.value)} style={{ width:"100%", marginTop:6, accentColor:C.violet }} />
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setDispoNow(!dispoNow)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${dispoNow?C.success:C.grayLight}`, background:dispoNow?`${C.success}15`:C.white, color:dispoNow?C.success:C.gray, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>● Dispo maintenant</button>
          </div>
        </div>
      )}

      <div style={{ padding:"14px 18px" }}>
        <p style={{ color:C.textSub, fontSize:12, marginBottom:14 }}>{filtered.length} prestataire(s) trouvé(s)</p>
        {filtered.map(p=>(
          <div key={p.id} style={{ background:"#0D1B3E", borderRadius:18, padding:"16px", marginBottom:12, boxShadow:"0 4px 20px rgba(0,0,0,0.5)", cursor:"pointer" }}>
            <div style={{ display:"flex", gap:12, marginBottom:10 }}>
              <div onClick={()=>onNavigate("profile",p)} style={{ width:56, height:56, borderRadius:17, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>{p.avatar}</div>
              <div style={{ flex:1 }} onClick={()=>onNavigate("profile",p)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div><div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div><div style={{ color:C.textSub, fontSize:12 }}>{p.role}</div></div>
                  <div style={{ textAlign:"right" }}><div style={{ color:C.violet, fontWeight:800, fontSize:14 }}>{p.hourlyRate} HT</div><div style={{ fontSize:11, color:p.available?C.success:C.accent, fontWeight:600 }}>{p.available?"● Dispo":"○ Occupé"}</div></div>
                </div>
                <div style={{ marginTop:3, display:"flex", gap:6, alignItems:"center" }}><Stars rating={p.rating} /><span style={{ color:C.textSub, fontSize:11 }}>{p.rating} · {p.distance} · {p.responseTime}</span></div>
              </div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
              {p.skills.slice(0,3).map(sk=><Badge key={sk} color={p.color} small>{sk}</Badge>)}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setFavs(f=>f.includes(p.id)?f.filter(x=>x!==p.id):[...f,p.id])} style={{ padding:"9px 14px", borderRadius:12, border:`2px solid ${favs.includes(p.id)?C.accent:C.grayLight}`, background:favs.includes(p.id)?`${C.accent}15`:C.white, cursor:"pointer", fontSize:16 }}>{favs.includes(p.id)?"❤️":"🤍"}</button>
              <button onClick={()=>onNavigate("chat",p)} style={{ flex:1, padding:"9px", borderRadius:12, border:`2px solid ${C.violet}`, background:"transparent", color:C.violet, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>💬 Message</button>
              {p.available && <button onClick={()=>onNavigate("profile",p)} style={{ flex:2, padding:"9px", borderRadius:12, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Réserver →</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PROFILE ───────────────────────────────────────────────────────
// ── CV PRESTATAIRE ────────────────────────────────────────────────
function CVScreen({ provider, onBack, onNavigate }) {
  const p = provider || PROVIDERS[0];
  const cv = CV_DATA[p.id];

  if(!cv) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:16 }}>📄</div>
      <h3 style={{ color:C.text, fontSize:18, fontWeight:700, margin:"0 0 10px", fontFamily:font.display }}>CV non disponible</h3>
      <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:260, margin:"0 auto 28px" }}>
        {p.name} n'a pas encore renseigné son CV sur JOBER.
      </p>
      <Btn onClick={onBack} variant="ghost">← Retour au profil</Btn>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${p.color}55,${p.color}22)`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-40, right:-40, width:200, height:200, borderRadius:"50%", background:`${p.color}15`, pointerEvents:"none" }} />
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:18 }}>← Retour</button>
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
          <div style={{ width:60, height:60, borderRadius:18, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, border:"2px solid rgba(255,255,255,0.2)" }}>{p.avatar}</div>
          <div>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:700, margin:"0 0 3px", fontFamily:font.display }}>{p.name}</h2>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{cv.titre}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Badge color="rgba(255,255,255,0.9)" small>⭐ {p.rating}/5</Badge>
          <Badge color="rgba(255,255,255,0.9)" small>📋 {p.missions} missions</Badge>
          <Badge color="rgba(255,255,255,0.9)" small>🕐 {p.experience}</Badge>
        </div>
      </div>

      <div style={{ padding:"20px 18px" }}>

        {/* Accroche */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>👤</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Profil</span>
          </div>
          <p style={{ color:C.textSub, fontSize:13, lineHeight:1.7, margin:0 }}>{cv.accroche}</p>
        </div>

        {/* Expériences */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>💼</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Expériences professionnelles</span>
          </div>
          {cv.experiences.map((e,i) => (
            <div key={i} style={{ paddingBottom:i<cv.experiences.length-1?16:0, marginBottom:i<cv.experiences.length-1?16:0, borderBottom:i<cv.experiences.length-1?`1px solid ${C.border}`:"none", position:"relative", paddingLeft:18 }}>
              {/* Timeline dot */}
              <div style={{ position:"absolute", left:0, top:4, width:8, height:8, borderRadius:"50%", background:C.violet, boxShadow:`0 0 8px ${C.violet}88` }} />
              {i < cv.experiences.length-1 && (
                <div style={{ position:"absolute", left:3, top:12, width:2, height:"calc(100% - 8px)", background:`${C.violet}30` }} />
              )}
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{e.poste}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", margin:"3px 0 6px" }}>
                <span style={{ color:C.violet, fontSize:12, fontWeight:600 }}>{e.entreprise}</span>
                <span style={{ color:C.textMuted, fontSize:11, background:"rgba(255,255,255,0.05)", padding:"2px 8px", borderRadius:6 }}>{e.periode}</span>
              </div>
              <p style={{ color:C.textSub, fontSize:12, margin:0, lineHeight:1.6 }}>{e.desc}</p>
            </div>
          ))}
        </div>

        {/* Formations */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.accentGold}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🎓</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Formations & Diplômes</span>
          </div>
          {cv.formations.map((f,i) => (
            <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:i<cv.formations.length-1?12:0, paddingBottom:i<cv.formations.length-1?12:0, borderBottom:i<cv.formations.length-1?`1px solid ${C.border}`:"none" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${C.accentGold}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>📜</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{f.diplome}</div>
                <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{f.etablissement}</div>
              </div>
              <span style={{ color:C.textMuted, fontSize:11, fontWeight:600, flexShrink:0 }}>{f.annee}</span>
            </div>
          ))}
        </div>

        {/* Infos complémentaires */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:12 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.success}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>ℹ️</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Informations</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>🌍</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Langues</div>
                <div style={{ color:C.text, fontSize:13 }}>{cv.langues.join(" · ")}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>🚗</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Mobilité</div>
                <div style={{ color:C.text, fontSize:13 }}>{cv.permis}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>💼</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Compétences clés</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:4 }}>
                  {p.skills.map(sk=><Badge key={sk} color={p.color} small>{sk}</Badge>)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Btn full onClick={()=>onNavigate("booking", p)} style={{ fontSize:15, padding:"16px" }}>📅 Réserver {p.name}</Btn>
      </div>
    </div>
  );
}

function ProfileScreen({ provider, onNavigate, onBack }) {
  const p = provider||PROVIDERS[0];
  const [fav,setFav]=useState(false);
  const cv = CV_DATA[p.id];
  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg, #0A1628, ${p.color}99)`, padding:"48px 22px 36px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
          <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>
          <button onClick={()=>setFav(!fav)} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", cursor:"pointer", fontSize:18 }}>{fav?"❤️":"🤍"}</button>
        </div>
        <div style={{ display:"flex", gap:16, alignItems:"flex-end", marginBottom:18 }}>
          <div style={{ width:76, height:76, borderRadius:22, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:38, border:"3px solid rgba(255,255,255,0.25)", position:"relative" }}>
            {p.avatar}
            {p.available && <div style={{ position:"absolute", bottom:2, right:2, width:14, height:14, borderRadius:"50%", background:C.success, border:"2px solid white" }} />}
          </div>
          <div>
            <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 3px" }}>{p.name}</h2>
            <p style={{ color:"rgba(255,255,255,0.7)", margin:"0 0 8px", fontSize:13 }}>{p.role}</p>
            <Stars rating={p.rating} size={14} /> <span style={{ color:"rgba(255,255,255,0.7)", fontSize:12, marginLeft:5 }}>{p.rating} · {p.reviews} avis · {p.distance}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[{v:p.experience,l:"Expérience"},{v:p.missions,l:"Missions"},{v:p.responseTime,l:"Réponse"}].map((s,i)=>(
            <div key={i} style={{ background:"rgba(255,255,255,0.14)", borderRadius:12, padding:"10px 8px", flex:1, textAlign:"center" }}>
              <div style={{ color:C.white, fontWeight:800, fontSize:13 }}>{s.v}</div>
              <div style={{ color:"rgba(255,255,255,0.55)", fontSize:10 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding:"22px 18px" }}>

        {/* Bouton CV si disponible */}
        {cv && (
          <div onClick={()=>onNavigate("cv",p)} style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}40`, borderRadius:r, padding:"13px 16px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12, transition:"all 0.2s" }}
            className="card-hover">
            <div style={{ width:40, height:40, borderRadius:11, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>📄</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Voir le CV complet</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>Expériences · Formations · Langues</div>
            </div>
            <span style={{ color:C.violet, fontSize:16, fontWeight:300 }}>›</span>
          </div>
        )}

        {[
          { title:"À propos", content:<p style={{ color:C.textSub, lineHeight:1.7, margin:0, fontSize:14 }}>{p.bio}</p> },
          { title:"Compétences", content:<div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>{p.skills.map(sk=><Badge key={sk} color={p.color}>{sk}</Badge>)}</div> },
          { title:"Tarif", content:<><div style={{ fontSize:30, fontWeight:800, color:C.violet }}>{p.hourlyRate} HT</div><div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Taux horaire · Auto-entrepreneur</div></> },
        ].map(card=>(
          <div key={card.title} style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>{card.title}</h4>
            {card.content}
          </div>
        ))}
        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={()=>onNavigate("chat",p)} style={{ flex:1, padding:"14px 10px", fontSize:14 }}>💬 Message</Btn>
          {p.available && <Btn onClick={()=>onNavigate("booking",p)} style={{ flex:2, padding:"14px 10px", fontSize:14 }}>📅 Réserver</Btn>}
        </div>
      </div>
    </div>
  );
}

// ── BOOKING ───────────────────────────────────────────────────────
function BookingScreen({ provider, onNavigate, onBack }) {
  const p = provider||PROVIDERS[0];
  const isUrgent = p.urgentMode || false;
  const urgentPrice = p.urgentPrice || null;
  const [step,setStep]=useState(1);
  const [payMethod,setPayMethod]=useState("carte");
  const [hours,setHours]=useState(isUrgent ? 4 : 8);
  const [missionType, setMissionType] = useState("single");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [description, setDescription] = useState("");
  const [breakMin, setBreakMin] = useState(isUrgent ? 0 : 20); // 20min par défaut car hours=8 au démarrage

  // Auto-ajuster la pause minimum si on monte à ≥7h et que la pause est à 0
  useEffect(() => {
    if(hours >= 7 && breakMin < 20) setBreakMin(20);
  }, [hours]);

  const tarifHoraire = isUrgent && urgentPrice ? urgentPrice : (p?.rateNum || prixClient(p?.tarifNet||14, p?.sector||'divers'));

  // Calcul du nombre de jours et total
  const nbJours = (() => {
    if(missionType==="single" || !startDate || !endDate) return 1;
    const d1 = new Date(startDate);
    const d2 = new Date(endDate);
    const diff = Math.ceil((d2 - d1) / (1000*60*60*24)) + 1;
    return diff > 0 ? diff : 1;
  })();

  const totalParJour = (tarifHoraire * hours).toFixed(0);
  const totalGlobal = (tarifHoraire * hours * nbJours).toFixed(0);

  // Urgence
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  const urgentStartTime = now.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });
  const urgentStartDate = now.toLocaleDateString("fr-FR");

  // Formatage date lisible
  const formatDate = (d) => {
    if(!d) return "—";
    return new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <StepHeader step={step} total={4}
        title={["Détails mission","Localisation","Paiement","Confirmation"][step-1]}
        onBack={step===1?onBack:()=>setStep(s=>s-1)} />
      <div style={{ padding:"22px 18px" }}>

        {step===1 && <>
          {/* Carte prestataire */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", marginBottom:16, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:44, height:44, borderRadius:12, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{p.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle||p.role} · {tarifHoraire.toFixed(2)} € HT/h</div>
            </div>
            {isUrgent && <Badge color={C.accent} small>🚨 Urgence</Badge>}
          </div>

          {isLaunchPhase() && <LaunchBadge context="booking" />}

          {/* Bandeau urgence */}
          {isUrgent && (
            <div style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}44`, borderRadius:r, padding:"12px 14px", marginBottom:16, display:"flex", gap:10 }}>
              <span style={{ fontSize:20, flexShrink:0 }}>⚡</span>
              <div>
                <div style={{ fontWeight:700, color:C.accent, fontSize:13, marginBottom:3 }}>Mode Urgence actif</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>Date et heure automatiques · <strong style={{ color:C.text }}>Aujourd'hui à {urgentStartTime}</strong> · Seule la durée est modifiable</div>
              </div>
            </div>
          )}

          {!isUrgent && <>
            {/* Toggle mission simple / plage de dates */}
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:8, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Type de mission</label>
              <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4, border:`1px solid ${C.border}` }}>
                {[
                  { id:"single", icon:"📅", label:"Date unique"      },
                  { id:"range",  icon:"📆", label:"Plage de dates"   },
                ].map(t => (
                  <button key={t.id} onClick={()=>setMissionType(t.id)} style={{
                    flex:1, padding:"10px 8px", border:"none", borderRadius:10, cursor:"pointer",
                    background: missionType===t.id ? C.violet : "transparent",
                    color: missionType===t.id ? C.white : C.textSub,
                    fontWeight: missionType===t.id ? 700 : 500,
                    fontSize:13, fontFamily:"inherit",
                    boxShadow: missionType===t.id ? `0 4px 14px ${C.violet}44` : "none",
                    transition:"all 0.2s",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>
                    <span>{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>

            {missionType === "single" ? (
              /* ── Date unique ── */
              <div style={{ display:"flex", gap:10, marginBottom:16 }}>
                <div style={{ flex:2 }}>
                  <Input label="Date de début" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
                </div>
                <div style={{ flex:1 }}>
                  <Input label="Heure" type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} />
                </div>
              </div>
            ) : (
              /* ── Plage de dates ── */
              <>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:12, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Période de la mission</label>

                  <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Du</label>
                      <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", alignItems:"flex-end", paddingBottom:12, color:C.textMuted, fontSize:18, fontWeight:300 }}>→</div>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Au</label>
                      <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} min={startDate}
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                  </div>

                  {/* Heure de début quotidienne */}
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Heure de début (chaque jour)</label>
                      <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                  </div>

                  {/* Résumé plage sélectionnée */}
                  {startDate && endDate && nbJours > 0 && (
                    <div style={{ marginTop:14, background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontWeight:700, color:C.violet, fontSize:13, marginBottom:4 }}>
                        📅 {nbJours} jour{nbJours>1?"s":" "} · {formatDate(startDate)} → {formatDate(endDate)}
                      </div>
                      <div style={{ color:C.textSub, fontSize:12 }}>
                        {hours}h/jour × {nbJours} jour{nbJours>1?"s":""} = <strong style={{ color:C.text }}>{hours*nbJours}h au total</strong>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>}

          {/* Mode urgence — date grisée */}
          {isUrgent && (
            <div style={{ display:"flex", gap:10, marginBottom:16, opacity:0.45 }}>
              <div style={{ flex:2 }}>
                <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, textTransform:"uppercase" }}>Date <span style={{ color:C.accent }}>· Auto</span></label>
                <div style={{ padding:"13px 14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, color:C.textMuted, background:"rgba(255,255,255,0.03)" }}>🔒 {urgentStartDate}</div>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, textTransform:"uppercase" }}>Heure <span style={{ color:C.accent }}>· Auto</span></label>
                <div style={{ padding:"13px 14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, color:C.textMuted, background:"rgba(255,255,255,0.03)" }}>🔒 {urgentStartTime}</div>
              </div>
            </div>
          )}

          {/* Durée par jour */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:10, fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>
              {isUrgent ? "⏱️ Durée (mode urgence)" : missionType==="range" ? "Heures par jour" : "Durée de la mission"}
            </label>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:22, fontWeight:800, color:C.violet }}>{hours}h{missionType==="range"?" / jour":""}</span>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:isUrgent?C.accent:C.violet, fontSize:16 }}>{totalParJour} € HT{missionType==="range"?"/jour":""}</div>
                {missionType==="range" && nbJours > 1 && (
                  <div style={{ color:C.accentGold, fontSize:12, fontWeight:700 }}>Total : {totalGlobal} € HT ({nbJours}j)</div>
                )}
              </div>
            </div>
            <input type="range" min={1} max={12} value={hours} onChange={e=>setHours(+e.target.value)}
              style={{ width:"100%", accentColor: isUrgent ? C.accent : C.violet }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textMuted, marginTop:4 }}>
              <span>1h min</span><span>12h max</span>
            </div>
            {isUrgent && (
              <div style={{ marginTop:10, background:`${C.accentGold}15`, borderRadius:8, padding:"8px 10px", fontSize:11, color:C.text }}>
                💶 Tarif urgence : <strong>{tarifHoraire.toFixed(2)} € HT/h</strong> (tarif standard + 2,00 € surcoût urgence)
              </div>
            )}
          </div>

          {/* Temps de pause */}
          {!isUrgent && (
            <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:`${C.accentGold}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>☕</div>
                <label style={{ fontSize:13, fontWeight:700, color:C.text }}>Temps de pause</label>
                {hours >= 7 && (
                  <Badge color={C.accentGold} small>⚠️ Obligatoire ≥7h</Badge>
                )}
              </div>

              {/* Alerte légale si ≥ 7h */}
              {hours >= 7 && (
                <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}40`, borderRadius:10, padding:"9px 12px", marginBottom:12, fontSize:12, color:C.text, lineHeight:1.6 }}>
                  ⚖️ <strong>Obligation légale</strong> — À partir de 7h de travail consécutives, une pause de <strong style={{ color:C.accentGold }}>minimum 20 minutes</strong> est obligatoire (Code du travail, Art. L3121-16).
                </div>
              )}

              {/* Choix de pause */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {[
                  { val:0,   label:"Aucune",    disabled: hours >= 7 },
                  { val:20,  label:"20 min",    disabled: false      },
                  { val:30,  label:"30 min",    disabled: false      },
                  { val:45,  label:"45 min",    disabled: false      },
                  { val:60,  label:"1 heure",   disabled: false      },
                ].map(opt => {
                  const isSelected = breakMin === opt.val;
                  const isForced = opt.val === 0 && hours >= 7;
                  return (
                    <button
                      key={opt.val}
                      onClick={()=>{ if(!isForced) setBreakMin(opt.val); }}
                      disabled={isForced}
                      style={{
                        padding:"8px 14px", borderRadius:100, fontSize:12, fontWeight:600,
                        cursor: isForced ? "not-allowed" : "pointer",
                        fontFamily:"inherit", border:"none", transition:"all 0.2s",
                        background: isSelected ? (hours>=7 && opt.val===0 ? C.danger+"22" : C.violet) : "rgba(255,255,255,0.06)",
                        color: isSelected ? (hours>=7 && opt.val===0 ? C.danger : C.white) : C.textSub,
                        opacity: isForced ? 0.4 : 1,
                        boxShadow: isSelected && opt.val > 0 ? `0 4px 12px ${C.violet}44` : "none",
                      }}
                    >{opt.label}</button>
                  );
                })}
              </div>

              {/* Résumé temps effectif */}
              {breakMin > 0 && (
                <div style={{ marginTop:12, display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 12px", background:"rgba(255,255,255,0.04)", borderRadius:10 }}>
                  <div style={{ fontSize:12, color:C.textSub }}>
                    Temps de travail effectif : <strong style={{ color:C.text }}>{hours}h - {breakMin}min = {Math.floor((hours*60 - breakMin)/60)}h{(hours*60-breakMin)%60>0?` ${(hours*60-breakMin)%60}min`:""}</strong>
                  </div>
                  <div style={{ fontSize:12, color:C.violet, fontWeight:700 }}>
                    {(tarifHoraire * (hours - breakMin/60)).toFixed(0)} € HT
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Description de la mission</label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)}
              placeholder="Décrivez la mission en détail…"
              style={{ width:"100%", padding:"13px 15px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", background:"#112240", color:C.text, lineHeight:1.6 }} />
          </div>

          <Btn full onClick={()=>setStep(2)} style={{ fontSize:15, padding:"16px" }}>Continuer →</Btn>
        </>}

        {step===2 && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, overflow:"hidden", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ background:`linear-gradient(135deg,${C.navy}18,${C.indigo}18)`, height:150, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
              <div style={{ fontSize:44 }}>🗺️</div>
              <div style={{ position:"absolute", bottom:10, right:10 }}><div style={{ background:C.violet, borderRadius:20, padding:"5px 10px", color:C.white, fontSize:11, fontWeight:700 }}>📍 Paris 75001</div></div>
            </div>
            <div style={{ padding:14 }}><div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Lieu de la mission</div><div style={{ color:C.textSub, fontSize:12 }}>12 rue de Rivoli, 75001</div></div>
          </div>
          <Input label="Adresse" placeholder="12 rue de Rivoli" icon="📍" />
          <Input label="Ville" placeholder="Paris" />
          <Input label="Code postal" placeholder="75001" />
          <Input label="Informations complémentaires" placeholder="Digicode, étage, instructions…" />
          <Btn full onClick={()=>setStep(3)}>Confirmer l'adresse →</Btn>
        </>}

        {step===3 && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:14, fontWeight:800 }}>💳 Mode de paiement</h4>
            {[{id:"carte",label:"Carte bancaire",icon:"💳",sub:"Visa, Mastercard, Amex"},{id:"apple",label:"Apple Pay",icon:"",sub:"Paiement rapide"},{id:"virement",label:"Virement bancaire",icon:"🏦",sub:"Délai 1-2 jours"}].map(m=>(
              <div key={m.id} onClick={()=>setPayMethod(m.id)} style={{ border:`1px solid ${payMethod===m.id?C.violet:C.border}`, borderRadius:r, padding:"13px 14px", marginBottom:8, cursor:"pointer", display:"flex", gap:12, alignItems:"center", background:payMethod===m.id?`${C.violet}15`:"#112240", transition:"all 0.2s" }}>
                <span style={{ fontSize:22 }}>{m.icon}</span>
                <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.label}</div><div style={{ color:C.textSub, fontSize:11 }}>{m.sub}</div></div>
                <div style={{ width:18, height:18, borderRadius:"50%", border:`1px solid ${payMethod===m.id?C.violet:C.border}`, background:payMethod===m.id?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>{payMethod===m.id && <div style={{ width:8, height:8, borderRadius:"50%", background:C.white }} />}</div>
              </div>
            ))}
            {payMethod==="carte" && <div style={{ marginTop:12 }}><Input label="Numéro de carte" placeholder="4242 4242 4242 4242" icon="💳" /><div style={{ display:"flex", gap:10 }}><div style={{ flex:1 }}><Input label="Expiration" placeholder="MM/AA" /></div><div style={{ flex:1 }}><Input label="CVV" placeholder="•••" /></div></div></div>}
          </div>

          {/* Récapitulatif */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:15, fontWeight:700 }}>Récapitulatif</h4>
            {[
              ["Prestataire", p.name],
              ["Métier", p.jobTitle||p.role],
              ["Date", isUrgent ? `Aujourd’hui — ${urgentStartDate}` : missionType==="range" && startDate && endDate ? `${formatDate(startDate)} → ${formatDate(endDate)}` : formatDate(startDate)],
              ["Heure de début", isUrgent ? `${urgentStartTime} (~30 min)` : startTime||"—"],
              ...(missionType==="range" && nbJours>1 ? [["Durée totale", `${nbJours} jours × ${hours}h = ${hours*nbJours}h`]] : [["Durée", `${hours}h`]]),
              ...(!isUrgent && breakMin>0 ? [["Temps de pause", `${breakMin} min${hours>=7?" (obligatoire)":""}`]] : []),
              ...(!isUrgent && breakMin>0 ? [["Temps effectif", `${Math.floor((hours*60-breakMin)/60)}h${(hours*60-breakMin)%60>0?` ${(hours*60-breakMin)%60}min`:""}`]] : []),
              ["Tarif HT/h", `${tarifHoraire.toFixed(2)} €${isUrgent?" (urgence)":""}`],
              ...(isUrgent ? [["dont surcoût urgence","+2,00 € HT/h"]] : []),
              ["Lieu","Paris 75001"],
            ].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:700, color: l.includes("surcoût")?C.accent:C.text, fontSize:13 }}>{v}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 0 4px", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontWeight:700, color:C.text, fontSize:15 }}>Total HT {missionType==="range" && nbJours>1 && <span style={{ color:C.textMuted, fontWeight:400, fontSize:12 }}>({nbJours} jours)</span>}</span>
              <span style={{ fontWeight:800, color:isUrgent?C.accent:C.violet, fontSize:18 }}>{totalGlobal} €</span>
            </div>

            {/* Cashback gagné sur cette mission */}
            {(() => {
              const tier = getCashbackTier(INITIAL_WALLET.missionsThisMonth);
              const earned = calcCashback(Number(totalGlobal), INITIAL_WALLET.missionsThisMonth);
              return (
                <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0 0", alignItems:"center" }}>
                  <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                    <span style={{ fontSize:15 }}>💰</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:C.success }}>Cashback gagné</div>
                      <div style={{ fontSize:10, color:C.textMuted }}>Palier {tier.icon} {tier.label} · {(tier.rate*100).toFixed(0)}% du total</div>
                    </div>
                  </div>
                  <span style={{ fontWeight:800, color:C.success, fontSize:15 }}>+{earned.toFixed(2)} €</span>
                </div>
              );
            })()}
          </div>

          {/* Solde cashback disponible */}
          {INITIAL_WALLET.balance >= 10 && (
            <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"13px 15px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontWeight:700, color:C.success, fontSize:13, marginBottom:2 }}>💰 Cashback disponible</div>
                <div style={{ color:C.textSub, fontSize:12 }}>Vous avez {INITIAL_WALLET.balance.toFixed(2)} € à utiliser</div>
              </div>
              <button style={{ background:`${C.success}25`, border:`1px solid ${C.success}44`, borderRadius:10, padding:"7px 14px", color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Appliquer
              </button>
            </div>
          )}

          {isUrgent && (
            <div style={{ background:`${C.accent}10`, border:`1px solid ${C.accent}30`, borderRadius:r, padding:"11px 14px", marginBottom:14, fontSize:12, color:C.text, lineHeight:1.6 }}>
              🚨 <strong>Mission urgente</strong> — Le premier prestataire disponible qui accepte assure la mission. Intervention prévue dans l'heure.
            </div>
          )}

          <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}25`, borderRadius:r, padding:"11px 14px", marginBottom:18, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
            🔒 Paiement sécurisé — libéré uniquement après validation mutuelle de la mission
          </div>
          <Btn full onClick={()=>onNavigate("stripe_pay",{ amount: totalGlobal, hours })} style={{ background: isUrgent?C.accent:undefined }}>
            {isUrgent?"⚡":"✅"} Confirmer & payer {totalGlobal} €
          </Btn>
        </>}

        {step===4 && (
          <div style={{ textAlign:"center", paddingTop:10 }}>
            {/* Cashback gagné — confirmation */}
            {(() => {
              const earned = calcCashback(Number(totalGlobal), INITIAL_WALLET.missionsThisMonth);
              const tier = getCashbackTier(INITIAL_WALLET.missionsThisMonth);
              return (
                <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"16px", marginBottom:20, display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${C.success}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>💰</div>
                  <div style={{ flex:1, textAlign:"left" }}>
                    <div style={{ fontWeight:700, color:C.success, fontSize:14, marginBottom:2 }}>+{earned.toFixed(2)} € de cashback gagné !</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>Crédit dans 24h · Palier {tier.icon} {tier.label} ({(tier.rate*100).toFixed(0)}%)</div>
                  </div>
                </div>
              );
            })()}
            <div style={{ fontSize:60, marginBottom:14 }}>{isUrgent?"⚡":"✅"}</div>
            <h3 style={{ color:C.text, fontSize:21, fontWeight:700, marginBottom:6, fontFamily:font.display }}>
              {isUrgent ? "Mission urgente envoyée !" : "Réservation confirmée !"}
            </h3>
            <p style={{ color:C.textSub, fontSize:14, marginBottom:24, lineHeight:1.7 }}>
              {isUrgent
                ? <>Votre mission a été envoyée à tous les prestataires disponibles. Le paiement de <strong style={{ color:C.accent }}>{totalGlobal} €</strong> est sécurisé en escrow.</>
                : <>Le paiement de <strong style={{ color:C.violet }}>{totalGlobal} €</strong> est sécurisé et sera libéré après validation mutuelle.</>
              }
            </p>
            <div style={{ background:"#0D1B3E", borderRadius:18, padding:"18px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", textAlign:"left" }}>
              <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:14, fontWeight:800 }}>📋 Prochaines étapes</h4>
              {(isUrgent
                ? ["Un prestataire accepte la mission","Vous recevez une notification immédiate","Suivez son arrivée en temps réel","Validation + paiement libéré"]
                : ["Le prestataire confirme sa venue","Suivez son arrivée en temps réel","Mission effectuée → Validation mutuelle","Paiement libéré automatiquement"]
              ).map((s,i)=>(
                <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:i<3?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:`${isUrgent?C.accent:C.violet}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:isUrgent?C.accent:C.violet, flexShrink:0 }}>{i+1}</div>
                  <span style={{ color:C.textSub, fontSize:13 }}>{s}</span>
                </div>
              ))}
            </div>
            <Btn full onClick={()=>onNavigate("tracking",provider)}>📍 Suivre en temps réel</Btn>
            <button onClick={()=>onNavigate("home")} style={{ background:"none", border:"none", color:C.textSub, cursor:"pointer", marginTop:12, fontSize:13 }}>Retour à l'accueil</button>
          </div>
        )}
      </div>
    </div>
  );
}


// ── SUIVI EN TEMPS RÉEL ───────────────────────────────────────────

// ── MISSION PENDING — Attente d'acceptation prestataire ──────────
// Le client attend que le prestataire accepte ou refuse (max 1h)
// En démo : compte à rebours accéléré (60 secondes = 1 heure)
function MissionPendingScreen({ provider, amount, hours, onAccepted, onCancelled, onBack }) {
  const p = provider || PROVIDERS[0];

  // Compte à rebours : 60s en démo = 1h en prod
  const DEMO_SECONDS = 60;
  const [secsLeft, setSecsLeft]   = useState(DEMO_SECONDS);
  const [phase, setPhase]         = useState("waiting"); // waiting | accepted | refused | timeout
  const [prestaAction, setPrestaAction] = useState(null); // simulate presta response after 8s

  // Simuler la réponse du prestataire après 8 secondes (pour la démo)
  useEffect(() => {
    const autoAccept = setTimeout(() => {
      // 80% de chance d'acceptation en démo
      setPrestaAction("accept");
    }, 8000);
    return () => clearTimeout(autoAccept);
  }, []);

  // Compte à rebours 1h
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { setPhase("timeout"); clearInterval(t); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Appliquer la décision du prestataire dès qu'elle arrive
  useEffect(() => {
    if (prestaAction === "accept" && phase === "waiting") setPhase("accepted");
    if (prestaAction === "refuse" && phase === "waiting") setPhase("refused");
  }, [prestaAction, phase]);

  // Formatage du compte à rebours (simule 1h → 0)
  const formatTimer = (secs) => {
    const totalRealSecs = Math.round((secs / DEMO_SECONDS) * 3600);
    const h = Math.floor(totalRealSecs / 3600);
    const m = Math.floor((totalRealSecs % 3600) / 60);
    const s = totalRealSecs % 60;
    if (h > 0) return h + "h " + String(m).padStart(2,"0") + "min";
    if (m > 0) return String(m).padStart(2,"0") + "min " + String(s).padStart(2,"0") + "s";
    return String(s).padStart(2,"0") + "s";
  };

  const pct = Math.round((secsLeft / DEMO_SECONDS) * 100);
  const circumference = 2 * Math.PI * 54;
  const dash = (pct / 100) * circumference;

  // ── PHASE : EN ATTENTE ─────────────────────────────────────────
  if (phase === "waiting") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", paddingBottom:40, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:"1px solid "+C.border, padding:"52px 22px 24px" }}>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>⏳ En attente de confirmation</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>Demande envoyée à {p.name}</p>
      </div>

      <div style={{ padding:"28px 22px", flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>

        {/* Compte à rebours circulaire */}
        <div style={{ position:"relative", width:140, height:140, marginBottom:24 }}>
          <svg width={140} height={140} style={{ transform:"rotate(-90deg)" }}>
            <circle cx={70} cy={70} r={54} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
            <circle cx={70} cy={70} r={54} fill="none"
              stroke={secsLeft < 12 ? C.accent : C.violet}
              strokeWidth={8}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - dash}
              strokeLinecap="round"
              style={{ transition:"stroke-dashoffset 0.9s linear, stroke 0.3s" }}
            />
          </svg>
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center" }}>
            <div style={{ fontSize:22, fontWeight:800, color:secsLeft<12?C.accent:C.text }}>{formatTimer(secsLeft)}</div>
            <div style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>restant</div>
          </div>
        </div>

        {/* Carte prestataire */}
        <div style={{ width:"100%", background:"#0D1B3E", border:"1px solid "+C.border, borderRadius:r, padding:"16px", marginBottom:18, display:"flex", gap:14, alignItems:"center" }}>
          <div style={{ width:52, height:52, borderRadius:14, background:p.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{p.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle||p.role}</div>
            <div style={{ display:"flex", gap:6, marginTop:6, alignItems:"center" }}>
              <span style={{ color:C.accentGold, fontSize:13 }}>★</span>
              <span style={{ color:C.text, fontSize:13, fontWeight:700 }}>{p.rating}</span>
              <span style={{ color:C.textSub, fontSize:12 }}>· {p.missions} missions</span>
              <span style={{ color:C.textSub, fontSize:12 }}>· {p.responseTime}</span>
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:800, color:C.success, fontSize:15 }}>{amount} €</div>
            <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>{hours}h</div>
          </div>
        </div>

        {/* Statut animé */}
        <div style={{ width:"100%", background:C.violet+"10", border:"1px solid "+C.violet+"30", borderRadius:r, padding:"14px 16px", marginBottom:18 }}>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:C.violet, boxShadow:"0 0 8px "+C.violet, flexShrink:0, animation:"pulse 1.5s ease-in-out infinite" }} />
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Notification envoyée à {p.name}</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Il dispose d’une heure pour accepter ou refuser la mission</div>
            </div>
          </div>
        </div>

        {/* Info paiement sécurisé */}
        <div style={{ width:"100%", background:"rgba(255,255,255,0.03)", border:"1px solid "+C.border, borderRadius:r, padding:"12px 14px", marginBottom:24, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          🔒 <strong style={{ color:C.text }}>Votre paiement est sécurisé</strong> — Les fonds sont bloqués en escrow mais ne seront débités que si {p.name} accepte la mission. En cas de refus ou de timeout, vous êtes intégralement remboursé.
        </div>

        {/* Bouton annuler */}
        <button onClick={onBack} style={{ width:"100%", padding:"14px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
          Annuler la demande
        </button>

        {/* BOUTONS SIMULÉS PRESTATAIRE — démo uniquement */}
        <div style={{ width:"100%", marginTop:20, padding:"16px", background:"rgba(255,165,0,0.06)", border:"1px dashed rgba(255,165,0,0.3)", borderRadius:r }}>
          <div style={{ fontSize:11, color:C.accentGold, fontWeight:700, marginBottom:10, textAlign:"center", letterSpacing:0.5 }}>
            🎭 SIMULATION — Vue prestataire
          </div>
          <div style={{ fontSize:11, color:C.textSub, textAlign:"center", marginBottom:12 }}>
            Dans l’app réelle, {p.name} reçoit une notification push sur son téléphone
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setPrestaAction("accept")} style={{ flex:1, padding:"12px", border:"none", borderRadius:r, background:C.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              ✅ Accepter (prestataire)
            </button>
            <button onClick={()=>setPrestaAction("refuse")} style={{ flex:1, padding:"12px", border:"1px solid "+C.accent+"44", borderRadius:r, background:C.accent+"10", color:C.accent, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              ✗ Refuser (prestataire)
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  // ── PHASE : ACCEPTÉE ───────────────────────────────────────────
  if (phase === "accepted") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.success+"20", border:"3px solid "+C.success, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>✅</div>
        <h2 style={{ color:C.success, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Mission acceptée !</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:28 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> a accepté votre demande. Le contrat est en cours de génération.
        </p>
        <div style={{ background:"#0D1B3E", border:"1px solid "+C.border, borderRadius:r, padding:"14px 16px", marginBottom:24, textAlign:"left" }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Prestataire</span>
            <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{p.name}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Durée</span>
            <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{hours}h</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Total</span>
            <span style={{ fontWeight:800, color:C.success, fontSize:15 }}>{amount} €</span>
          </div>
        </div>
        <Btn full variant="success" onClick={onAccepted} style={{ fontSize:15, padding:"17px" }}>
          Signer le contrat →
        </Btn>
      </div>
    </div>
  );

  // ── PHASE : REFUSÉE ────────────────────────────────────────────
  if (phase === "refused") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.accent+"15", border:"3px solid "+C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>❌</div>
        <h2 style={{ color:C.accent, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Mission refusée</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:8 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> a décliné la mission. Votre paiement est intégralement remboursé.
        </p>
        <div style={{ background:C.accentGold+"10", border:"1px solid "+C.accentGold+"30", borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:13, color:C.textSub, lineHeight:1.6 }}>
          💡 Pas de panique — il y a <strong style={{ color:C.text }}>d’autres prestataires disponibles</strong> dans ce secteur. Choisissez-en un autre pour votre mission.
        </div>
        <Btn full onClick={onCancelled} style={{ fontSize:15, padding:"17px", marginBottom:12 }}>
          Choisir un autre prestataire →
        </Btn>
        <button onClick={onBack} style={{ width:"100%", padding:"13px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Annuler définitivement
        </button>
      </div>
    </div>
  );

  // ── PHASE : TIMEOUT ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.accentGold+"15", border:"3px solid "+C.accentGold, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>⏰</div>
        <h2 style={{ color:C.accentGold, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Délai dépassé</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:8 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> n’a pas répondu dans le délai d’une heure. La mission est automatiquement annulée.
        </p>
        <div style={{ background:C.success+"08", border:"1px solid "+C.success+"25", borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:13, color:C.textSub, lineHeight:1.6 }}>
          ✅ <strong style={{ color:C.text }}>Remboursement automatique</strong> — Aucun débit n’a été effectué. Votre paiement escrow est libéré instantanément.
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid "+C.border, borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          📧 Un email de confirmation vous a été envoyé. Le prestataire a été notifié de l’annulation automatique.
        </div>
        <Btn full onClick={onCancelled} style={{ fontSize:15, padding:"17px", marginBottom:12 }}>
          Choisir un autre prestataire →
        </Btn>
        <button onClick={onBack} style={{ width:"100%", padding:"13px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Retour à l’accueil
        </button>
      </div>
    </div>
  );
}

function TrackingScreen({ provider, onNavigate }) {
  const p = provider||PROVIDERS[0];
  const [timelineStatus, setTimelineStatus] = useState("enroute");
  const [eta, setEta] = useState(8);

  const statusMap = ["enroute","enroute","in_progress","done"];
  const [step, setStep] = useState(0);

  useEffect(()=>{
    const t = setInterval(()=>{
      setStep(s => {
        const next = s < 3 ? s+1 : s;
        setTimelineStatus(statusMap[next]);
        if(next===1) setEta(0);
        return next;
      });
    }, 4000);
    return ()=>clearInterval(t);
  },[]);

  const statusLabels = ["En route vers vous","Arrivé sur place","Mission en cours","Mission terminée"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"48px 22px 24px" }}>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>📍 Suivi en temps réel</h2>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:6 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:C.success, boxShadow:`0 0 8px ${C.success}` }} />
          <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{statusLabels[step]}</p>
        </div>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Map */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r+4, overflow:"hidden", marginBottom:16 }}>
          <div style={{ height:180, background:`linear-gradient(135deg, #0A1628, #162547)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <div style={{ fontSize:44 }}>🗺️</div>
            <div style={{ position:"absolute", bottom:12, right:12, background:C.violet, borderRadius:20, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700 }}>
              📍 {p.name} {step===0 && eta>0 ? `· ~${eta} min` : step===0 ? "· Arrive" : "· Sur place"}
            </div>
          </div>
          <div style={{ padding:"13px 16px", display:"flex", gap:12, alignItems:"center", borderTop:`1px solid ${C.border}` }}>
            <div style={{ width:40, height:40, borderRadius:12, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle||p.role}</div>
            </div>
            <button onClick={()=>onNavigate("chat",p)} style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:12, padding:"9px 14px", cursor:"pointer", color:C.violet, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>💬 Chat</button>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:16 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Progression de la mission</div>
          <MissionTimeline status={timelineStatus} />
        </div>

        {step===3 && (
          <Btn full variant="success" onClick={()=>onNavigate("validation",provider)} style={{ fontSize:15, padding:"16px" }}>
            ✅ Valider la mission
          </Btn>
        )}
      </div>
    </div>
  );
}


// ── DOUBLE VALIDATION ─────────────────────────────────────────────
function ValidationScreen({ provider, role, onNavigate }) {
  const p = provider||PROVIDERS[0];
  const [clientValidated,setClientValidated]=useState(false);
  const [prestaValidated,setPrestaValidated]=useState(false);
  const [clientRating,setClientRating]=useState(0);
  const [prestaRating,setPrestaRating]=useState(0);
  const [clientComment,setClientComment]=useState("");
  const [prestaComment,setPrestaComment]=useState("");
  const [hoursActual,setHoursActual]=useState(8);
  const [dispute,setDispute]=useState(false);
  const [paid,setPaid]=useState(false);

  const bothValidated = clientValidated && prestaValidated;
  const totalClientPrice = (p.rateNum * hoursActual).toFixed(0);   // ce que le client paie
  const totalNetPresta   = (p.tarifNet * hoursActual).toFixed(0);   // ce que le prestataire encaisse

  useEffect(()=>{
    if(bothValidated && !paid) { const t=setTimeout(()=>setPaid(true), 1500); return ()=>clearTimeout(t); }
  },[bothValidated, paid]);

  if(paid) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1e8449)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:80, marginBottom:20 }}>💶</div>
      <h2 style={{ color:C.white, fontSize:28, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Paiement libéré !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 12px" }}>Les <strong>{totalNetPresta} €</strong> ont été virés sur le compte de {p.name}.</p>
      <div style={{ background:"rgba(255,255,255,0.2)", borderRadius:18, padding:"18px", marginBottom:28, width:"100%", maxWidth:280 }}>
        {["✅ Mission validée par les deux parties","💶 Virement initié vers le prestataire","📄 Fiche de paie générée automatiquement","⭐ Avis publiés sur les deux profils"].map((s,i)=>(
          <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:13, padding:"6px 0", borderBottom:i<3?`1px solid rgba(255,255,255,0.2)`:"none", textAlign:"left" }}>{s}</div>
        ))}
      </div>
      <Btn full variant="secondary" onClick={()=>onNavigate("home")} style={{ color:C.success }}>Retour à l'accueil</Btn>
      <button onClick={()=>onNavigate("rating",p)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"11px 24px", color:"rgba(255,255,255,0.9)", cursor:"pointer", marginTop:10, fontSize:13, fontFamily:"inherit", width:"100%", fontWeight:600 }}>⭐ Noter {p.name}</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <StepHeader title="Validation de mission" subtitle="Les deux parties doivent valider pour déclencher le paiement" onBack={()=>onNavigate("home")} />
      <div style={{ padding:"22px 18px" }}>
        {/* Info mission */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:32 }}>{p.avatar}</div>
            <div><div style={{ fontWeight:800, color:C.text }}>{p.name}</div><div style={{ color:C.textSub, fontSize:13 }}>{p.role}</div></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5, display:"block" }}>Heures réelles effectuées : {hoursActual}h</label>
            <input type="range" min={1} max={12} value={hoursActual} onChange={e=>setHoursActual(+e.target.value)} style={{ width:"100%", accentColor:C.violet }} />
          </div>
          <div style={{ background:`${C.accentGold}15`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text }}>
            💳 Montant client : <strong>{totalClientPrice} €</strong>
          </div>
        </div>

        {/* Validation CLIENT */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${clientValidated?C.success:C.grayLight}`, transition:"border 0.3s" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:20 }}>🏢</span>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Validation Client</div>
                <div style={{ color:C.textSub, fontSize:11 }}>Confirmez que la mission est terminée</div>
              </div>
            </div>
            {clientValidated ? <Badge color={C.success} small>✓ Validé</Badge> : <Badge color={C.gray} small>En attente</Badge>}
          </div>
          {!clientValidated ? <>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Notez le prestataire :</div>
              <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
                {[1,2,3,4,5].map(i=><span key={i} onClick={()=>setClientRating(i)} style={{ fontSize:32, cursor:"pointer", color:i<=clientRating?C.accentGold:"#ddd", transition:"color 0.2s" }}>★</span>)}
              </div>
            </div>
            <textarea value={clientComment} onChange={e=>setClientComment(e.target.value)} placeholder="Commentaire sur la mission…" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:70, boxSizing:"border-box", outline:"none", marginBottom:12 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setDispute(true)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${C.accent}`, background:"transparent", color:C.accent, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>⚠️ Signaler</button>
              <Btn variant="success" disabled={clientRating===0} onClick={()=>setClientValidated(true)} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Valider</Btn>
            </div>
          </> : (
            <div style={{ textAlign:"center", padding:"8px 0", color:C.success, fontWeight:700 }}>✅ Mission validée — Note : {"★".repeat(clientRating)}</div>
          )}
        </div>

        {/* Validation PRESTATAIRE */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${prestaValidated?C.success:C.grayLight}`, transition:"border 0.3s" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:20 }}>👷</span>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Validation Prestataire</div>
                <div style={{ color:C.textSub, fontSize:11 }}>Confirmez les heures effectuées</div>
              </div>
            </div>
            {prestaValidated ? <Badge color={C.success} small>✓ Validé</Badge> : <Badge color={C.gray} small>En attente</Badge>}
          </div>
          {!prestaValidated ? <>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Notez le client :</div>
              <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
                {[1,2,3,4,5].map(i=><span key={i} onClick={()=>setPrestaRating(i)} style={{ fontSize:32, cursor:"pointer", color:i<=prestaRating?C.accentGold:"#ddd", transition:"color 0.2s" }}>★</span>)}
              </div>
            </div>
            <textarea value={prestaComment} onChange={e=>setPrestaComment(e.target.value)} placeholder="Commentaire sur la mission…" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:70, boxSizing:"border-box", outline:"none", marginBottom:12 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setDispute(true)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${C.accent}`, background:"transparent", color:C.accent, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>⚠️ Litige</button>
              <Btn variant="success" disabled={prestaRating===0} onClick={()=>setPrestaValidated(true)} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Confirmer</Btn>
            </div>
          </> : (
            <div style={{ textAlign:"center", padding:"8px 0", color:C.success, fontWeight:700 }}>✅ Confirmé — Note : {"★".repeat(prestaRating)}</div>
          )}
        </div>

        {/* Statut paiement */}
        <div style={{ background: bothValidated?`${C.success}15`:`${C.accentGold}15`, border:`2px solid ${bothValidated?C.success:C.accentGold}55`, borderRadius:16, padding:"16px", textAlign:"center" }}>
          {bothValidated ? (
            <div>
              <div style={{ fontSize:32, marginBottom:8 }}>⚡</div>
              <div style={{ fontWeight:800, color:C.success, fontSize:15 }}>Les deux parties ont validé !</div>
              <div style={{ color:C.textSub, fontSize:13, marginTop:4 }}>Virement de {totalNetPresta} € en cours vers {p.name}…</div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>⏳ En attente de validation</div>
              <div style={{ color:C.textSub, fontSize:12 }}>
                {!clientValidated && !prestaValidated ? "Les deux parties doivent valider" : !clientValidated ? "En attente du client" : "En attente du prestataire"}
              </div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:6 }}>Si aucune réponse sous 48h → validation automatique</div>            </div>
          )}
        </div>

        {/* Litige */}
        {dispute && (
          <div style={{ marginTop:16, background:`${C.accent}10`, border:`2px solid ${C.accent}44`, borderRadius:16, padding:"16px" }}>
            <div style={{ fontWeight:800, color:C.danger, fontSize:14, marginBottom:8 }}>⚠️ Signalement de litige</div>
            <textarea placeholder="Décrivez le problème rencontré…" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`2px solid ${C.accent}44`, fontSize:13, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", marginBottom:12 }} />
            <Btn full variant="danger" onClick={()=>alert("📞 Médiation JOBER\n\nVotre demande de médiation a été transmise à notre équipe.\n\n✅ Numéro de dossier : LIT-2025-" + Math.floor(Math.random()*9000+1000) + "\n\nNotre équipe vous contactera sous 24h ouvrées pour arbitrer le litige.\n\nEmail : mediation@jober.fr\nTél : +33 1 XX XX XX XX")} style={{ fontSize:13, padding:"12px" }}>📞 Contacter la médiation JOBER</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MESSAGERIE ────────────────────────────────────────────────────
function ChatScreen({ provider, onBack }) {
  const p = provider||PROVIDERS[0];
  const [msg,setMsg]=useState("");
  const [msgs,setMsgs]=useState([
    { from:"presta", text:"Bonjour ! J’ai bien reçu votre demande. Je suis disponible au créneau indiqué.", time:"09:14" },
    { from:"client", text:"Parfait ! Pouvez-vous confirmer votre arrivée à 8h00 précises ?", time:"09:16" },
    { from:"presta", text:"Bien sûr, je serai là à 8h00. J’ai tout le matériel nécessaire.", time:"09:18" },
  ]);
  const endRef=useRef(null);
  const replyTimerRef=useRef(null);
  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);
  useEffect(()=>()=>clearTimeout(replyTimerRef.current),[]);

  const send=()=>{
    if(!msg.trim()) return;
    setMsgs(m=>[...m,{from:"client",text:msg,time:new Date().toLocaleTimeString("fr",{hour:"2-digit",minute:"2-digit"})}]);
    setMsg("");
    clearTimeout(replyTimerRef.current);
    replyTimerRef.current=setTimeout(()=>setMsgs(m=>[...m,{from:"presta",text:"Compris, je prends note !",time:new Date().toLocaleTimeString("fr",{hour:"2-digit",minute:"2-digit"})}]),1200);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 18px", borderRadius:"0 0 22px 22px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ width:44, height:44, borderRadius:r, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
          <div><div style={{ color:C.white, fontWeight:700, fontSize:15 }}>{p.name}</div><div style={{ color:`${C.success}`, fontSize:12, fontWeight:600 }}>● En ligne</div></div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 18px" }}>
        {msgs.map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:m.from==="client"?"flex-end":"flex-start", marginBottom:12 }}>
            {m.from==="presta" && <div style={{ width:28, height:28, borderRadius:9, background:`${p.color}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginRight:8, flexShrink:0 }}>{p.avatar}</div>}
            <div style={{ maxWidth:"75%" }}>
              <div style={{ background:m.from==="client"?`linear-gradient(135deg,${C.violet},${C.indigo})`:C.white, color:m.from==="client"?C.white:C.text, borderRadius:m.from==="client"?"18px 18px 4px 18px":"18px 18px 18px 4px", padding:"10px 14px", fontSize:14, boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>{m.text}</div>
              <div style={{ fontSize:10, color:C.textSub, marginTop:3, textAlign:m.from==="client"?"right":"left" }}>{m.time}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ padding:"12px 18px 24px", background:"#0D1B3E", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Votre message…" style={{ flex:1, padding:"12px 16px", borderRadius:24, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none" }} />
          <button onClick={send} style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, border:"none", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────

// ── FAVORIS ───────────────────────────────────────────────────────
function FavoritesScreen({ onNavigate, onBack }) {
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:0 }}>❤️ Mes favoris</h2>
      </div>
      <div style={{ padding:"18px" }}>
        {PROVIDERS.filter(p=>p.available).slice(0,2).map(p=>(
          <div key={p.id} onClick={()=>onNavigate("profile",p)} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:11, boxShadow:"0 4px 16px rgba(0,0,0,0.5)", cursor:"pointer", display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:52, height:52, borderRadius:15, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{p.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12 }}>{p.role}</div>
              <Stars rating={p.rating} />
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{p.hourlyRate} HT</div>
              <div style={{ fontSize:22 }}>❤️</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PARRAINAGE ────────────────────────────────────────────────────
function ReferralScreen({ onBack }) {
  const [copied,setCopied]=useState(false);
  const code="JOBER-A7K2X";
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accentGold},#e67e22)`, padding:"48px 22px 36px", borderRadius:"0 0 28px 28px", textAlign:"center" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:20, display:"block" }}>← Retour</button>
        <div style={{ fontSize:52, marginBottom:10 }}>🎁</div>
        <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 8px", fontFamily:font.display }}>Parrainez & gagnez</h2>
        <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, margin:0 }}>50€ pour vous et votre filleul à la 1ère mission</p>
      </div>
      <div style={{ padding:"24px 18px" }}>
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"20px", marginBottom:16, boxShadow:"0 2px 14px rgba(0,0,0,0.08)", textAlign:"center" }}>
          <p style={{ color:C.textSub, fontSize:13, margin:"0 0 12px" }}>Votre code de parrainage</p>
          <div style={{ background:`${C.accentGold}15`, border:`2px dashed ${C.accentGold}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <div style={{ fontSize:24, fontWeight:800, color:C.text, letterSpacing:3 }}>{code}</div>
          </div>
          <Btn full variant="gold" onClick={()=>setCopied(true)} style={{ fontSize:14 }}>{copied?"✓ Copié !":"📋 Copier le code"}</Btn>
        </div>
        {[{i:"🔗",t:"Partagez votre code",s:"Via SMS, email ou réseaux sociaux"},{i:"✅",t:"Votre filleul s’inscrit",s:"Il utilise votre code à l’inscription"},{i:"💶",t:"Vous gagnez 50€ chacun",s:"Crédité après sa première mission"}].map((s,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:9, display:"flex", gap:12, alignItems:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${C.accentGold}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{s.i}</div>
            <div><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{s.t}</div><div style={{ color:C.textSub, fontSize:11 }}>{s.s}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DOC UPLOAD CARD ───────────────────────────────────────────────
function DocUploadCard({ doc, value, onChange, required }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const loaded = !!value;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await onChange(file);
    setUploading(false);
  };

  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, border:`2px solid ${loaded?C.success:C.grayLight}`, display:"flex", gap:11, alignItems:"flex-start" }}>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }} onChange={handleFile} />
      <div style={{ width:40, height:40, borderRadius:11, background:loaded?`${C.success}18`:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{doc.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{doc.label}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{doc.info}</div>
        <button onClick={()=>inputRef.current?.click()} disabled={uploading} style={{ marginTop:6, background:"none", border:"none", color:loaded?C.success:C.violet, fontSize:12, fontWeight:700, cursor:"pointer", padding:0, fontFamily:"inherit" }}>
          {uploading ? "Envoi…" : loaded ? "✓ Chargé — Remplacer" : "+ Charger le fichier"}
        </button>
      </div>
      <Badge color={required?C.accent:C.gray} small>{required?"Obligatoire":"Optionnel"}</Badge>
    </div>
  );
}

// ── PRESTATAIRE ONBOARDING ────────────────────────────────────────
function PrestaOnboarding({ onComplete, onBack }) {
  const [step,setStep]=useState(1);
  const TOTAL=isLaunchPhase()?7:8;
  const [infos,setInfos]=useState({prenom:"",nom:"",email:"",tel:"",password:"",dateNaissance:"",lieuNaissance:"",nationalite:"France"});
  const [adresse,setAdresse]=useState({rue:"",ville:"",cp:"",pays:"France",rayon:"20"});
  const [ae,setAe]=useState({siret:"",siren:"",activite:"",dateCreation:"",codeAPE:"",regime:"micro-entreprise"});
  const [docs,setDocs]=useState({});
  const [metiers,setMetiers]=useState([]);
  const [newMetier,setNewMetier]=useState({sector:"",metier:"",niveau:"Confirmé",certifs:"",tarifNet:12});
  const [langues,setLangues]=useState(["Français"]);
  const [bio,setBio]=useState("");
  const [dispos,setDispos]=useState({});
  const [prefs,setPrefs]=useState({contrat:"Journée complète",tarifMin:"12",vehicule:false,permis:false,mobilite:"20"});
  const [showGuide,setShowGuide]=useState(false);
  const [choixAE,setChoixAE]=useState(null);
  const [abonnement,setAbonnement]=useState("free");
  const [justAdded,setJustAdded]=useState(false);

  const toggleDispo=(jour,plage)=>setDispos(prev=>{const curr=prev[jour]||[];const next=curr.includes(plage)?curr.filter(p=>p!==plage):[...curr,plage];return{...prev,[jour]:next};});
  const justAddedRef = useRef(null);
  const addMetier=()=>{
    if(!newMetier.sector||!newMetier.metier)return;
    setMetiers(prev=>[...prev,{...newMetier,id:Date.now()}]);
    setNewMetier({sector:"",metier:"",niveau:"Confirmé",certifs:"",tarifNet:12});
    setJustAdded(true);
    clearTimeout(justAddedRef.current);
    justAddedRef.current=setTimeout(()=>setJustAdded(false),1500);
  };
  const toggleDoc=(id)=>setDocs(prev=>({...prev,[id]:!prev[id]}));
  const toggleLangue=(l)=>setLangues(prev=>prev.includes(l)?prev.filter(x=>x!==l):[...prev,l]);
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const docsOk=DOCS_REQUIS.filter(d=>d.required).every(d=>docs[d.id]);
  const dispoStep=6;
  const recapStep=isLaunchPhase()?7:8;

  const handleSubmitDossier=async()=>{
    setSubmitting(true);
    setSubmitError("");
    try {
      const { data, error:authErr } = await supabase.auth.getUser();
      if(authErr || !data?.user) throw new Error("Session expirée, reconnectez-vous");
      const user = data.user;
      if(user){
        await supabase.from("profiles").update({ prenom:infos.prenom, nom:infos.nom, tel:infos.tel }).eq("id",user.id);
        await supabase.from("prestataires").upsert({
          id:user.id, siret:ae.siret, siren:ae.siren, activite:ae.activite,
          rue:adresse.rue, ville:adresse.ville, cp:adresse.cp,
          zone_km:parseInt(adresse.rayon)||20, bio, available:true,
        });
        if(metiers.length>0){
          await supabase.from("metiers").insert(metiers.map(m=>({
            prestataire_id:user.id, sector:m.sector, job_title:m.metier,
            niveau:m.niveau, tarif_net:m.tarifNet, certifs:m.certifs,
          })));
        }
        const dispoRows=[];
        Object.entries(dispos).forEach(([jour,creneaux])=>(creneaux||[]).forEach(c=>dispoRows.push({ prestataire_id:user.id, jour, creneau:c })));
        if(dispoRows.length>0) await supabase.from("disponibilites").insert(dispoRows);
        if(!isLaunchPhase()){
          await supabase.from("abonnements").upsert({ prestataire_id:user.id, plan:abonnement });
        }
      }
    } catch(e){
      console.error("Supabase submit error",e);
      setSubmitError("Une erreur est survenue lors de l'envoi. Réessayez.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onComplete();
  };
  const stepValid=()=>{
    if(step===1)return infos.prenom&&infos.nom&&infos.email&&infos.tel&&infos.password;
    if(step===2)return adresse.rue&&adresse.ville&&adresse.cp;
    if(step===3)return ae.siret&&ae.siren&&ae.activite;
    if(step===4)return true;
    if(step===5)return true;
    if(step===dispoStep)return Object.keys(dispos).some(j=>(dispos[j]||[]).length>0);
    if(!isLaunchPhase()&&step===7)return true;
    return true;
  };
  const TITLES=isLaunchPhase()
    ?["Informations personnelles","Adresse & zone","Statut auto-entrepreneur","Documents administratifs","Métiers & compétences","Disponibilités","Récapitulatif"]
    :["Informations personnelles","Adresse & zone","Statut auto-entrepreneur","Documents administratifs","Métiers & compétences","Disponibilités","Abonnement","Récapitulatif"];
  const SUBS=isLaunchPhase()
    ?["Vos coordonnées","Résidence et intervention","Informations légales","Obligatoires pour valider","Vos savoir-faire","Vos créneaux","Vérifiez avant envoi"]
    :["Vos coordonnées","Résidence et intervention","Informations légales","Obligatoires pour valider","Vos savoir-faire","Vos créneaux","Choisissez votre plan","Vérifiez avant envoi"];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <StepHeader step={step} total={TOTAL} title={TITLES[step-1]} subtitle={SUBS[step-1]} onBack={step===1?onBack:()=>setStep(s=>s-1)} />
      <div style={{ padding:"22px 18px" }}>
        {step===1 && <>
          <div style={{ display:"flex", gap:10 }}><div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" value={infos.prenom} onChange={e=>setInfos({...infos,prenom:e.target.value})} /></div><div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" value={infos.nom} onChange={e=>setInfos({...infos,nom:e.target.value})} /></div></div>
          <Input label="Email *" type="email" placeholder="jean@exemple.fr" icon="✉️" value={infos.email} onChange={e=>setInfos({...infos,email:e.target.value})} />
          <Input label="Téléphone *" placeholder="+33 6 XX XX XX XX" icon="📱" value={infos.tel} onChange={e=>setInfos({...infos,tel:e.target.value})} />
          <Input label="Mot de passe *" type="password" placeholder="Minimum 8 caractères" icon="🔒" value={infos.password} onChange={e=>setInfos({...infos,password:e.target.value})} />
          <Input label="Date de naissance" type="date" value={infos.dateNaissance} onChange={e=>setInfos({...infos,dateNaissance:e.target.value})} />
          <Input label="Lieu de naissance" placeholder="Paris" value={infos.lieuNaissance} onChange={e=>setInfos({...infos,lieuNaissance:e.target.value})} />
          <Select label="Nationalité" options={["France","Autre UE","Hors UE"]} value={infos.nationalite} onChange={e=>setInfos({...infos,nationalite:e.target.value})} />
          <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}33`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:8 }}>📸 Photo de profil</div>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1, background:"#0D1B3E", border:`2px dashed ${C.grayLight}`, borderRadius:12, padding:"14px", textAlign:"center", cursor:"pointer" }}><div style={{ fontSize:24 }}>📷</div><div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Prendre</div></div>
              <div style={{ flex:1, background:"#0D1B3E", border:`2px dashed ${C.grayLight}`, borderRadius:12, padding:"14px", textAlign:"center", cursor:"pointer" }}><div style={{ fontSize:24 }}>🖼️</div><div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Galerie</div></div>
            </div>
          </div>
        </>}
        {step===2 && <>
          <Input label="Adresse *" placeholder="12 rue de la Paix" icon="📍" value={adresse.rue} onChange={e=>setAdresse({...adresse,rue:e.target.value})} />
          <div style={{ display:"flex", gap:10 }}><div style={{ flex:2 }}><Input label="Ville *" placeholder="Paris" value={adresse.ville} onChange={e=>setAdresse({...adresse,ville:e.target.value})} /></div><div style={{ flex:1 }}><Input label="CP *" placeholder="75001" value={adresse.cp} onChange={e=>setAdresse({...adresse,cp:e.target.value})} /></div></div>
          <Select label="Pays" options={["France","Belgique","Suisse","Luxembourg"]} value={adresse.pays} onChange={e=>setAdresse({...adresse,pays:e.target.value})} />
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>🗺️ Rayon d'intervention</div>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 12px" }}>Distance max pour une mission</p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["5","10","20","30","50","100"].map(km=><button key={km} onClick={()=>setAdresse({...adresse,rayon:km})} style={{ padding:"9px 16px", borderRadius:20, border:"none", cursor:"pointer", background:adresse.rayon===km?C.violet:C.grayLight, color:adresse.rayon===km?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{km} km</button>)}
            </div>
            <p style={{ color:C.violet, fontSize:12, fontWeight:700, marginTop:10 }}>Zone : {adresse.rayon} km autour de chez vous</p>
          </div>
        </>}
        {step===3 && <>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}55`, borderRadius:r, padding:"14px", marginBottom:18, fontSize:13, lineHeight:1.5 }}>⚠️ <strong>Auto-entrepreneur obligatoire</strong><br/><span style={{ color:C.textSub }}>JOBER travaille exclusivement avec des AE. Vos infos seront vérifiées.</span></div>
          <Input label="N° SIRET *" placeholder="XXX XXX XXX XXXXX" icon="🔢" value={ae.siret} onChange={e=>setAe({...ae,siret:e.target.value})} hint="14 chiffres — visible sur votre extrait KBIS" />
          <Input label="N° SIREN *" placeholder="XXX XXX XXX" icon="🏢" value={ae.siren} onChange={e=>setAe({...ae,siren:e.target.value})} hint="9 premiers chiffres du SIRET" />
          <Input label="Activité déclarée *" placeholder="Prestation de services…" value={ae.activite} onChange={e=>setAe({...ae,activite:e.target.value})} />
          <Input label="Code APE / NAF" placeholder="7022Z" value={ae.codeAPE} onChange={e=>setAe({...ae,codeAPE:e.target.value})} />
          <Input label="Date de création" type="date" value={ae.dateCreation} onChange={e=>setAe({...ae,dateCreation:e.target.value})} />
          <Select label="Régime fiscal" options={["micro-entreprise","entreprise individuelle","autre"]} value={ae.regime} onChange={e=>setAe({...ae,regime:e.target.value})} />
          {/* Guide création micro-entreprise */}
          <div onClick={()=>setShowGuide(!showGuide)} style={{ background:showGuide?C.violet+"14":"rgba(255,255,255,0.04)", border:`1px solid ${showGuide?C.violet+"55":C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:12, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:11, background:C.violet+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🚀</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Pas encore auto-entrepreneur ?</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Créez votre micro-entreprise en 24h — on vous guide</div>
            </div>
            <span style={{ color:C.violet, fontSize:18, display:"inline-block", transform:showGuide?"rotate(90deg)":"none", transition:"transform 0.2s" }}>›</span>
          </div>
          {showGuide && (
            <div style={{ marginBottom:14 }}>
              {[
                { id:"legalstart", nom:"LegalStart",        logo:"⚖️", color:"#4F46E5", badge:"Recommandé", info:"0€ · SIRET en 48h · Validation juridique incluse", lien:"https://www.legalstart.fr/micro-entreprise/" },
                { id:"shine",      nom:"Shine",             logo:"✨", color:"#7C3AED", badge:"Tout-en-un",  info:"Gratuit · Compte pro + SIRET en 24h",              lien:"https://www.shine.fr/" },
                { id:"urssaf",     nom:"URSSAF (officiel)", logo:"🏛️", color:"#059669", badge:"100% gratuit", info:"Gratuit · Site officiel de l’État · SIRET 24h", lien:"https://www.autoentrepreneur.urssaf.fr/" },
              ].map(p=>(
                <div key={p.id} onClick={()=>setChoixAE(choixAE===p.id?null:p.id)} style={{ background:choixAE===p.id?p.color+"15":"#0D1B3E", border:`2px solid ${choixAE===p.id?p.color:C.border}`, borderRadius:r+2, padding:"13px", marginBottom:8, cursor:"pointer" }}>
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:11, background:p.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{p.logo}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:2 }}>
                        <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.nom}</span>
                        <span style={{ background:p.color+"22", color:p.color, fontSize:10, fontWeight:700, borderRadius:6, padding:"2px 8px" }}>{p.badge}</span>
                      </div>
                      <div style={{ color:C.textSub, fontSize:11 }}>{p.info}</div>
                    </div>
                    <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${choixAE===p.id?p.color:C.border}`, background:choixAE===p.id?p.color:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {choixAE===p.id && <div style={{ width:7, height:7, borderRadius:"50%", background:"#fff" }}/>}
                    </div>
                  </div>
                  {choixAE===p.id && (
                    <a href={p.lien} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ display:"block", marginTop:12, padding:"11px", borderRadius:r, background:`linear-gradient(135deg,${p.color},${p.color}cc)`, color:"#fff", fontWeight:700, fontSize:13, textAlign:"center", textDecoration:"none" }}>
                      Créer ma micro-entreprise sur {p.nom} →
                    </a>
                  )}
                </div>
              ))}
              <div style={{ fontSize:11, color:C.textMuted, lineHeight:1.6, padding:"10px 0" }}>
                ℹ️ JOBER ne perçoit aucune commission sur la création de votre entreprise. Revenez avec votre SIRET pour finaliser votre inscription.
              </div>
            </div>
          )}
        </>}
        {step===4 && <>
          <div style={{ background:docsOk?`${C.success}15`:`${C.accent}15`, border:`1px solid ${docsOk?C.success:C.accent}44`, borderRadius:r, padding:"13px 16px", marginBottom:18, display:"flex", gap:10 }}>
            <span style={{ fontSize:20 }}>{docsOk?"✅":"⚠️"}</span>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{docsOk?"Tous les documents obligatoires chargés !":"Documents manquants"}</div>
              <div style={{ color:C.textSub, fontSize:11 }}>Formats acceptés : PDF, JPG, PNG</div>
            </div>
          </div>
          <p style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>Documents obligatoires</p>
          {DOCS_REQUIS.filter(d=>d.required).map(doc=>(
            <DocUploadCard key={doc.id} doc={doc} value={docs[doc.id]} onChange={async(file)=>{
              if(!file) return;
              const { data:_ud } = await supabase.auth.getUser();
              const user = _ud?.user;
              const path = `${user?.id||"anon"}/${doc.id}_${Date.now()}_${file.name}`;
              const { error } = await supabase.storage.from("documents").upload(path, file, { upsert:true });
              if(!error){
                setDocs(prev=>({...prev,[doc.id]:path}));
                if(user) await supabase.from("documents").upsert({ prestataire_id:user.id, type:doc.id, storage_path:path });
              }
            }} required />
          ))}
          <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>Documents optionnels</p>
          {DOCS_REQUIS.filter(d=>!d.required).map(doc=>(
            <DocUploadCard key={doc.id} doc={doc} value={docs[doc.id]} onChange={async(file)=>{
              if(!file) return;
              const { data:_ud } = await supabase.auth.getUser();
              const user = _ud?.user;
              const path = `${user?.id||"anon"}/${doc.id}_${Date.now()}_${file.name}`;
              const { error } = await supabase.storage.from("documents").upload(path, file, { upsert:true });
              if(!error){
                setDocs(prev=>({...prev,[doc.id]:path}));
                if(user) await supabase.from("documents").upsert({ prestataire_id:user.id, type:doc.id, storage_path:path });
              }
            }} required={false} />
          ))}
        </>}
        {step===5 && <>
          {/* Liste des métiers ajoutés */}
          {metiers.length>0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:0 }}>Vos métiers ({metiers.length})</p>
                <span style={{ background:`${C.success}20`, color:C.success, fontSize:11, fontWeight:700, borderRadius:8, padding:"3px 10px" }}>✓ {metiers.length} ajouté{metiers.length>1?"s":""}</span>
              </div>
              {metiers.map((m,i)=>(
                <div key={m.id} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:38, height:38, borderRadius:10, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                    {SECTORS.find(s=>s.id===m.sector)?.icon||"💼"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.metier}</div>
                    <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{SECTORS.find(s=>s.id===m.sector)?.label} · {m.niveau}</div>
                    {m.certifs&&<div style={{ color:C.violet, fontSize:11, marginTop:2 }}>🎓 {m.certifs}</div>}
                    <div style={{ display:"flex", gap:12, marginTop:5, alignItems:"center" }}>
                      <span style={{ fontSize:13, fontWeight:800, color:C.success }}>Vous : {formatE(m.tarifNet||12)}</span>
                      <span style={{ fontSize:11, color:C.textMuted }}>→ Client : {formatE(prixClient(m.tarifNet||12, m.sector||"divers"))}</span>
                    </div>
                  </div>
                  <button onClick={()=>setMetiers(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"rgba(242,94,94,0.1)", border:"none", borderRadius:8, width:32, height:32, color:C.accent, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Formulaire ajout métier */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`1px dashed ${C.border}` }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"0 0 2px" }}>
              {metiers.length===0 ? "+ Ajouter un métier" : "+ Ajouter un autre métier"}
            </p>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 14px" }}>
              {metiers.length===0
                ? "Optionnel — vous pourrez compléter après validation"
                : "Chaque métier peut avoir son propre taux horaire"}
            </p>
            <Select label="Secteur" options={SECTORS.map(s=>s.label)} value={SECTORS.find(s=>s.id===newMetier.sector)?.label||""} onChange={e=>{const s=SECTORS.find(x=>x.label===e.target.value);setNewMetier({...newMetier,sector:s?.id||"",metier:""}); }} />
            {newMetier.sector && <Select label="Métier" options={METIERS[newMetier.sector]||[]} value={newMetier.metier} onChange={e=>{
              const tarif = METIERS_TARIFS[newMetier.sector]?.[e.target.value];
              setNewMetier({...newMetier, metier:e.target.value, tarifNet: tarif?.default || tarif?.min || 12});
            }} />}
            {newMetier.sector && newMetier.metier && (() => {
              const t    = METIERS_TARIFS[newMetier.sector]?.[newMetier.metier];
              const net  = newMetier.tarifNet || t?.default || t?.min || 12;
              const clientPrice = prixClient(net, newMetier.sector||"divers");
              const belowMarket = t && net < t.min;
              const aboveMarket = t && net > t.max;
              return (
                <div style={{ background:`${C.violet}08`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"16px", marginBottom:14 }}>

                  {/* Fourchette indicative — pas une limite */}
                  {t && (
                    <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:10, padding:"10px 12px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>💡 Fourchette du marché</span>
                      <span style={{ fontSize:13, color:C.accentGold, fontWeight:800 }}>{formatE(t.min)} — {formatE(t.max)}</span>
                    </div>
                  )}

                  {/* Saisie libre du taux */}
                  <div style={{ marginBottom:12 }}>
                    <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>
                      Votre taux horaire souhaité (libre)
                    </label>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1, position:"relative" }}>
                        <input
                          type="number" min={1} step={0.5}
                          value={net}
                          onChange={e => setNewMetier({...newMetier, tarifNet: Math.max(1, +e.target.value || 1)})}
                          style={{ width:"100%", padding:"14px 48px 14px 16px", borderRadius:12, border:`2px solid ${belowMarket||aboveMarket ? C.accentGold : C.violet}`, fontSize:20, fontWeight:800, color:C.violet, fontFamily:"inherit", outline:"none", boxSizing:"border-box", textAlign:"center" }}
                        />
                        <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:C.textSub, fontSize:13, fontWeight:600 }}>€/h</span>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <button onClick={()=>setNewMetier({...newMetier, tarifNet: Math.round((net+0.5)*10)/10})} style={{ width:36, height:32, borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>＋</button>
                        <button onClick={()=>setNewMetier({...newMetier, tarifNet: Math.max(1, Math.round((net-0.5)*10)/10)})} style={{ width:36, height:32, borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>－</button>
                      </div>
                    </div>

                    {/* Alerte si hors fourchette — indicatif seulement */}
                    {belowMarket && (
                      <div style={{ marginTop:8, fontSize:11, color:C.warning, fontWeight:600 }}>
                        ⚠️ En dessous du marché — vous pouvez tout à fait le garder
                      </div>
                    )}
                    {aboveMarket && (
                      <div style={{ marginTop:8, fontSize:11, color:C.accentGold, fontWeight:600 }}>
                        📈 Au-dessus du marché — assurez-vous que votre profil le justifie
                      </div>
                    )}
                  </div>

                  {/* Résumé net → client */}
                  <div style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Vous encaissez</div>
                      <div style={{ fontSize:22, fontWeight:800, color:C.success }}>{formatE(net)}</div>
                    </div>
                    <div style={{ textAlign:"center", color:C.grayLight, fontSize:20 }}>→</div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Affiché aux clients</div>
                      <div style={{ fontSize:22, fontWeight:800, color:C.text }}>{formatE(clientPrice)}</div>
                    </div>
                  </div>
                  <p style={{ fontSize:11, color:C.textSub, margin:"8px 0 0", textAlign:"center", lineHeight:1.4 }}>
                    Le tarif client inclut les frais de service JOBER
                  </p>
                </div>
              );
            })()}
            <Select label="Niveau" options={["Débutant","Confirmé","Expert"]} value={newMetier.niveau} onChange={e=>setNewMetier({...newMetier,niveau:e.target.value})} />
            <Input label="Certifications (optionnel)" placeholder="Ex : CACES 1, HACCP, SST…" value={newMetier.certifs} onChange={e=>setNewMetier({...newMetier,certifs:e.target.value})} hint="Laissez vide si aucune certification" />
            <Btn
              full
              onClick={addMetier}
              disabled={!newMetier.sector||!newMetier.metier}
              variant={justAdded?"success":"primary"}
              style={{ padding:"13px", fontSize:15 }}
            >
              {justAdded ? "✓ Métier ajouté !" : `${metiers.length===0?"+ Ajouter ce métier":"+ Ajouter un autre métier"}`}
            </Btn>
          </div>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"0 0 12px" }}>🌍 Langues parlées</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {["Français","Anglais","Espagnol","Arabe","Portugais","Allemand","Italien","Mandarin"].map(l=><button key={l} onClick={()=>toggleLangue(l)} style={{ padding:"8px 14px", borderRadius:20, border:"none", cursor:"pointer", background:langues.includes(l)?C.violet:C.grayLight, color:langues.includes(l)?C.white:C.text, fontWeight:langues.includes(l)?700:500, fontSize:13, fontFamily:"inherit" }}>{l}</button>)}
            </div>
          </div>
          <div style={{ marginBottom:8 }}>
            <label style={{ display:"block", fontSize:12, color:C.textSub, marginBottom:5, fontWeight:600 }}>Présentation libre</label>
            <textarea placeholder="Décrivez votre parcours…" value={bio} onChange={e=>setBio(e.target.value)} style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", color:C.text }} />
          </div>
        </>}
        {!isLaunchPhase() && step===7 && <>
          <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:18 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>⚡ Choisissez votre plan JOBER</div>
            <div style={{ color:C.textSub, fontSize:12 }}>0% de commission sur toutes vos missions. Changez de plan à tout moment.</div>
          </div>
          {ABONNEMENTS_PRESTA.map(plan=>{
            const active=abonnement===plan.id;
            return (
              <div key={plan.id} onClick={()=>setAbonnement(plan.id)} style={{ background:active?plan.color+"15":"#0D1B3E", border:`2px solid ${active?plan.color:C.border}`, borderRadius:r+4, padding:"14px", marginBottom:10, cursor:"pointer", position:"relative" }}>
                {plan.popular&&<div style={{ position:"absolute", top:10, right:10, background:plan.color, borderRadius:6, padding:"2px 8px", color:"#fff", fontSize:10, fontWeight:700 }}>Populaire</div>}
                <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:11, background:plan.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{plan.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{plan.label}</div>
                    <div style={{ fontWeight:800, color:plan.color, fontSize:17 }}>{plan.price===0?"Gratuit":plan.price+" €/mois"}</div>
                  </div>
                  <div style={{ width:22, height:22, borderRadius:"50%", border:`2px solid ${active?plan.color:C.border}`, background:active?plan.color:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {active&&<div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }}/>}
                  </div>
                </div>
                {plan.features.map((f,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, padding:"2px 0" }}>
                    <span style={{ color:plan.color, fontSize:12 }}>✓</span>
                    <span style={{ color:C.textSub, fontSize:12 }}>{f}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </>}
        {step===dispoStep && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:14, margin:"0 0 4px" }}>📅 Disponibilités hebdomadaires</p>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 16px" }}>Modifiables à tout moment depuis votre profil</p>
            {JOURS.map(jour=>{
              const sel=dispos[jour]||[];
              return (
                <div key={jour} style={{ marginBottom:10, borderRadius:12, border:`2px solid ${sel.length>0?C.violet+"44":C.grayLight}`, overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px", background:sel.length>0?`${C.violet}08`:C.white, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontWeight:800, color:sel.length>0?C.violet:C.text, fontSize:14 }}>{jour}</span>
                    {sel.length>0?<Badge color={C.violet} small>{sel.length} plage{sel.length>1?"s":""}</Badge>:<span style={{ color:C.textSub, fontSize:12 }}>Non disponible</span>}
                  </div>
                  <div style={{ padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}` }}>
                    {PLAGES.map(plage=>{const a=sel.includes(plage);return(<button key={plage} onClick={()=>toggleDispo(jour,plage)} style={{ padding:"6px 12px", borderRadius:10, border:"none", cursor:"pointer", background:a?C.violet:C.grayLight, color:a?C.white:C.text, fontWeight:a?700:500, fontSize:11, fontFamily:"inherit" }}>{plage.split(" ")[0]}</button>);})}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:14, margin:"0 0 14px" }}>⚙️ Préférences de mission</p>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:8, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Type de missions souhaitées</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {["Journée complète","Demi-journée","Semaine complète","Missions urgentes","Week-end"].map(type=>(
                  <button key={type} onClick={()=>setPrefs(p=>({ ...p, contrat:p.contrat===type?"":type }))} style={{ padding:"9px 14px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:prefs.contrat===type?700:500, background:prefs.contrat===type?C.violet:"rgba(255,255,255,0.06)", color:prefs.contrat===type?C.white:C.textSub, transition:"all 0.2s" }}>
                    {type}
                  </button>
                ))}
              </div>
              <p style={{ color:C.textMuted, fontSize:11, marginTop:8 }}>Sélectionnez votre préférence principale — modifiable à tout moment</p>
            </div>
            <Input label="Rayon max (km)" type="number" placeholder="20" value={prefs.mobilite} onChange={e=>setPrefs({...prefs,mobilite:e.target.value})} />
            <div style={{ display:"flex", gap:10 }}>
              {[{key:"vehicule",label:"🚗 Véhiculé(e)"},{key:"permis",label:"📋 Permis B"}].map(({key,label})=><button key={key} onClick={()=>setPrefs({...prefs,[key]:!prefs[key]})} style={{ flex:1, padding:"12px", borderRadius:12, border:`2px solid ${prefs[key]?C.violet:C.grayLight}`, background:prefs[key]?`${C.violet}10`:C.white, color:prefs[key]?C.violet:C.gray, fontWeight:prefs[key]?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>)}
            </div>
          </div>
        </>}
        {step===recapStep && <>
          <div style={{ background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px 16px", marginBottom:18, display:"flex", gap:12, alignItems:"center" }}>
            <span style={{ fontSize:28 }}>🎉</span>
            <div><div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Profil complet !</div><div style={{ color:C.textSub, fontSize:12 }}>Vérifiez avant envoi</div></div>
          </div>
          {[
            {title:"👤 Identité",items:[`${infos.prenom} ${infos.nom}`,infos.email,infos.tel]},
            {title:"📍 Adresse",items:[`${adresse.rue}, ${adresse.cp} ${adresse.ville}`,`Zone : ${adresse.rayon} km`]},
            {title:"🏢 Auto-entrepreneur",items:[`SIRET : ${ae.siret||"—"}`,`Activité : ${ae.activite||"—"}`]},
            {title:"📎 Documents",items:[`${Object.values(docs).filter(Boolean).length}/${DOCS_REQUIS.length} chargés`]},
            {title:"💼 Métiers & taux nets",items:metiers.map(m=>m.tarifNet?`${m.metier} — ${formatE(m.tarifNet)} net`:m.metier)},
            {title:"📅 Disponibilités",items:JOURS.filter(j=>(dispos[j]||[]).length>0).map(j=>`${j} : ${(dispos[j]||[]).map(p=>p.split(" ")[0]).join(", ")}`)},
            ...(!isLaunchPhase()?[{title:"⚡ Abonnement",items:[(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)||ABONNEMENTS_PRESTA[0]).label+" — "+(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price===0?"Gratuit":(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price)+" €/mois")]}]:[]),
          ].map(section=>(
            <div key={section.title} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:8 }}>{section.title}</div>
              {section.items.filter(Boolean).map((item,i)=><div key={i} style={{ color:C.textSub, fontSize:13, padding:"4px 0" }}>{item}</div>)}
              {section.items.filter(Boolean).length===0 && <div style={{ color:C.accent, fontSize:13 }}>⚠️ Non renseigné</div>}
            </div>
          ))}
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer" }}>
              <input type="checkbox" style={{ marginTop:2, accentColor:C.violet }} />
              <span style={{ fontSize:13, color:C.textSub, lineHeight:1.5 }}>J'accepte les <strong style={{ color:C.violet }}>CGU</strong> et la <strong style={{ color:C.violet }}>Politique de confidentialité</strong> de JOBER</span>
            </label>
          </div>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:18, fontSize:12, color:C.text }}>⏱️ Délai de validation : <strong>24 à 48h ouvrées</strong></div>
          {submitError && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{submitError}</div>}
          <Btn full variant="success" onClick={handleSubmitDossier} disabled={submitting} style={{ fontSize:16, padding:"18px" }}>{submitting?"Envoi en cours…":"✅ Envoyer mon dossier"}</Btn>
        </>}
        {step<TOTAL && <div style={{ marginTop:18 }}><Btn full onClick={()=>setStep(s=>s+1)} disabled={!stepValid()} style={{ fontSize:16, padding:"17px" }}>Continuer →</Btn></div>}
      </div>
    </div>
  );
}

// ── PRESTA DASHBOARD ──────────────────────────────────────────────
function PrestaDashboard({ onNavigate }) {
  const [tab,setTab]=useState("missions");
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 28px", borderRadius:"0 0 26px 26px" }}>
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:18 }}>
          <div style={{ width:58, height:58, borderRadius:18, background:`${C.accent}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, border:"2px solid rgba(255,255,255,0.2)" }}>👨‍💼</div>
          <div style={{ flex:1 }}>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:11, margin:0 }}>Espace prestataire</p>
            <h2 style={{ color:C.white, fontSize:18, fontWeight:800, margin:"2px 0 5px" }}>Alexandre Ali BA</h2>
            <div style={{ display:"flex", gap:6 }}><div style={{ width:8, height:8, borderRadius:"50%", background:C.accentGold }} /><span style={{ color:C.accentGold, fontSize:11, fontWeight:700 }}>En attente de validation</span></div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          {[{l:"Missions",v:"47",i:"✅"},{l:"Ce mois",v:"1840€",i:"💶"},{l:"Note",v:"4.8★",i:"⭐"},{l:"Taux",v:"98%",i:"📈"}].map(s=>(
            <div key={s.l} style={{ background:"rgba(255,255,255,0.1)", borderRadius:12, padding:"10px 6px", textAlign:"center" }}>
              <div style={{ fontSize:16 }}>{s.i}</div><div style={{ color:C.white, fontWeight:800, fontSize:12 }}>{s.v}</div><div style={{ color:"rgba(255,255,255,0.45)", fontSize:9 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding:"18px 18px 0" }}>
        {isLaunchPhase() && <LaunchBadge context="presta" />}
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:18 }}>
          {[{id:"missions",l:"Missions"},{id:"profil",l:"Profil"},{id:"docs",l:"Docs"},{id:"revenus",l:"Revenus"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"9px 4px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit", boxShadow:tab===t.id?"0 2px 8px rgba(0,0,0,0.1)":"none" }}>{t.l}</button>
          ))}
        </div>
        {tab==="missions" && <>
          <p style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>🔔 Missions proposées</p>
          {[{titre:"Préparateur de commandes",client:"LogiPro",date:"Lun 05 Mai",time:"08h-16h",tarif:"12,50 €/h",urgent:true},{titre:"Agent de propreté",client:"Centre Nord",date:"Mar 06 Mai",time:"06h-13h",tarif:"13,00 €/h",urgent:false}].map((m,i)=>(
            <div key={i} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:12, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}><div style={{ fontWeight:800, color:C.text, fontSize:14 }}>{m.titre}<div style={{ color:C.textSub, fontSize:12, fontWeight:400 }}>{m.client}</div></div>{m.urgent&&<Badge color={C.accent} small>Urgent</Badge>}</div>
              <div style={{ display:"flex", gap:6, marginBottom:10 }}><Badge color={C.indigo} small>📅 {m.date}</Badge><Badge color={C.gray} small>{m.time}</Badge><Badge color={C.success} small>{m.tarif}</Badge></div>
              <div style={{ display:"flex", gap:8 }}>
                <Btn variant="ghost" style={{ flex:1, padding:"9px", fontSize:12 }} onClick={()=>{
          alert("Mission refusée. JOBER va proposer un remplaçant au client.");
        }}>Refuser</Btn>
        <Btn variant="success" style={{ flex:2, padding:"9px", fontSize:12 }} onClick={()=>{
          alert("✅ Mission acceptée ! Le contrat va vous être envoyé pour signature.");
        }}>✓ Accepter</Btn>
              </div>
            </div>
          ))}
          <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>📋 Mission en cours</p>
          <div onClick={()=>onNavigate("validation",PROVIDERS[0])} style={{ background:`linear-gradient(135deg,${C.violet}15,${C.indigo}08)`, border:`2px solid ${C.violet}33`, borderRadius:16, padding:"14px", cursor:"pointer", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <div style={{ fontWeight:800, color:C.text }}>Cariste CACES 1</div>
              <Badge color={C.accentGold} small>En cours</Badge>
            </div>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:8 }}>Entrepôt XYZ · Mer 12 Mai · 09h-17h</div>
            <Btn full variant="gold" style={{ padding:"10px", fontSize:13 }} onClick={()=>onNavigate("validation",PROVIDERS[0])}>✅ Valider la mission</Btn>
          </div>
        </>}
        {tab==="profil" && <>
          {[
            {icon:"📂",label:"Mes documents",sub:"Uploader & renouveler mes docs", action:()=>onNavigate("doc_upload")},
            {icon:"👤",label:"Informations personnelles",sub:"Nom, email, téléphone", action:()=>alert("👤 Informations personnelles\n\nNom : Alexandre Ali BA\nEmail : alexandre@email.fr\nTél : +33 6 XX XX XX XX\nDate de naissance : 01/01/1990\n\n(Modification disponible dans la version finale)")},
            {icon:"📍",label:"Adresse & zone",sub:"Domicile, rayon d’intervention", action:()=>alert("📍 Adresse & Zone\n\n12 rue de la Paix, 75001 Paris\nRayon d’intervention : 20 km\n\n(Modification disponible dans la version finale)")},
            {icon:"💼",label:"Mes métiers",sub:"3 métiers enregistrés", action:()=>alert("💼 Mes métiers\n\n1. Cariste CACES 1 — Confirmé — 14,00 €/h net\n2. Préparateur de commandes — Expert — 12,00 €/h net\n3. Agent de quai — Confirmé — 12,50 €/h net\n\n(Modification disponible dans la version finale)")},
            {icon:"📅",label:"Disponibilités",sub:"Lundi-Vendredi, matin & après-midi", action:()=>alert("📅 Disponibilités\n\nLundi : Matin + Après-midi\nMardi : Matin + Après-midi\nMercredi : Matin\nJeudi : Matin + Après-midi\nVendredi : Matin + Après-midi\nSamedi : Non disponible\nDimanche : Non disponible\n\n(Modification disponible dans la version finale)")},
            {icon:"⚙️",label:"Préférences de mission",sub:"Contrat, tarif min, mobilité", action:()=>alert("⚙️ Préférences\n\nType de contrat : Mission ponctuelle\nTarif minimum : 12 €/h net\nRayon max : 20 km\nVéhiculé : Oui 🚗\nPermis B : Oui 📋\n\n(Modification disponible dans la version finale)")},
            {icon:"⚡",label:isLaunchPhase()?"Abonnement (lancement)":"Mon abonnement",sub:isLaunchPhase()?"Accès gratuit · 6 mois restants":"Gratuit · Premium 29€ · Elite 59€",action:()=>onNavigate("abonnement_presta")},
            {icon:"🔔",label:"Notifications",sub:"3 nouvelles alertes", action:()=>alert("🔔 Notifications\n\n• Nouvelle mission proposée : Cariste CACES 1\n• Votre paiement de 112€ a été libéré\n• Rappel : mission demain à 08h00")},
          ].map((item,i)=>(
            <div key={i} onClick={item.action} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, display:"flex", alignItems:"center", gap:12, cursor:"pointer", boxShadow:"0 2px 12px rgba(0,0,0,0.4)", transition:"transform 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.transform="translateX(4px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
            >
              <div style={{ width:40, height:40, borderRadius:12, background:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{item.icon}</div>
              <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{item.label}</div><div style={{ color:C.textSub, fontSize:11 }}>{item.sub}</div></div>
              <span style={{ color:C.textSub, fontSize:17 }}>›</span>
            </div>
          ))}
        </>}
        {tab==="docs" && <>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"11px 14px", marginBottom:14, fontSize:12 }}>⚠️ Certains documents doivent être renouvelés annuellement (attestation URSSAF, RC Pro).</div>
          {DOCS_REQUIS.map((doc,i)=>(
            <DocRowItem key={i} doc={doc} isValid={i<4} />
          ))}
        </>}
        {tab==="revenus" && <>
          <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 4px" }}>Revenus nets du mois</p>
            <div style={{ color:C.white, fontSize:36, fontWeight:900 }}>1 534 €</div>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"4px 0 0" }}>Avril 2025 · 12 missions</p>
          </div>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.text }}>
            💡 Ces montants correspondent à votre taux horaire net encaissé à chaque mission.
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[{l:"Cette semaine",v:"270 €"},{l:"Ce trimestre",v:"4 370 €"},{l:"Cette année",v:"12 340 €"},{l:"En attente",v:"234 €"}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)", textAlign:"center" }}>
                <div style={{ fontWeight:800, color:C.accent, fontSize:16 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>
          {[{m:"Cariste CACES 1",d:"28 Avr.",v:"+112 €",s:"payé",h:"8h"},{m:"Agent propreté",d:"26 Avr.",v:"+72 €",s:"payé",h:"6h"},{m:"Réceptionniste",d:"22 Avr.",v:"+104 €",s:"en attente",h:"8h"}].map((t,i)=>(
            <div key={i} style={{ background:"#0D1B3E", borderRadius:13, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 6px rgba(0,0,0,0.04)" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>💶</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{t.m}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>{t.d} · {t.h}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:t.s==="payé"?C.success:C.accentGold, fontSize:14 }}>{t.v}</div>
                <div style={{ color:C.textSub, fontSize:10 }}>{t.s}</div>
              </div>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}

// ── NAV BARS ──────────────────────────────────────────────────────
function ClientNav({ active, onNavigate }) {
  const tabs = [
    {id:"home",          icon:"🏠", label:"Accueil" },
    {id:"catalogue",     icon:"🗂️", label:"Secteurs"},
    {id:"search_filters",icon:"🔍", label:"Chercher"},
    {id:"dashboard",     icon:"👤", label:"Compte"  },
    {id:"settings",      icon:"⚙️", label:"Réglages"},
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
      backdropFilter:"blur(20px)",
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s" }}>{t.icon}</span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.violet:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.violet, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

function PrestaNav({ active, onNavigate }) {
  const tabs = [
    {id:"p_home",     icon:"🏠", label:"Accueil" },
    {id:"p_missions", icon:"📋", label:"Missions"},
    {id:"calendar",   icon:"📅", label:"Planning"},
    {id:"p_dashboard",icon:"👤", label:"Profil"  },
    {id:"settings",   icon:"⚙️", label:"Réglages"},
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s" }}>{t.icon}</span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.accent:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.accent, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

function CalendarScreen() {
  const days=["L","M","M","J","V","S","D"], weeks=[[1,2,3,4,5,6,7],[8,9,10,11,12,13,14],[15,16,17,18,19,20,21],[22,23,24,25,26,27,28],[29,30,31,null,null,null,null]], booked=[5,12,13,19,26];
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>Planning</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Vos missions programmées</p>
      </div>
      <div style={{ padding:"22px 18px" }}>
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"18px", marginBottom:18, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <button style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 11px", cursor:"pointer" }}>‹</button>
            <span style={{ fontWeight:800, color:C.text, fontSize:15 }}>Mai 2025</span>
            <button style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 11px", cursor:"pointer" }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, textAlign:"center", marginBottom:6 }}>
            {days.map(d=><div key={d} style={{ color:C.textSub, fontSize:11, fontWeight:700 }}>{d}</div>)}
          </div>
          {weeks.map((week,wi)=>(
            <div key={wi} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
              {week.map((day,di)=><div key={di} style={{ aspectRatio:"1", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:day===12?900:500, background:day===12?C.violet:booked.includes(day)?`${C.violet}18`:"transparent", color:day===12?C.white:booked.includes(day)?C.violet:day?C.text:"transparent", cursor:day?"pointer":"default" }}>{day}</div>)}
            </div>
          ))}
        </div>
        {[{role:"Cariste CACES 1",client:"Entrepôt XYZ",date:"Mer 12 Mai",time:"09:00-17:00",color:C.violet},{role:"Réceptionniste",client:"Hôtel Lumière",date:"Jeu 13 Mai",time:"14:00-22:00",color:C.accentGold}].map((m,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:4, height:44, borderRadius:2, background:m.color, flexShrink:0 }} />
            <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.role}</div><div style={{ color:C.textSub, fontSize:11 }}>{m.client}</div></div>
            <div style={{ textAlign:"right" }}><div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{m.date}</div><div style={{ color:C.textSub, fontSize:11 }}>{m.time}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── STRIPE PAYMENT ────────────────────────────────────────────────
function StripePaymentScreen({ amount, provider, teamMode, teamProviders, onSuccess, onBack }) {
  const [method, setMethod] = useState("card");
  const [card, setCard] = useState({ num:"", exp:"", cvv:"", name:"" });
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [saveCard, setSaveCard] = useState(false);

  const total = (typeof amount === 'object' ? amount?.amount : amount) || 124;
  const providers = teamMode ? teamProviders : [provider || PROVIDERS[0]];

  useEffect(() => {
    if (!processing) return;
    const t1 = setTimeout(() => { setProcessing(false); setDone(true); }, 2200);
    const t2 = setTimeout(() => onSuccess && onSuccess(), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [processing]);

  const handlePay = () => setProcessing(true);

  const formatCard = (v) => v.replace(/\D/g,"").slice(0,16).replace(/(.{4})/g,"$1 ").trim();
  const formatExp  = (v) => { const d=v.replace(/\D/g,"").slice(0,4); return d.length>2?d.slice(0,2)+"/"+d.slice(2):d; };

  if(done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, marginBottom:20 }}>✓</div>
      <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Paiement sécurisé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 24px" }}>
        <strong>{total} €</strong> placés en escrow JOBER.<br/>Libérés après validation de la mission.
      </p>
      <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:16, padding:"16px 20px", width:"100%", maxWidth:300, marginBottom:24, textAlign:"left" }}>
        {[
          "🔒 Argent sécurisé jusqu’à validation",
          "📧 Confirmation envoyée par email",
          teamMode ? `👥 ${providers.length} prestataires notifiés` : `👤 ${providers[0]?.name} notifié(e)`,
          "📄 Contrat de mission généré",
        ].map((s,i) => <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:13, padding:"5px 0" }}>{s}</div>)}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>💳 Paiement sécurisé</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Argent bloqué jusqu'à validation mutuelle</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Résumé commande */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>📋 Récapitulatif</div>
          {providers.map((p,i) => (
            <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:22 }}>{p.avatar}</span>
              <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{p.name}</div><div style={{ color:C.textSub, fontSize:11 }}>{p.role} · {p.hourlyRate} HT</div></div>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12 }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Total à bloquer</span>
            <span style={{ fontWeight:800, color:C.violet, fontSize:20 }}>{total} €</span>
          </div>
          <div style={{ background:`${C.success}15`, borderRadius:8, padding:"8px 10px", marginTop:10, fontSize:11, color:C.success, fontWeight:600 }}>
            🔒 Libéré uniquement après validation des deux parties
          </div>
        </div>

        {/* Méthode de paiement */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>Mode de paiement</div>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[{id:"card",icon:"💳",label:"Carte"},{id:"apple",icon:"",label:"Apple Pay"},{id:"wire",icon:"🏦",label:"Virement"}].map(m => (
              <button key={m.id} onClick={()=>setMethod(m.id)} style={{ flex:1, padding:"10px 6px", borderRadius:12, border:`2px solid ${method===m.id?C.violet:C.grayLight}`, background:method===m.id?`${C.violet}08`:C.white, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                <div style={{ fontSize:18 }}>{m.icon}</div>
                <div style={{ fontSize:11, fontWeight:method===m.id?700:500, color:method===m.id?C.violet:C.gray, marginTop:2 }}>{m.label}</div>
              </button>
            ))}
          </div>

          {method==="card" && (
            <div>
              <div style={{ marginBottom:12 }}>
                <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Titulaire de la carte</label>
                <input value={card.name} onChange={e=>setCard({...card,name:e.target.value})} placeholder="Jean Dupont" style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Numéro de carte</label>
                <div style={{ position:"relative" }}>
                  <input value={card.num} onChange={e=>setCard({...card,num:formatCard(e.target.value)})} placeholder="4242 4242 4242 4242" maxLength={19} style={{ width:"100%", padding:"12px 50px 12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:15, fontFamily:"monospace", outline:"none", boxSizing:"border-box", letterSpacing:1 }} />
                  <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:20 }}>💳</span>
                </div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}>
                  <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Expiration</label>
                  <input value={card.exp} onChange={e=>setCard({...card,exp:formatExp(e.target.value)})} placeholder="MM/AA" maxLength={5} style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:15, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>CVV</label>
                  <input value={card.cvv} onChange={e=>setCard({...card,cvv:e.target.value.replace(/\D/g,"").slice(0,3)})} placeholder="•••" maxLength={3} style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:15, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} />
                </div>
              </div>
              <label style={{ display:"flex", gap:8, alignItems:"center", marginTop:12, cursor:"pointer" }}>
                <input type="checkbox" checked={saveCard} onChange={e=>setSaveCard(e.target.checked)} style={{ accentColor:C.violet }} />
                <span style={{ fontSize:12, color:C.textSub }}>Sauvegarder cette carte pour mes prochaines réservations</span>
              </label>
            </div>
          )}
          {method==="apple" && (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:48, marginBottom:8 }}></div>
              <p style={{ color:C.textSub, fontSize:14 }}>Authentification Face ID / Touch ID requise</p>
              <div style={{ background:"#000", borderRadius:12, padding:"14px", color:C.white, fontWeight:700, fontSize:15, cursor:"pointer" }}>Payer {total} € avec Apple Pay</div>
            </div>
          )}
          {method==="wire" && (
            <div style={{ background:`${C.accentGold}15`, borderRadius:12, padding:"14px", fontSize:13, lineHeight:1.7 }}>
              <div style={{ fontWeight:800, color:C.text, marginBottom:8 }}>Coordonnées bancaires JOBER</div>
              {[["IBAN","FR76 3000 4000 0100 0000 0000 123"],["BIC","BNPAFRPPXXX"],["Référence",`JOBER-${Date.now().toString().slice(-6)}`],["Montant",`${total} €`]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                  <span style={{ color:C.textSub }}>{l}</span><span style={{ fontWeight:700, color:C.text, fontSize:12 }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:10, color:C.warning, fontSize:11, fontWeight:600 }}>⚠️ Délai de validation : 1-2 jours ouvrés</div>
            </div>
          )}
        </div>

        {/* Sécurité */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
          {["🔒 SSL 256-bit","🛡️ 3D Secure","✓ PCI DSS"].map(s=>(
            <span key={s} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", fontSize:10, color:C.textSub, fontWeight:600 }}>{s}</span>
          ))}
        </div>

        <Btn full onClick={handlePay} disabled={processing || (method==="card" && (!card.num||!card.exp||!card.cvv||!card.name))}
          style={{ fontSize:16, padding:"18px", position:"relative" }}>
          {processing ? "⏳ Traitement en cours…" : `🔒 Payer ${total} € en sécurité`}
        </Btn>
        <p style={{ textAlign:"center", color:C.textSub, fontSize:11, marginTop:8 }}>Aucun débit avant validation de votre mission</p>
      </div>
    </div>
  );
}

// ── FACTURE / INVOICE ─────────────────────────────────────────────
function InvoiceScreen({ provider, amount, hours, onBack }) {
  const p = provider || PROVIDERS[0];
  const invoiceNum = `JOBER-2025-${Math.floor(Math.random()*9000+1000)}`;
  const date = new Date().toLocaleDateString("fr-FR");
  const ht = amount || 124;
  const tva = 0; // auto-entrepreneur → pas de TVA
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>📄 Facture de mission</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{invoiceNum}</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {/* En-tête facture */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800, color:C.violet, fontFamily:font.display }}>JOBER</div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Plateforme de services à la demande</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>FACTURE</div>
              <div style={{ color:C.textSub, fontSize:11 }}>{invoiceNum}</div>
              <div style={{ color:C.textSub, fontSize:11 }}>Émise le {date}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:4 }}>CLIENT</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Société ABC</div>
              <div style={{ fontSize:11, color:C.textSub }}>12 rue de Rivoli</div>
              <div style={{ fontSize:11, color:C.textSub }}>75001 Paris</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:4 }}>PRESTATAIRE</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{p.name}</div>
              <div style={{ fontSize:11, color:C.textSub }}>{p.role}</div>
              <div style={{ fontSize:11, color:C.textSub }}>Auto-entrepreneur</div>
            </div>
          </div>
        </div>

        {/* Détail mission */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>Détail de la prestation</div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
            <span style={{ color:C.textSub, fontSize:12 }}>Description</span><span style={{ color:C.textSub, fontSize:12, textAlign:"right" }}>Qté</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{p.role}</div>
              <div style={{ color:C.textSub, fontSize:11 }}>Mission du 05/05/2025 · {hours||8}h</div>
              <div style={{ color:C.textSub, fontSize:11 }}>Tarif : {p.hourlyRate} HT</div>
            </div>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{ht} €</div>
          </div>
          <div style={{ padding:"10px 0 4px" }}>
            {[["Sous-total HT", `${ht} €`],["TVA (0% — auto-entrepreneur)","0,00 €"],["Total TTC", `${ht} €`]].map(([l,v],i)=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
                <span style={{ color: i===2?C.text:C.gray, fontSize: i===2?15:13, fontWeight: i===2?900:400 }}>{l}</span>
                <span style={{ color: i===2?C.violet:C.text, fontSize: i===2?18:13, fontWeight: i===2?900:600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Statut paiement */}
        <div style={{ background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px 16px", marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ fontSize:24 }}>✅</span>
          <div>
            <div style={{ fontWeight:800, color:C.success, fontSize:13 }}>Paiement reçu</div>
            <div style={{ color:C.textSub, fontSize:11 }}>Virement effectué le {date} via JOBER Escrow</div>
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" full onClick={()=>alert("⬇️ Téléchargement\n\nLa facture PDF est en cours de téléchargement sur votre appareil.\n\n(En production, le PDF serait généré automatiquement via notre serveur et téléchargé directement.)")} style={{ fontSize:13, padding:"13px" }}>⬇️ Télécharger PDF</Btn>
          <Btn full onClick={()=>{ const email = prompt("📧 Envoyer la facture\n\nEntrez l’adresse email destinataire :","contact@societe.fr"); if(email) alert(`✅ Facture envoyée !\n\nLa facture a été envoyée à ${email}`); }} style={{ fontSize:13, padding:"13px" }}>📧 Envoyer par email</Btn>
        </div>
      </div>
    </div>
  );
}

// ── GESTION DES ANNULATIONS ───────────────────────────────────────
function CancellationScreen({ provider, missionDate, onNavigate, onBack }) {
  const p = provider || PROVIDERS[0];
  const [step, setStep] = useState("policy"); // policy | confirm | replacement | done
  const [reason, setReason] = useState("");
  const [replacements, setReplacements] = useState(
    PROVIDERS.filter(x => x.id !== p.id && x.available && x.sector === p.sector)
  );
  const [chosen, setChosen] = useState(null);

  // Délai simulé : < 24h → frais 100%, 24-48h → 50%, > 48h → gratuit
  const hoursLeft = 18; // simulé
  const penalty = hoursLeft < 24 ? 100 : hoursLeft < 48 ? 50 : 0;
  const penaltyAmount = (124 * penalty / 100).toFixed(0);

  const policyColor = penalty === 0 ? C.success : penalty === 50 ? C.warning : C.danger;
  const policyLabel = penalty === 0 ? "Annulation gratuite" : penalty === 50 ? "Frais d’annulation 50%" : "Annulation tardive — frais 100%";

  if(step==="replacement") return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>🔄 Remplaçant automatique</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>Prestataires disponibles sur votre créneau</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:13, color:C.text }}>
          ⚡ JOBER a trouvé <strong>{replacements.length} remplaçant{replacements.length>1?"s":""}</strong> disponible{replacements.length>1?"s":""} sur votre créneau
        </div>
        {replacements.length === 0 ? (
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"24px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize:44, marginBottom:12 }}>😔</div>
            <div style={{ fontWeight:800, color:C.text, marginBottom:8 }}>Aucun remplaçant disponible</div>
            <div style={{ color:C.textSub, fontSize:13, marginBottom:16 }}>Vous serez remboursé intégralement</div>
            <Btn full variant="success" onClick={()=>setStep("done")}>Confirmer le remboursement</Btn>
          </div>
        ) : (
          <>
            {replacements.map(r => (
              <div key={r.id} onClick={()=>setChosen(r)} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:11, boxShadow:"0 4px 16px rgba(0,0,0,0.5)", cursor:"pointer", border:`2px solid ${chosen?.id===r.id?C.success:C.grayLight}`, transition:"border 0.2s" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:50, height:50, borderRadius:15, background:`${r.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{r.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{r.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{r.role}</div>
                    <div style={{ display:"flex", gap:6, marginTop:3, alignItems:"center" }}><Stars rating={r.rating} size={12}/><span style={{ color:C.textSub, fontSize:11 }}>{r.rating} · {r.distance}</span></div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{r.hourlyRate}</div>
                    {chosen?.id===r.id && <div style={{ color:C.success, fontSize:12, fontWeight:700, marginTop:4 }}>✓ Sélectionné</div>}
                  </div>
                </div>
              </div>
            ))}
            <Btn full variant="success" disabled={!chosen} onClick={()=>setStep("done")} style={{ marginTop:8 }}>
              ✓ Confirmer {chosen?.name || "le remplaçant"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );

  if(step==="done") return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:20 }}>{chosen ? "🔄" : "💶"}</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 12px" }}>{chosen ? "Remplaçant confirmé !" : "Remboursement initié"}</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 28px" }}>
        {chosen ? `${chosen.name} prendra en charge votre mission.` : "Vous serez remboursé sous 3-5 jours ouvrés."}
      </p>
      <Btn full variant="secondary" onClick={()=>onNavigate("home")} style={{ color:C.success }}>Retour à l'accueil</Btn>
      <button onClick={()=>onNavigate("rating",p)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"11px 24px", color:"rgba(255,255,255,0.9)", cursor:"pointer", marginTop:10, fontSize:13, fontFamily:"inherit", width:"100%", fontWeight:600 }}>⭐ Noter {p.name}</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>❌ Annuler la mission</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{p.name} · {p.role}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Politique d'annulation */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:14 }}>📋 Politique d'annulation JOBER</div>
          {[
            { label:"Plus de 48h avant", detail:"Annulation gratuite", color:C.success, icon:"✅" },
            { label:"Entre 24h et 48h",  detail:"Frais de 50% du montant", color:C.warning, icon:"⚠️" },
            { label:"Moins de 24h",      detail:"Frais de 100% du montant", color:C.danger, icon:"❌" },
          ].map((r,i) => (
            <div key={i} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${C.grayLight}`:"none" }}>
              <span style={{ fontSize:20 }}>{r.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{r.label}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Votre situation */}
        <div style={{ background:`${policyColor}15`, border:`2px solid ${policyColor}44`, borderRadius:16, padding:"16px", marginBottom:16 }}>
          <div style={{ fontWeight:800, color:policyColor, fontSize:14, marginBottom:4 }}>{policyLabel}</div>
          <div style={{ color:C.textSub, fontSize:13 }}>Mission dans <strong style={{ color:C.text }}>{hoursLeft}h</strong></div>
          {penalty > 0 && (
            <div style={{ marginTop:8, fontWeight:700, color:C.text, fontSize:14 }}>
              Frais d'annulation : <span style={{ color:C.danger }}>{penaltyAmount} €</span>
            </div>
          )}
        </div>

        {/* Raison */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>Motif d'annulation</div>
          {["Erreur de date / horaire","Prestataire ne convient plus","Mission annulée par mon client","Problème de budget","Autre"].map(r => (
            <div key={r} onClick={()=>setReason(r)} style={{ padding:"10px 14px", borderRadius:10, marginBottom:6, border:`2px solid ${reason===r?C.violet:C.grayLight}`, background:reason===r?`${C.violet}08`:C.white, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:reason===r?700:400, color:reason===r?C.violet:C.text }}>{r}</span>
              {reason===r && <span style={{ color:C.violet, fontSize:16 }}>✓</span>}
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="secondary" onClick={onBack} style={{ flex:1, padding:"13px", fontSize:13 }}>Garder la mission</Btn>
          <Btn variant="danger" disabled={!reason} onClick={()=>setStep("replacement")} style={{ flex:2, padding:"13px", fontSize:13 }}>
            Annuler {penalty>0?`(−${penaltyAmount} €)`:""}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── MODE ÉQUIPE ───────────────────────────────────────────────────
function TeamBookingScreen({ onNavigate, onBack }) {
  const [sector, setSector] = useState("");
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [hours, setHours] = useState(8);
  const [basket, setBasket] = useState([]);
  const [step, setStep] = useState("select"); // select | configure | payment

  const filteredProviders = PROVIDERS.filter(p =>
    p.available && (!sector || p.sector === sector)
  );

  const toggleBasket = (p) => setBasket(prev =>
    prev.find(x=>x.id===p.id) ? prev.filter(x=>x.id!==p.id) : [...prev, p]
  );

  const totalTeam = basket.reduce((sum, p) => sum + p.rateNum * hours, 0);

  if(step==="payment") return (
    <StripePaymentScreen
      amount={Math.round(totalTeam)}
      teamMode={true}
      teamProviders={basket}
      onSuccess={()=>onNavigate("home")}
      onBack={()=>setStep("configure")}
    />
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>👥 Réservation d'équipe</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Réservez plusieurs prestataires en une fois</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {step==="select" && <>
          {/* Filtres */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>🔍 Filtrer les prestataires</div>
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none" }}>
              <button onClick={()=>setSector("")} style={{ padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer", background:sector===""?C.violet:C.grayLight, color:sector===""?C.white:C.gray, fontWeight:sector===""?700:500, fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap" }}>Tous</button>
              {SECTORS.map(s => (
                <button key={s.id} onClick={()=>setSector(s.id)} style={{ padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer", background:sector===s.id?C.violet:C.grayLight, color:sector===s.id?C.white:C.gray, fontWeight:sector===s.id?700:500, fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap" }}>{s.icon} {s.label}</button>
              ))}
            </div>
          </div>

          {/* Liste prestataires */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>{filteredProviders.length} disponible{filteredProviders.length>1?"s":""}</span>
            {basket.length > 0 && <Badge color={C.violet} small>{basket.length} sélectionné{basket.length>1?"s":""}</Badge>}
          </div>

          {filteredProviders.map(p => {
            const inBasket = basket.find(x=>x.id===p.id);
            return (
              <div key={p.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${inBasket?C.violet:C.grayLight}`, transition:"border 0.2s" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:50, height:50, borderRadius:15, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{p.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{p.role} · {p.distance}</div>
                    <div style={{ marginTop:3 }}><Stars rating={p.rating} size={12}/></div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{p.hourlyRate} HT</div>
                    <button onClick={()=>toggleBasket(p)} style={{ marginTop:6, padding:"6px 12px", borderRadius:10, border:"none", cursor:"pointer", background:inBasket?C.violet:C.grayLight, color:inBasket?C.white:C.text, fontWeight:700, fontSize:12, fontFamily:"inherit", transition:"all 0.2s" }}>
                      {inBasket ? "✓ Ajouté" : "+ Ajouter"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {basket.length > 0 && (
            <div style={{ position:"sticky", bottom:90, background:"#0D1B3E", borderRadius:16, padding:"14px 16px", boxShadow:"0 -4px 20px rgba(0,0,0,0.12)", border:`2px solid ${C.violet}`, marginTop:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Équipe sélectionnée</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>{basket.length} prestataire{basket.length>1?"s":""}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:C.textSub }}>Estimation {hours}h</div>
                  <div style={{ fontWeight:800, color:C.violet, fontSize:18 }}>{totalTeam.toFixed(0)} €</div>
                </div>
              </div>
              <Btn full onClick={()=>setStep("configure")} style={{ padding:"13px", fontSize:14 }}>
                Configurer la mission →
              </Btn>
            </div>
          )}
        </>}

        {step==="configure" && <>
          <div style={{ background:`${C.violet}08`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"14px", marginBottom:16 }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>👥 Équipe ({basket.length} prestataires)</div>
            {basket.map(p => (
              <div key={p.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:18 }}>{p.avatar}</span>
                <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.text }}>{p.name}</span>
                <span style={{ color:C.violet, fontWeight:700, fontSize:12 }}>{p.hourlyRate} HT</span>
                <button onClick={()=>toggleBasket(p)} style={{ background:"none", border:"none", color:C.accent, cursor:"pointer", fontSize:16 }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>📅 Détails de la mission</div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Heure de début</label>
              <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)} style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Durée : {hours}h</label>
              <input type="range" min={1} max={12} value={hours} onChange={e=>setHours(+e.target.value)} style={{ width:"100%", accentColor:C.violet }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textSub, marginTop:2 }}><span>1h</span><span>12h</span></div>
            </div>
          </div>

          {/* Récap total */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>💶 Récapitulatif financier</div>
            {basket.map(p => (
              <div key={p.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{p.name} ({hours}h)</span>
                <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{(p.rateNum*hours).toFixed(0)} €</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:10 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:15 }}>Total équipe</span>
              <span style={{ fontWeight:800, color:C.violet, fontSize:20 }}>{totalTeam.toFixed(0)} €</span>
            </div>
            <div style={{ marginTop:8, fontSize:11, color:C.textSub }}>🔒 Bloqué en escrow jusqu'à validation de chaque prestataire</div>
          </div>

          <Btn full onClick={()=>setStep("payment")} disabled={!date||!timeStart} style={{ fontSize:15, padding:"16px" }}>
            💳 Procéder au paiement {totalTeam.toFixed(0)} €
          </Btn>
        </>}
      </div>
    </div>
  );
}

// ── MINI COMPOSANTS (évite useState dans .map) ───────────────────

// DocRow — onglet docs prestataire
function DocRowItem({ doc, isValid }) {
  const [renewed, setRenewed] = useState(false);
  const valid = isValid || renewed;
  return (
    <div style={{ background:"#0D1B3E", borderRadius:13, padding:"12px", marginBottom:8, display:"flex", gap:10, alignItems:"center", border:`1px solid ${valid?C.border:C.accent+"30"}` }}>
      <div style={{ width:38, height:38, borderRadius:10, background:valid?`${C.success}18`:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{doc.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{doc.label}</div>
        <div style={{ color:valid?C.success:C.textSub, fontSize:11, fontWeight:valid?700:400 }}>{valid?"✓ Validé":"En attente"}</div>
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <Badge color={valid?C.success:C.accent} small>{valid?"OK":"Requis"}</Badge>
        {!isValid && !renewed && (
          <button onClick={()=>{ if(window.confirm(`Charger "${doc.label}" ?`)) setRenewed(true); }} style={{ padding:"4px 10px", borderRadius:8, border:`1px solid ${C.violet}`, background:"transparent", color:C.violet, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>+ Charger</button>
        )}
        {isValid && (
          <button onClick={()=>alert(`📋 ${doc.label}\n\nStatut : ✅ Validé\nDate : 01/01/2025`)} style={{ padding:"4px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>Voir</button>
        )}
      </div>
    </div>
  );
}

// PendingDocRow — backoffice validation dossiers
function PendingDocRow({ u }) {
  const [validated, setValidated] = useState(false);
  const [docRequested, setDocRequested] = useState(false);
  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, border:`1px solid ${C.border}`, opacity:validated?0.6:1, transition:"opacity 0.3s" }}>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:`${C.violet}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{u.avatar}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{u.name}</div>
          <div style={{ color:C.textSub, fontSize:11 }}>{u.role} · {u.sector}</div>
        </div>
        <div>
          {validated ? <Badge color={C.success} small>✓ Validé</Badge>
            : <Badge color={u.missing===0?C.success:C.accent} small>{u.missing===0?"Complet":`${u.missing} manquant${u.missing>1?"s":""}`}</Badge>}
        </div>
      </div>
      {!validated && (
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>alert(`Dossier de ${u.name}\nSecteur : ${u.sector}\nDocs : ${u.docs} chargés\nManquants : ${u.missing}`)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>👁️ Voir</button>
          {u.missing===0
            ? <button onClick={()=>{ if(window.confirm(`Valider le compte de ${u.name} ?`)) setValidated(true); }} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:C.success, color:C.white, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✓ Valider</button>
            : <button onClick={()=>{ setDocRequested(true); alert(`Email envoyé à ${u.name}`); }} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:docRequested?`${C.success}22`:`${C.accentGold}22`, color:docRequested?C.success:C.warning, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{docRequested?"✓ Envoyé":"⚠️ Demander docs"}</button>}
        </div>
      )}
      {validated && <div style={{ textAlign:"center", color:C.success, fontSize:12, fontWeight:700, padding:"4px 0" }}>✅ Compte activé</div>}
    </div>
  );
}

// AlertRow — backoffice alertes
function AlertRow({ a }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:9, border:`2px solid ${done?C.success+"44":a.color+"33"}`, display:"flex", gap:10, alignItems:"center", opacity:done?0.6:1, transition:"all 0.3s" }}>
      <div style={{ width:40, height:40, borderRadius:12, background:`${done?C.success:a.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{done?"✅":a.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{a.text}</div>
        {!done && a.urgent && <Badge color={a.color} small>Urgent</Badge>}
        {done && <span style={{ fontSize:11, color:C.success, fontWeight:600 }}>Traité ✓</span>}
      </div>
      {!done && <button onClick={()=>{ alert(`✅ Alerte traitée :\n"${a.text}"`); setDone(true); }} style={{ padding:"7px 12px", borderRadius:10, border:"none", background:`${a.color}18`, color:a.color, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Traiter</button>}
    </div>
  );
}

// LitigeRow — backoffice litiges
function LitigeRow({ l }) {
  const [status, setStatus] = useState("pending");
  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:10, border:`1px solid ${C.border}`, opacity:status!=="pending"?0.6:1, transition:"opacity 0.3s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{l.motif}</div>
        <Badge color={status==="resolved"?C.success:status==="refunded"?C.accentGold:C.danger} small>
          {status==="resolved"?"✓ Résolu":status==="refunded"?"↩ Remboursé":l.montant}
        </Badge>
      </div>
      <div style={{ color:C.textSub, fontSize:12, marginBottom:10 }}>🏢 {l.client} ↔ 👷 {l.presta} · {l.date}</div>
      {status==="pending" && (
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>alert(`Motif : ${l.motif}\nClient : ${l.client}\nPrestataire : ${l.presta}\nMontant : ${l.montant}`)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.text, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>👁️ Détails</button>
          <button onClick={()=>{ if(window.confirm(`Résoudre "${l.motif}" ?`)) setStatus("resolved"); }} style={{ flex:1, padding:"8px", borderRadius:10, border:"none", background:`${C.success}18`, color:C.success, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✓ Résoudre</button>
          <button onClick={()=>{ if(window.confirm(`Rembourser ${l.montant} ?`)) setStatus("refunded"); }} style={{ flex:1, padding:"8px", borderRadius:10, border:"none", background:`${C.danger}18`, color:C.danger, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>↩ Rembourser</button>
        </div>
      )}
      {status!=="pending" && <div style={{ textAlign:"center", fontSize:12, color:status==="resolved"?C.success:C.accentGold, fontWeight:700 }}>{status==="resolved"?"✅ Résolu":"↩ Remboursé"}</div>}
    </div>
  );
}

// ── BACKOFFICE ────────────────────────────────────────────────────
const BO_PIN = "1234";

// Données simulées backoffice
const BO_DATA = {
  users:        { clients:142, prestataires:89, total:231, newThisWeek:14 },
  missions:     { total:387, enCours:23, terminees:341, annulees:23, tauxCompletion:88 },
  finance:      { caTotal:48320, commissionJober:8920, escrowEnAttente:3240, litiges:3 },
  abonnements:  { free:54, premium:28, elite:7, newThisWeek:6, churnThisMonth:2 },
  noteMoyenne:  4.7,
  tauxReponse:  94,
  sectors: [
    { id:"logistique",   label:"Logistique",   icon:"📦", missions:98,  color:"#81C784", pct:25 },
    { id:"btp",          label:"BTP",           icon:"🏗️", missions:87,  color:"#FF8A65", pct:22 },
    { id:"restauration", label:"Restauration",  icon:"🍽️", missions:72,  color:"#F06292", pct:19 },
    { id:"proprete",     label:"Propreté",      icon:"🧹", missions:58,  color:"#4FC3F7", pct:15 },
    { id:"commercial",   label:"Commercial",    icon:"💼", missions:34,  color:"#BA68C8", pct:9  },
    { id:"hotellerie",   label:"Hôtellerie",    icon:"🏨", missions:21,  color:"#FFB74D", pct:5  },
    { id:"distribution", label:"Distribution",  icon:"🛒", missions:12,  color:"#4DB6AC", pct:3  },
    { id:"divers",       label:"Divers",        icon:"✨", missions:5,   color:"#7986CB", pct:2  },
  ],
  pendingDocs: [
    { name:"Sophie Martin",   role:"Agent de propreté",   sector:"Propreté",    docs:6, missing:1, avatar:"👩" },
    { name:"Karim Benali",    role:"Cariste CACES 1",     sector:"Logistique",  docs:5, missing:2, avatar:"👨" },
    { name:"Lucie Fontaine",  role:"Serveuse",            sector:"Restauration",docs:7, missing:0, avatar:"👩" },
    { name:"Marc Dubois",     role:"Électricien N2",      sector:"BTP",         docs:4, missing:3, avatar:"👨" },
  ],
  recentUsers: [
    { name:"Entreprise ABC",   type:"client",      date:"Aujourd’hui",  status:"actif" },
    { name:"Thomas Saumur",    type:"prestataire", date:"Aujourd’hui",  status:"validé" },
    { name:"Marie Leclerc",    type:"client",      date:"Hier",         status:"actif" },
    { name:"Karim Benali",     type:"prestataire", date:"Hier",         status:"en attente" },
    { name:"Société XYZ",      type:"client",      date:"Il y a 2j",    status:"actif" },
    { name:"Julie Evan",       type:"prestataire", date:"Il y a 2j",    status:"validé" },
  ],
  alerts: [
    { icon:"⚠️", text:"3 litiges en attente de traitement",      color:"#E74C3C", urgent:true  },
    { icon:"📋", text:"4 dossiers prestataires à valider",        color:"#F39C12", urgent:true  },
    { icon:"💶", text:"2 paiements escrow bloqués depuis >48h",   color:"#F39C12", urgent:true  },
    { icon:"🚨", text:"1 signalement utilisateur à examiner",     color:"#E74C3C", urgent:false },
  ],
  weeklyCA: [12400, 8900, 11200, 9800, 13400, 10200, 14800],
  weeklyMissions: [42, 31, 38, 29, 45, 36, 52],
};

// Mini bar chart component
const MiniBar = ({ data, color, height=40 }) => {
  const max = Math.max(...data);
  return (
    <div style={{ display:"flex", gap:4, alignItems:"flex-end", height }}>
      {data.map((v,i) => (
        <div key={i} style={{ flex:1, background: i===data.length-1 ? color : color+"66", borderRadius:"3px 3px 0 0", height:`${(v/max)*100}%`, minHeight:4, transition:"height 0.3s" }} />
      ))}
    </div>
  );
};

// Donut chart component
const DonutChart = ({ sectors, size=120 }) => {
  const r=40, cx=60, cy=60, circ=2*Math.PI*r;
  let offset=0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E8ECF4" strokeWidth={18} />
      {sectors.map((s,i) => {
        const dash = (s.pct/100)*circ;
        const gap  = circ - dash;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={18}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            style={{ transform:"rotate(-90deg)", transformOrigin:"center" }}
          />
        );
        offset += dash;
        return el;
      })}
      <text x={cx} y={cy-6}  textAnchor="middle" fontSize="14" fontWeight="900" fill="#1A1F36">{BO_DATA.missions.total}</text>
      <text x={cx} y={cy+10} textAnchor="middle" fontSize="9"  fill="#8A93A8">missions</text>
    </svg>
  );
};

function BackofficeLogin({ onLogin, onBack }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handleDigit = (d) => {
    if(pin.length >= 4) return;
    const newPin = pin + d;
    setPin(newPin);
    setError(false);
    if(newPin.length === 4) {
      setTimeout(() => {
        if(newPin === BO_PIN) { onLogin(); }
        else { setError(true); setPin(""); setAttempts(a=>a+1); }
      }, 300);
    }
  };

  const handleDel = () => { setPin(p=>p.slice(0,-1)); setError(false); };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#1E3A7B)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, position:"relative" }}>
      <button onClick={onBack} style={{ position:"absolute", top:54, left:22, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>

      <div style={{ width:72, height:72, borderRadius:22, background:`${C.violet}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, marginBottom:20, border:`2px solid ${C.violet}66` }}>⚙️</div>
      <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 6px", fontFamily:font.display }}>Backoffice JOBER</h2>
      <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, margin:"0 0 36px" }}>Accès administrateur uniquement</p>

      {/* PIN display */}
      <div style={{ display:"flex", gap:14, marginBottom:10 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:16, height:16, borderRadius:"50%", background: pin.length>i ? (error?C.danger:C.violetLight) : "rgba(255,255,255,0.2)", transition:"background 0.2s", border:"2px solid rgba(255,255,255,0.3)" }} />
        ))}
      </div>
      {error && <p style={{ color:C.accent, fontSize:13, marginBottom:10, fontWeight:600 }}>Code incorrect {attempts>=3?"— Trop de tentatives":"— Réessayez"}</p>}
      {!error && <p style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginBottom:10 }}>Entrez votre code PIN</p>}

      {/* Keypad */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, width:240, marginTop:10 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={()=>d==="⌫"?handleDel():d!==""&&handleDigit(String(d))}
            style={{ width:72, height:72, borderRadius:22, border:"none", cursor:d===""?"default":"pointer",
              background: d===""?"transparent": d==="⌫"?"rgba(255,255,255,0.1)":`rgba(255,255,255,${d===0?0.08:0.12})`,
              color:C.white, fontSize:d==="⌫"?20:22, fontWeight:700, fontFamily:"inherit",
              transition:"all 0.15s", opacity: attempts>=3 && d!=="" ? 0.4 : 1,
            }}>
            {d}
          </button>
        ))}
      </div>
      <p style={{ color:"rgba(255,255,255,0.25)", fontSize:11, marginTop:24 }}>Code par défaut : 1234</p>
    </div>
  );
}

function BackofficeDashboard({ onBack, onModelChange }) {
  const [tab, setTab] = useState("dashboard");
  const [boConfirm, setBoConfirm] = useState(false);
  const [toggled, setToggled] = useState(false);
  const [, forceUpdate] = useState(0);
  const d = BO_DATA;

  const KPICard = ({ icon, label, value, sub, color=C.violet, onClick }) => (
    <div onClick={onClick} style={{ background:"#0D1B3E", borderRadius:16, padding:"16px 14px", boxShadow:"0 4px 16px rgba(0,0,0,0.5)", cursor:onClick?"pointer":"default" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <div style={{ width:38, height:38, borderRadius:12, background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{icon}</div>
        {sub && <span style={{ fontSize:10, fontWeight:700, color:C.success, background:`${C.success}15`, borderRadius:6, padding:"2px 6px" }}>{sub}</span>}
      </div>
      <div style={{ fontSize:24, fontWeight:800, color:C.text }}>{value}</div>
      <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour app</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"0 0 2px" }}>Administration</p>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 2px", fontFamily:font.display }}>⚙️ Backoffice JOBER</h2>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>Tableau de bord · Temps réel</p>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>● Plateforme active</div>
          </div>
        </div>
      </div>

      {toggled && (
        <div style={{ margin:"12px 18px 0", background: isLaunchPhase()?"rgba(217,119,6,0.20)":"rgba(124,111,224,0.20)", border:`1px solid ${isLaunchPhase()?"rgba(217,119,6,0.5)":"rgba(124,111,224,0.5)"}`, borderRadius:r, padding:"12px 16px", display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ fontSize:20 }}>{isLaunchPhase()?"🚀":"⚡"}</span>
          <div>
            <div style={{ fontWeight:700, color:C.white, fontSize:13 }}>Modèle {isLaunchPhase()?"Lancement (M1)":"Hybride"} actif</div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:11, marginTop:2 }}>
              {isLaunchPhase()?"Commission 20% — prestataires gratuits":"Abonnements activés — 0% commission — étape inscription ajoutée"}
            </div>
          </div>
        </div>
      )}

      {/* ── Toggle modèle M1 ↔ Hybride ── */}
      <div style={{ padding:"14px 18px", background:"rgba(255,255,255,0.02)", borderBottom:`1px solid rgba(255,255,255,0.08)` }}>
        <div style={{ background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.10)`, borderRadius:r+2, padding:"14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div>
              <div style={{ fontWeight:700, color:C.white, fontSize:13 }}>Modèle économique actif</div>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {isLaunchPhase()?"Commission 20% · Prestataires gratuits":"Abonnements + Frais MER · 0% commission"}
              </div>
            </div>
            <div style={{ background:isLaunchPhase()?"rgba(217,119,6,0.25)":"rgba(124,111,224,0.25)", borderRadius:8, padding:"5px 12px", color:isLaunchPhase()?"#FCD34D":"#A78BFA", fontWeight:800, fontSize:11 }}>
              {isLaunchPhase()?"🚀 M1":"⚡ Hybride"}
            </div>
          </div>
          {!boConfirm ? (
            <button onClick={()=>setBoConfirm(true)} style={{ width:"100%", padding:"11px", border:`1px solid ${isLaunchPhase()?"rgba(124,111,224,0.4)":"rgba(217,119,6,0.4)"}`, borderRadius:r, background:isLaunchPhase()?"rgba(124,111,224,0.12)":"rgba(217,119,6,0.12)", color:isLaunchPhase()?"#A78BFA":"#FCD34D", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              {isLaunchPhase()?"⚡ Basculer en modèle Hybride":"🚀 Revenir en phase Lancement"}
            </button>
          ) : (
            <div style={{ background:"rgba(220,38,38,0.10)", border:"1px solid rgba(220,38,38,0.30)", borderRadius:r, padding:"12px" }}>
              <div style={{ fontWeight:700, color:C.white, fontSize:13, marginBottom:6 }}>
                Confirmer la bascule vers {isLaunchPhase()?"le modèle Hybride":"la phase Lancement"} ?
              </div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.6, marginBottom:10 }}>
                {isLaunchPhase()
                  ? "Prix client = taux net pur. Abonnements prestataires activés. Frais MER facturés aux clients."
                  : "Retour à la commission 20% intégrée. Abonnements et frais MER désactivés."}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ const m=isLaunchPhase()?"hybrid":"launch"; MODEL_CONFIG.currentModel=m; setBoConfirm(false); setToggled(true); forceUpdate(n=>n+1); onModelChange?.(m); setTimeout(()=>setToggled(false),4000); }} style={{ flex:1, padding:"10px", border:"none", borderRadius:r, background:"#7C6FE0", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✓ Confirmer</button>
                <button onClick={()=>setBoConfirm(false)} style={{ flex:1, padding:"10px", border:"1px solid rgba(255,255,255,0.15)", borderRadius:r, background:"transparent", color:"rgba(255,255,255,0.5)", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, overflowX:"auto", padding:"14px 18px 0", scrollbarWidth:"none" }}>
        {[{id:"dashboard",l:"📊 KPIs"},{id:"sectors",l:"🗂️ Secteurs"},{id:"users",l:"👥 Utilisateurs"},{id:"finance",l:"💶 Finance"},{id:"moderation",l:"⚠️ Modération"}].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"9px 14px", border:"none", borderBottom:`3px solid ${tab===t.id?C.violet:"transparent"}`, background:"transparent", color:tab===t.id?C.violet:C.gray, fontWeight:tab===t.id?800:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", transition:"all 0.2s" }}>{t.l}</button>
        ))}
      </div>
      <div style={{ height:1, background:"#162547", margin:"0 18px" }} />

      <div style={{ padding:"18px 18px" }}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && <>
          {/* Alertes */}
          {d.alerts.filter(a=>a.urgent).map((a,i) => (
            <div key={i} style={{ background:`${a.color}15`, border:`1px solid ${a.color}44`, borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>{a.icon}</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1 }}>{a.text}</span>
              <span style={{ color:a.color, fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={()=>alert(`Action en cours : "${a.text}"`)}>Traiter →</span>
            </div>
          ))}

          {/* KPIs grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, margin:"14px 0" }}>
            <KPICard icon="👥" label="Utilisateurs total" value={d.users.total} sub={`+${d.users.newThisWeek} cette semaine`} color={C.violet} />
            <KPICard icon="✅" label="Missions terminées" value={d.missions.terminees} sub={`${d.missions.tauxCompletion}% de taux`} color={C.success} />
            <KPICard icon="💶" label="CA total (€)" value={`${(d.finance.caTotal/1000).toFixed(0)}k`} sub="Depuis le lancement" color={C.accentGold} />
            {isLaunchPhase()
              ? <KPICard icon="⚡" label="Commission JOBER" value={`${(d.finance.commissionJober/1000).toFixed(1)}k €`} color={C.accent} />
              : <KPICard icon="⚡" label="MRR Abonnements" value={`${(d.abonnements.premium*29+d.abonnements.elite*59).toLocaleString()} €`} sub={`+${d.abonnements.newThisWeek} cette semaine`} color="#7C6FE0" />
            }
          </div>

          {/* Bloc abonnements — hybride uniquement */}
          {!isLaunchPhase() && (
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>⚡ Abonnements prestataires</div>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <span style={{ fontSize:11, color:C.success, fontWeight:700 }}>+{d.abonnements.newThisWeek} cette sem.</span>
                  <span style={{ fontSize:11, color:C.accent, fontWeight:600 }}>-{d.abonnements.churnThisMonth} churn</span>
                </div>
              </div>
              {/* Plans */}
              <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                {[
                  { plan: ABONNEMENTS_PRESTA[0], count: d.abonnements.free    },
                  { plan: ABONNEMENTS_PRESTA[1], count: d.abonnements.premium },
                  { plan: ABONNEMENTS_PRESTA[2], count: d.abonnements.elite   },
                ].map(({ plan, count }) => {
                  const total = d.abonnements.free + d.abonnements.premium + d.abonnements.elite;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={plan.id} style={{ flex:1, background:`${plan.color}12`, border:`1px solid ${plan.color}33`, borderRadius:12, padding:"12px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:20, marginBottom:4 }}>{plan.icon}</div>
                      <div style={{ fontWeight:800, color:plan.color, fontSize:22 }}>{count}</div>
                      <div style={{ fontWeight:700, color:C.text, fontSize:11, marginTop:2 }}>{plan.label}</div>
                      <div style={{ color:C.textSub, fontSize:10, marginTop:1 }}>
                        {plan.price === 0 ? "Gratuit" : `${plan.price} €/mois`}
                      </div>
                      <div style={{ marginTop:6, height:4, background:"rgba(255,255,255,0.08)", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:plan.color, borderRadius:2 }} />
                      </div>
                      <div style={{ color:C.textSub, fontSize:10, marginTop:3 }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
              {/* MRR total */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"rgba(124,111,224,0.10)", border:"1px solid rgba(124,111,224,0.25)", borderRadius:10, padding:"10px 14px" }}>
                <div>
                  <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>MRR total</div>
                  <div style={{ fontSize:20, fontWeight:800, color:"#7C6FE0" }}>
                    {(d.abonnements.premium*29 + d.abonnements.elite*59).toLocaleString()} €/mois
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Abonnés payants</div>
                  <div style={{ fontSize:20, fontWeight:800, color:C.text }}>
                    {d.abonnements.premium + d.abonnements.elite}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Missions par statut */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:14 }}>📋 Statut des missions</div>
            <div style={{ display:"flex", gap:10, marginBottom:14 }}>
              {[{l:"En cours",v:d.missions.enCours,c:C.accentGold},{l:"Terminées",v:d.missions.terminees,c:C.success},{l:"Annulées",v:d.missions.annulees,c:C.danger}].map(s=>(
                <div key={s.l} style={{ flex:1, textAlign:"center", background:`${s.c}12`, borderRadius:12, padding:"10px 6px" }}>
                  <div style={{ fontWeight:800, color:s.c, fontSize:20 }}>{s.v}</div>
                  <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
                </div>
              ))}
            </div>
            {/* Progress bar taux completion */}
            <div style={{ fontSize:12, color:C.textSub, marginBottom:6 }}>Taux de complétion : <strong style={{ color:C.success }}>{d.missions.tauxCompletion}%</strong></div>
            <div style={{ height:8, background:"#162547", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${d.missions.tauxCompletion}%`, background:`linear-gradient(90deg,${C.success},#1e8449)`, borderRadius:4, transition:"width 1s" }} />
            </div>
          </div>

          {/* Évolution CA semaine */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>📈 CA des 7 derniers jours</div>
              <div style={{ fontWeight:800, color:C.violet, fontSize:14 }}>{d.weeklyCA[d.weeklyCA.length-1].toLocaleString()} €</div>
            </div>
            <MiniBar data={d.weeklyCA} color={C.violet} height={50} />
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              {["L","M","M","J","V","S","D"].map((j,i)=><span key={i} style={{ fontSize:9, color:C.textSub, flex:1, textAlign:"center" }}>{j}</span>)}
            </div>
          </div>

          {/* Missions / semaine */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>🗓️ Missions / semaine</div>
              <div style={{ fontWeight:800, color:C.success, fontSize:14 }}>{d.weeklyMissions[d.weeklyMissions.length-1]} missions</div>
            </div>
            <MiniBar data={d.weeklyMissions} color={C.success} height={50} />
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              {["L","M","M","J","V","S","D"].map((j,i)=><span key={i} style={{ fontSize:9, color:C.textSub, flex:1, textAlign:"center" }}>{j}</span>)}
            </div>
          </div>

          {/* Stats rapides */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            {[{l:"Note moy.",v:`${d.noteMoyenne}★`,c:C.accentGold},{l:"Taux réponse",v:`${d.tauxReponse}%`,c:C.success},{l:"Escrow",v:`${(d.finance.escrowEnAttente/1000).toFixed(1)}k€`,c:C.violet}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"12px 10px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:s.c, fontSize:16 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </>}

        {/* ── SECTEURS ── */}
        {tab==="sectors" && <>
          <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:20 }}>
            <DonutChart sectors={d.sectors} />
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>Répartition des missions</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Total : {d.missions.total} missions</div>
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:C.textSub }}>Secteur #1</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>📦 Logistique (25%)</div>
              </div>
            </div>
          </div>
          {d.sectors.map((s,i) => (
            <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ width:34, height:34, borderRadius:10, background:`${s.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{s.label}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{s.missions} missions</div>
                  </div>
                </div>
                <div style={{ fontWeight:800, color:s.color, fontSize:16 }}>{s.pct}%</div>
              </div>
              <div style={{ height:6, background:"#162547", borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${s.pct}%`, background:s.color, borderRadius:3 }} />
              </div>
            </div>
          ))}
        </>}

        {/* ── UTILISATEURS ── */}
        {tab==="users" && <>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:18 }}>
            {[{l:"Total",v:d.users.total,c:C.violet},{l:"Clients",v:d.users.clients,c:C.indigo},{l:"Prestataires",v:d.users.prestataires,c:C.accent}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 10px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:s.c, fontSize:22 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>📋 Dossiers en attente de validation</div>
          {d.pendingDocs.map((u,i) => (
            <PendingDocRow key={i} u={u} />
          ))}
<div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🕐 Dernières inscriptions</div>
          {d.recentUsers.map((u,i) => (
            <div key={i} style={{ background:"#0D1B3E", borderRadius:13, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 6px rgba(0,0,0,0.04)" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${u.type==="client"?C.violet:C.accent}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{u.type==="client"?"🏢":"👷"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{u.name}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>{u.type==="client"?"Client":"Prestataire"} · {u.date}</div>
              </div>
              <Badge color={u.status==="validé"?C.success:u.status==="actif"?C.violet:C.accentGold} small>{u.status}</Badge>
            </div>
          ))}
        </>}

        {/* ── FINANCE ── */}
        {tab==="finance" && <>
          <div style={{ background:`linear-gradient(135deg,${C.violet},${C.indigo})`, borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 4px" }}>Chiffre d'affaires total plateforme</p>
            <div style={{ color:C.white, fontSize:36, fontWeight:900 }}>{d.finance.caTotal.toLocaleString()} €</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginTop:4 }}>dont <strong style={{ color:C.accentGold }}>{d.finance.commissionJober.toLocaleString()} €</strong> de commission JOBER</div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[{l:"Commission JOBER",v:`${d.finance.commissionJober.toLocaleString()} €`,c:C.accentGold,i:"💰"},{l:"Escrow en attente",v:`${d.finance.escrowEnAttente.toLocaleString()} €`,c:C.violet,i:"🔒"},{l:"Taux de commission moy.",v:"18,4%",c:C.success,i:"📊"},{l:"Litiges en cours",v:d.finance.litiges,c:C.danger,i:"⚠️"}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontSize:22, marginBottom:6 }}>{s.i}</div>
                <div style={{ fontWeight:800, color:s.c, fontSize:18 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>Commission par secteur</div>
            {d.sectors.slice(0,5).map((s,i) => {
              const comm = Math.round(d.finance.caTotal * (s.pct/100) * (MARGES[s.id]||0.20));
              return (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:i<4?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span>{s.icon}</span>
                    <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{s.label}</span>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:800, color:C.violet, fontSize:13 }}>{comm.toLocaleString()} €</div>
                    <div style={{ color:C.textSub, fontSize:10 }}>Marge {Math.round((MARGES[s.id]||0.20)*100)}%</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>alert("📊 Export CSV\n\nLe fichier CSV contenant toutes les transactions est en cours de génération.\n\nVous le recevrez par email dans quelques instants à : admin@jober.fr")} style={{ flex:1, padding:"13px", borderRadius:r, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📊 Export CSV</button>
            <button onClick={()=>alert("📄 Rapport PDF\n\nLe rapport financier mensuel est en cours de génération.\n\nVous le recevrez par email dans quelques instants à : admin@jober.fr")} style={{ flex:1, padding:"13px", borderRadius:r, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>📄 Rapport PDF</button>
          </div>
        </>}

        {/* ── MODÉRATION ── */}
        {tab==="moderation" && <>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>🚨 Alertes actives</div>
          {d.alerts.map((a,i) => (
            <AlertRow key={i} a={a} />
          ))}
<div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 12px" }}>📋 Litiges en cours</div>
          {[
            { client:"Société ABC",  presta:"Thomas Saumur",  montant:"96 €",  motif:"Heures non effectuées",  date:"Il y a 2h" },
            { client:"Hôtel Lumière",presta:"Karim Benali",   montant:"78 €",  motif:"Qualité insuffisante",   date:"Il y a 1j" },
            { client:"LogiPro",      presta:"Julie Evan",     montant:"120 €", motif:"Annulation tardive",     date:"Il y a 2j" },
          ].map((l,i) => (
            <LitigeRow key={i} l={l} />
          ))}
<div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 12px" }}>🔧 Actions rapides</div>
          {[
            { icon:"📧", label:"Envoyer une communication globale", color:C.violet,
              action:()=>{ const msg = prompt("📧 Communication globale\n\nEntrez votre message pour tous les utilisateurs :"); if(msg) alert(`✅ Communication envoyée à tous les utilisateurs !\n\n"${msg}"\n\nNotifications push et emails envoyés.`); }},
            { icon:"🔒", label:"Suspendre un compte", color:C.danger,
              action:()=>{ const email = prompt("🔒 Suspendre un compte\n\nEntrez l’email du compte à suspendre :"); if(email) alert(`⚠️ Compte suspendu\n\nLe compte ${email} a été suspendu. L'utilisateur a été notifié par email.`); }},
            { icon:"📊", label:"Générer rapport hebdomadaire", color:C.success,
              action:()=>alert("📊 Rapport hebdomadaire\n\nGénération en cours...\n\nLe rapport sera envoyé à admin@jober.fr dans quelques minutes.")},
            { icon:"🔄", label:"Synchroniser les données", color:C.indigo,
              action:()=>alert("🔄 Synchronisation\n\nToutes les données ont été synchronisées avec succès.\n\nDernier sync : " + new Date().toLocaleTimeString("fr-FR"))},
          ].map((a,i) => (
            <div key={i} onClick={a.action} style={{ background:"#0D1B3E", borderRadius:13, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, cursor:"pointer", boxShadow:"0 2px 6px rgba(0,0,0,0.04)", transition:"transform 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.transform="translateX(4px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
            >
              <div style={{ width:38, height:38, borderRadius:11, background:`${a.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{a.icon}</div>
              <span style={{ flex:1, fontWeight:600, color:C.text, fontSize:13 }}>{a.label}</span>
              <span style={{ color:C.textSub, fontSize:16 }}>›</span>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}

// ── COMMENT ÇA MARCHE ────────────────────────────────────────────
function HowItWorksScreen({ role, onNext, onBack }) {
  const [step, setStep] = useState(0);

  const clientSteps = [
    { icon:"🔍", title:"Cherchez", desc:"Parcourez notre catalogue de prestataires par secteur. Filtrez par note, tarif, distance et disponibilité.", color:C.violet },
    { icon:"📅", title:"Réservez", desc:"Choisissez votre prestataire, sélectionnez la date, l’heure et la durée. Décrivez votre mission en détail.", color:C.indigo },
    { icon:"💳", title:"Payez en sécurité", desc:"Votre paiement est bloqué en escrow. Aucun débit définitif avant que la mission soit validée par les deux parties.", color:C.accentGold },
    { icon:"✅", title:"Validez & notez", desc:"Une fois la mission terminée, validez-la. Le paiement est libéré et vous pouvez noter le prestataire.", color:C.success },
  ];

  const prestaSteps = [
    { icon:"📝", title:"Inscrivez-vous", desc:"Créez votre profil auto-entrepreneur en quelques minutes. Renseignez vos métiers, vos documents et vos disponibilités.", color:C.accent },
    { icon:"✅", title:"Faites valider votre compte", desc:"Notre équipe vérifie votre dossier sous 24-48h. Une fois validé, vous commencez à recevoir des propositions de missions.", color:C.accentGold },
    { icon:"📋", title:"Acceptez des missions", desc:"Recevez des propositions correspondant à votre profil. Acceptez celles qui vous conviennent, refusez les autres.", color:C.violet },
    { icon:"💶", title:"Encaissez", desc:"Après validation mutuelle de la mission, votre paiement net est viré directement sur votre compte bancaire.", color:C.success },
  ];

  const steps = role === "prestataire" ? prestaSteps : clientSteps;
  const current = steps[step];

  return (
    <div style={{ minHeight:"100%", background:C.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 32px", borderRadius:"0 0 28px 28px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:16 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Comment ça marche ?</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{role==="prestataire" ? "Votre parcours prestataire" : "Votre parcours client"}</p>
      </div>

      <div style={{ flex:1, padding:"28px 22px", display:"flex", flexDirection:"column" }}>
        {isLaunchPhase() && (
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
            border:"1px solid rgba(16,217,143,0.35)",
            borderRadius:r, padding:"12px 14px", marginBottom:20,
            display:"flex", gap:10, alignItems:"center",
          }}>
            <span style={{ fontSize:18, flexShrink:0 }}>🎁</span>
            <div>
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement — 6 mois</div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5 }}>
                {role==="prestataire" ? "Accès gratuit · 0% de commission sur toutes vos missions pendant 6 mois" : "Tarifs préférentiels pendant toute la période de lancement JOBER"}
              </div>
            </div>
          </div>
        )}

        {!isLaunchPhase() && role==="prestataire" && (
          <div style={{ marginBottom:20 }}>
            <div style={{ background:`linear-gradient(135deg,${C.violet}18,${C.indigo}10)`, border:`1px solid ${C.violet}40`, borderRadius:r+4, padding:"14px 16px", marginBottom:10 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:16 }}>⚡</span>
                <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>Abonnements JOBER</div>
              </div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5, marginBottom:12 }}>
                0% de commission sur toutes vos missions. Choisissez le plan adapté à votre activité.
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {ABONNEMENTS_PRESTA.map(plan => (
                  <div key={plan.id} style={{ flex:1, background:"#0D1B3E", borderRadius:12, padding:"10px 8px", textAlign:"center", border:`1px solid ${plan.color}33` }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{plan.icon}</div>
                    <div style={{ fontWeight:700, color:plan.color, fontSize:12 }}>{plan.label}</div>
                    <div style={{ color:C.text, fontSize:13, fontWeight:800, marginTop:2 }}>
                      {plan.price===0 ? "Gratuit" : `${plan.price}€`}
                    </div>
                    {plan.price>0 && <div style={{ color:C.textSub, fontSize:10 }}>/mois</div>}
                    <div style={{ color:C.textSub, fontSize:10, marginTop:4 }}>
                      {plan.missions===999 ? "Illimité" : `${plan.missions} missions`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"10px 14px", display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:14 }}>✅</span>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5 }}>Votre plan sera sélectionné lors de l'inscription. Changez-le à tout moment depuis votre profil.</div>
            </div>
          </div>
        )}

        {!isLaunchPhase() && role==="client" && (
          <div style={{ background:`linear-gradient(135deg,${C.violet}12,${C.indigo}08)`, border:`1px solid ${C.violet}35`, borderRadius:r+4, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:20, flexShrink:0 }}>💡</span>
            <div>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:4 }}>Tarification transparente</div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.6 }}>
                Les prestataires JOBER sont abonnés — aucune commission cachée. Le tarif affiché est le vrai tarif de la mission.
              </div>
            </div>
          </div>
        )}

        {/* Progress dots */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:36 }}>
          {steps.map((_,i) => (
            <div key={i} onClick={()=>setStep(i)} style={{ width: i===step?28:8, height:8, borderRadius:4, background: i===step?current.color:C.grayLight, transition:"all 0.3s", cursor:"pointer" }} />
          ))}
        </div>

        {/* Card */}
        <div style={{ background:"#0D1B3E", borderRadius:24, padding:"36px 24px", marginBottom:24, boxShadow:"0 8px 32px rgba(0,0,0,0.1)", textAlign:"center", flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:100, height:100, borderRadius:28, background:`${current.color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, marginBottom:24 }}>{current.icon}</div>
          <div style={{ fontSize:13, fontWeight:700, color:current.color, textTransform:"uppercase", letterSpacing:2, marginBottom:10 }}>Étape {step+1}/{steps.length}</div>
          <h3 style={{ fontSize:24, fontWeight:800, color:C.text, margin:"0 0 16px", fontFamily:font.display }}>{current.title}</h3>
          <p style={{ color:C.textSub, fontSize:15, lineHeight:1.8, maxWidth:280, margin:0 }}>{current.desc}</p>
        </div>

        {/* Navigation */}
        <div style={{ display:"flex", gap:10 }}>
          {step > 0 && <Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"14px", fontSize:14 }}>← Précédent</Btn>}
          {step < steps.length-1
            ? <Btn onClick={()=>setStep(s=>s+1)} style={{ flex:2, padding:"14px", fontSize:14 }}>Suivant →</Btn>
            : <Btn variant="success" onClick={onNext} style={{ flex:2, padding:"14px", fontSize:15 }}>C'est parti ! →</Btn>
          }
        </div>
      </div>
    </div>
  );
}

// ── ONBOARDING CLIENT COMPLET ─────────────────────────────────────
function ClientOnboarding({ onComplete, onBack }) {
  const [step, setStep] = useState(1);
  const TOTAL = 3;
  const [infos, setInfos] = useState({ prenom:"", nom:"", email:"", tel:"", password:"" });
  const [societe, setSociete] = useState({ type:"entreprise", nom:"", siret:"", tva:"", adresse:"", ville:"", cp:"" });
  const [facturation, setFacturation] = useState({ mode:"carte", iban:"", titulaire:"", cgu:false });

  const stepValid = () => {
    if(step===1) return infos.prenom && infos.nom && infos.email && infos.tel && infos.password;
    if(step===2) return societe.nom && societe.adresse && societe.ville && societe.cp;
    if(step===3) return facturation.cgu;
    return true;
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <StepHeader step={step} total={TOTAL}
        title={["Vos informations","Votre société","Facturation & CGU"][step-1]}
        subtitle={["Créez votre compte client","Informations de facturation","Mode de paiement et acceptation"][step-1]}
        onBack={step===1?onBack:()=>setStep(s=>s-1)} />

      <div style={{ padding:"22px 18px" }}>
        {step===1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" value={infos.prenom} onChange={e=>setInfos({...infos,prenom:e.target.value})} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" value={infos.nom} onChange={e=>setInfos({...infos,nom:e.target.value})} /></div>
          </div>
          <Input label="Email professionnel *" type="email" placeholder="jean@societe.fr" icon="✉️" value={infos.email} onChange={e=>setInfos({...infos,email:e.target.value})} />
          <Input label="Téléphone *" placeholder="+33 6 XX XX XX XX" icon="📱" value={infos.tel} onChange={e=>setInfos({...infos,tel:e.target.value})} />
          <Input label="Mot de passe *" type="password" placeholder="Minimum 8 caractères" icon="🔒" value={infos.password} onChange={e=>setInfos({...infos,password:e.target.value})} />
        </>}

        {step===2 && <>
          <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
            {["entreprise","particulier"].map(t=>(
              <button key={t} onClick={()=>setSociete({...societe,type:t})} style={{ flex:1, padding:"10px", border:"none", borderRadius:10, cursor:"pointer", background:societe.type===t?C.white:"transparent", color:societe.type===t?C.navy:C.gray, fontWeight:societe.type===t?700:500, fontSize:13, fontFamily:"inherit", transition:"all 0.2s" }}>{t==="entreprise"?"🏢 Entreprise":"👤 Particulier"}</button>
            ))}
          </div>
          <Input label="Nom de la société *" placeholder="Mon Entreprise SAS" icon="🏢" value={societe.nom} onChange={e=>setSociete({...societe,nom:e.target.value})} />
          {societe.type==="entreprise" && <>
            <Input label="N° SIRET" placeholder="XXX XXX XXX XXXXX" value={societe.siret} onChange={e=>setSociete({...societe,siret:e.target.value})} hint="Pour la facturation et les justificatifs" />
            <Input label="N° TVA intracommunautaire" placeholder="FR XX XXXXXXXXX" value={societe.tva} onChange={e=>setSociete({...societe,tva:e.target.value})} />
          </>}
          <Input label="Adresse de facturation *" placeholder="12 rue de la Paix" icon="📍" value={societe.adresse} onChange={e=>setSociete({...societe,adresse:e.target.value})} />
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:2 }}><Input label="Ville *" placeholder="Paris" value={societe.ville} onChange={e=>setSociete({...societe,ville:e.target.value})} /></div>
            <div style={{ flex:1 }}><Input label="CP *" placeholder="75001" value={societe.cp} onChange={e=>setSociete({...societe,cp:e.target.value})} /></div>
          </div>
        </>}

        {step===3 && <>
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12, letterSpacing:0.2 }}>💳 Mode de paiement préféré</div>
            {[
              {id:"carte",      icon:"💳", label:"Carte bancaire",          sub:"Visa, Mastercard, Amex"          },
              {id:"virement",   icon:"🏦", label:"Virement SEPA",            sub:"Délai 1-2 jours"                 },
              {id:"prelevement",icon:"🔄", label:"Prélèvement automatique",  sub:"Pour les missions récurrentes"   },
            ].map(m=>(
              <div key={m.id} onClick={()=>setFacturation({...facturation,mode:m.id})} style={{
                border:`1px solid ${facturation.mode===m.id ? C.violet+"88" : C.border}`,
                borderRadius:r, padding:"13px 14px", marginBottom:8,
                cursor:"pointer", display:"flex", gap:12, alignItems:"center",
                background: facturation.mode===m.id ? `${C.violet}18` : "#162547",
                transition:"all 0.2s",
              }}>
                <div style={{ width:40, height:40, borderRadius:10, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{m.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.label}</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{m.sub}</div>
                </div>
                <div style={{
                  width:20, height:20, borderRadius:"50%",
                  border:`2px solid ${facturation.mode===m.id ? C.violet : C.borderStrong}`,
                  background: facturation.mode===m.id ? C.violet : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  flexShrink:0,
                }}>
                  {facturation.mode===m.id && <div style={{ width:8, height:8, borderRadius:"50%", background:C.white }} />}
                </div>
              </div>
            ))}
          </div>
          {facturation.mode==="virement" && <Input label="IBAN" placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX" icon="🏦" value={facturation.iban} onChange={e=>setFacturation({...facturation,iban:e.target.value})} />}

          {/* CGU */}
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>📜 Documents légaux</div>
            {[{label:"Conditions Générales d’Utilisation",icon:"📋"},{label:"Politique de confidentialité",icon:"🔒"},{label:"Politique de cookies",icon:"🍪"}].map((d,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${C.border}`:"none" }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span>{d.icon}</span>
                  <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{d.label}</span>
                </div>
                <span style={{ color:C.violet, fontSize:12, fontWeight:700, cursor:"pointer" }}>Lire →</span>
              </div>
            ))}
          </div>
          <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer", marginBottom:18 }}>
            <input type="checkbox" checked={facturation.cgu} onChange={e=>setFacturation({...facturation,cgu:e.target.checked})} style={{ marginTop:3, accentColor:C.violet }} />
            <span style={{ fontSize:13, color:C.textSub, lineHeight:1.6 }}>J'accepte les <strong style={{ color:C.violet }}>CGU</strong>, la <strong style={{ color:C.violet }}>Politique de confidentialité</strong> et je certifie que les informations fournies sont exactes.</span>
          </label>
        </>}

        <Btn full onClick={step===TOTAL?onComplete:()=>setStep(s=>s+1)} disabled={!stepValid()} style={{ fontSize:16, padding:"17px" }}>
          {step===TOTAL ? "Créer mon compte →" : "Continuer →"}
        </Btn>
      </div>
    </div>
  );
}

// ── CONTRAT DE MISSION ────────────────────────────────────────────
function ContractScreen({ provider, amount, hours, date, onSign, onBack }) {
  const p = provider || PROVIDERS[0];
  const [clientSigned, setClientSigned] = useState(false);
  const [prestaSigned, setPrestaSigned] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const [activeTab, setActiveTab] = useState("contrat");
  const bothSigned = clientSigned && prestaSigned;
  const contractNum = `CTR-JOBER-2025-${Math.floor(Math.random()*90000+10000)}`;
  const today = new Date().toLocaleDateString("fr-FR");
  const missionDate = date || "05/05/2025";
  const missionHours = hours || 8;
  const totalAmount = (typeof amount === 'object' ? amount?.amount : amount) || 124;
  const prestaNet = (p.tarifNet * missionHours).toFixed(2);

  useEffect(()=>{
    if(!bothSigned) return;
    const t = setTimeout(()=>{ setFinalised(true); onSign && onSign(); }, 1800);
    return ()=>clearTimeout(t);
  },[bothSigned]);

  if(finalised) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:80, height:80, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, marginBottom:20 }}>✍️</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Contrat signé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto 24px" }}>
        Le contrat <strong>{contractNum}</strong> est signé électroniquement et archivé. La mission peut démarrer.
      </p>
      <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:16, padding:"16px 20px", marginBottom:28, width:"100%", maxWidth:300, textAlign:"left" }}>
        {[
          "📧 Copies envoyées aux deux parties",
          "📁 Archivé dans vos espaces respectifs",
          "⏱️ Horodaté et certifié",
          "🔒 Fonds en escrow sécurisé",
          "✅ Mission autorisée à démarrer",
        ].map((s,i)=>(
          <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:12, padding:"5px 0", borderBottom:i<4?"1px solid rgba(255,255,255,0.15)":"none" }}>{s}</div>
        ))}
      </div>
      <Btn full variant="secondary" onClick={onBack} style={{ color:C.success }}>Continuer →</Btn>
    </div>
  );

  const articles = [
    {
      title:"Article 1 — Objet du contrat",
      content:`Le présent contrat a pour objet de définir les conditions dans lesquelles ${p.name}, auto-entrepreneur (ci-après "le Prestataire"), fournit ses services à la société cliente (ci-après "le Client"), dans le cadre d'une prestation de services réalisée via la plateforme JOBER.\n\nNature de la prestation : ${p.role}\nDate de la mission : ${missionDate}\nDurée estimée : ${missionHours} heures\nLieu : Paris, France (selon adresse renseignée lors de la réservation)`
    },
    {
      title:"Article 2 — Indépendance du prestataire",
      content:`Le Prestataire intervient en tant que travailleur indépendant. Il conserve toute liberté dans l'organisation et l'exécution de sa prestation. Le présent contrat ne crée aucun lien de subordination juridique entre le Client et le Prestataire.\n\nLe Prestataire n'est pas soumis aux directives du Client concernant les moyens d'exécution de la mission, mais uniquement quant aux résultats attendus. Aucune requalification en contrat de travail ne saurait résulter du présent accord.\n\nLe Prestataire demeure libre de travailler pour d'autres clients pendant et après la présente mission.`
    },
    {
      title:"Article 3 — Rémunération et paiement",
      content:`Taux horaire net prestataire : ${p.tarifNet ? p.tarifNet.toFixed(2) : "14,00"} €/h\nDurée : ${missionHours}h\nMontant net dû au Prestataire : ${prestaNet} €\nMontant total facturé au Client : ${totalAmount} € (incluant les frais de service JOBER)\n\nLe paiement est sécurisé via le système d'escrow JOBER : les fonds sont bloqués dès la réservation et libérés automatiquement au Prestataire dans un délai de 24h après validation mutuelle de la mission par les deux parties.\n\nEn cas de litige non résolu, JOBER intervient en médiateur et arbitre le déblocage des fonds sous 72h ouvrées.`
    },
    {
      title:"Article 4 — Obligations du prestataire",
      content:`Le Prestataire s'engage à :\n• Exécuter la mission avec sérieux, professionnalisme et compétence\n• Respecter scrupuleusement les horaires et le lieu convenus\n• Informer le Client et JOBER de tout empêchement dans un délai minimum de 4h avant la mission\n• Maintenir la confidentialité sur toute information relative à l'activité du Client\n• Respecter les consignes de sécurité applicables sur le lieu de mission\n• Posséder et maintenir à jour tous les diplômes, certifications et habilitations nécessaires à l'exercice de sa prestation\n• Être à jour de ses cotisations URSSAF et déclarations fiscales`
    },
    {
      title:"Article 5 — Obligations du client",
      content:`Le Client s'engage à :\n• Fournir au Prestataire toutes les informations nécessaires à la bonne exécution de la mission\n• Préparer les conditions matérielles requises pour l'exécution de la prestation\n• Valider ou contester la mission dans un délai de 48h suivant son achèvement\n• Traiter le Prestataire avec respect et dans le respect de la dignité humaine\n• Ne pas demander au Prestataire d'effectuer des tâches sortant du cadre défini dans le présent contrat\n• Ne pas tenter de court-circuiter la plateforme JOBER pour des missions futures avec le même prestataire`
    },
    {
      title:"Article 6 — Politique d’annulation",
      content:`Annulation par le Client :\n• Plus de 48h avant la mission : remboursement intégral\n• Entre 24h et 48h avant : 50% du montant retenu\n• Moins de 24h avant : 100% du montant retenu\n\nAnnulation par le Prestataire :\n• Plus de 48h avant : aucune pénalité, JOBER propose un remplaçant\n• Entre 4h et 48h avant : pénalité de 15% sur la prochaine mission\n• Moins de 4h avant : suspension temporaire du compte prestataire\n\nEn cas d'annulation par le Prestataire, JOBER s'engage à proposer un prestataire remplaçant dans les meilleurs délais. En l'absence de remplaçant, le Client est remboursé intégralement.`
    },
    {
      title:"Article 7 — Responsabilité et assurance",
      content:`Le Prestataire est seul responsable des dommages causés dans le cadre de l'exécution de sa mission et doit disposer d'une assurance Responsabilité Civile Professionnelle (RC Pro) en cours de validité.\n\nJOBER agit en qualité de simple intermédiaire et ne saurait être tenu responsable des dommages résultant d'une inexécution ou mauvaise exécution de la prestation.\n\nLe Client est responsable des conditions matérielles d'accueil et de sécurité du lieu de mission. En cas d'accident du travail survenant chez le Client, la responsabilité incombe au Client en sa qualité de donneur d'ordre.`
    },
    {
      title:"Article 8 — Confidentialité",
      content:`Le Prestataire s'engage à maintenir strictement confidentielle toute information relative à l'activité, aux clients, aux procédés, aux données ou à la stratégie du Client dont il aurait connaissance dans le cadre de la mission.\n\nCette obligation de confidentialité s'applique pendant toute la durée de la mission et pendant une période de 2 ans suivant sa fin, sans limitation géographique.\n\nEn cas de violation de cette clause, le Client pourra réclamer des dommages et intérêts proportionnels au préjudice subi.`
    },
    {
      title:"Article 9 — Propriété intellectuelle",
      content:`Toute création, production ou livrable réalisé par le Prestataire dans le cadre de la mission appartient intégralement au Client, sauf accord contraire stipulé par écrit.\n\nLe Prestataire cède au Client l'intégralité des droits patrimoniaux sur les œuvres créées dans le cadre de la mission, pour toute exploitation, sur tous supports, pour le monde entier et pour toute la durée légale de protection.`
    },
    {
      title:"Article 10 — Règlement des litiges",
      content:`En cas de différend relatif à l'exécution ou à l'interprétation du présent contrat, les parties s'engagent à recourir en premier lieu à la médiation JOBER, accessible via l'application.\n\nJOBER dispose d'un délai de 72h ouvrées pour proposer une solution amiable. En cas d'échec de la médiation, les parties pourront saisir les juridictions compétentes.\n\nLe présent contrat est soumis au droit français. En cas de litige judiciaire, les tribunaux de Paris seront seuls compétents.`
    },
    {
      title:"Article 11 — Protection des données",
      content:`Les données personnelles collectées dans le cadre du présent contrat sont traitées par JOBER SAS conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés.\n\nCes données sont utilisées exclusivement pour la gestion de la relation contractuelle et ne sont pas transmises à des tiers sans consentement explicite.\n\nChaque partie dispose d'un droit d'accès, de rectification, d'effacement et de portabilité de ses données en contactant : rgpd@jober.fr`
    },
  ];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>✍️ Contrat de mission</h2>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:11, margin:0 }}>{contractNum} · Généré le {today}</p>
          </div>
          <div style={{ textAlign:"right" }}>
            {bothSigned
              ? <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>✓ Signé</div>
              : <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"4px 10px", color:"rgba(255,255,255,0.5)", fontSize:11 }}>En attente</div>
            }
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, padding:"16px 18px 0", borderBottom:`1px solid ${C.border}` }}>
        {[{id:"contrat",label:"📋 Contrat"},{id:"parties",label:"👥 Parties"},{id:"signature",label:"✍️ Signature"}].map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{ padding:"8px 14px", border:"none", borderBottom:`2px solid ${activeTab===t.id?C.violet:"transparent"}`, background:"transparent", color:activeTab===t.id?C.violet:C.gray, fontWeight:activeTab===t.id?700:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding:"18px 18px" }}>

        {/* Tab: Contrat */}
        {activeTab==="contrat" && (
          <div>
            {/* En-tête officiel */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ textAlign:"center", paddingBottom:16, borderBottom:`1px solid ${C.border}`, marginBottom:16 }}>
                <div style={{ fontSize:24, fontWeight:800, color:C.violet, fontFamily:font.display, marginBottom:4 }}>JOBER</div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>CONTRAT DE PRESTATION DE SERVICES</div>
                <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Régi par les articles 1710 et suivants du Code Civil français</div>
                <div style={{ fontSize:11, color:C.textSub }}>N° {contractNum} · Établi le {today}</div>
              </div>

              {/* Résumé mission */}
              <div style={{ background:C.bg, borderRadius:12, padding:"14px", marginBottom:16 }}>
                <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>Résumé de la mission</div>
                {[
                  ["Type de prestation", p.role],
                  ["Date", missionDate],
                  ["Durée", `${missionHours} heures`],
                  ["Montant client total", `${totalAmount} €`],
                  ["Montant net prestataire", `${prestaNet} €`],
                ].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Articles */}
              {articles.map((a,i)=>(
                <div key={i} style={{ marginBottom:16, paddingBottom:16, borderBottom:i<articles.length-1?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:6 }}>{a.title}</div>
                  <div style={{ fontSize:12, color:C.textSub, lineHeight:1.75, whiteSpace:"pre-line" }}>{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Parties */}
        {activeTab==="parties" && (
          <div>
            {/* Client */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${C.violet}22` }}>
              <div style={{ fontSize:11, color:C.violet, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Le Client</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🏢</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>Société ABC</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Représentée par Jean Dupont</div>
                </div>
              </div>
              {[["SIRET","XXX XXX XXX XXXXX"],["N° TVA","FR XX XXXXXXXXX"],["Adresse","12 rue de Rivoli, 75001 Paris"],["Email","jean.dupont@societe-abc.fr"],["Téléphone","+33 6 XX XX XX XX"]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Prestataire */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${C.accent}22` }}>
              <div style={{ fontSize:11, color:C.accent, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Le Prestataire</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${p.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Auto-entrepreneur · {p.role}</div>
                </div>
              </div>
              {[["SIRET","XXX XXX XXX XXXXX"],["Activité déclarée","Prestation de services"],["URSSAF","À jour de cotisations ✓"],["RC Pro","Attestation validée ✓"],["Taux horaire net",`${p.tarifNet?p.tarifNet.toFixed(2):"14,00"} €/h`]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {/* JOBER */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Plateforme intermédiaire</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>⚡</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>JOBER SAS</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Plateforme de mise en relation</div>
                </div>
              </div>
              <div style={{ background:`${C.accentGold}15`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text, lineHeight:1.6 }}>
                💡 JOBER agit en qualité d'intermédiaire et gestionnaire de paiement. Les fonds de <strong>{totalAmount} €</strong> sont placés en escrow sécurisé jusqu'à validation mutuelle de la mission.
              </div>
            </div>
          </div>
        )}

        {/* Tab: Signature */}
        {activeTab==="signature" && (
          <div>
            {/* Avertissement légal */}
            <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}25`, borderRadius:r, padding:"14px 16px", marginBottom:18, fontSize:12, color:C.text, lineHeight:1.6 }}>
              ⚖️ <strong>Valeur juridique</strong><br/>
              <span style={{ color:C.textSub }}>En signant électroniquement, vous reconnaissez avoir lu et accepté l'intégralité du contrat. Cette signature a la même valeur juridique qu'une signature manuscrite conformément au règlement <strong>eIDAS n°910/2014</strong> et à la <strong>loi n°2000-230</strong> du 13 mars 2000.</span>
            </div>

            {/* Blocs de signature */}
            {[
              { role:"Client",      name:"Jean Dupont",   icon:"🏢", signed:clientSigned,  color:C.violet, onSign:()=>setClientSigned(true)  },
              { role:"Prestataire", name:p.name,          icon:p.avatar, signed:prestaSigned, color:C.accent,  onSign:()=>setPrestaSigned(true)  },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, border:`2px solid ${s.signed?C.success:C.grayLight}`, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", transition:"border 0.3s" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                  <div style={{ width:48, height:48, borderRadius:r, background:s.signed?`${C.success}18`:`${s.color}12`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{s.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>{s.role}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{s.name}</div>
                  </div>
                  {s.signed && <div style={{ background:`${C.success}15`, borderRadius:20, padding:"4px 12px", color:C.success, fontSize:12, fontWeight:700 }}>✓ Signé</div>}
                </div>

                {s.signed ? (
                  <div style={{ background:`${C.success}10`, borderRadius:10, padding:"10px 14px" }}>
                    <div style={{ fontSize:12, color:C.success, fontWeight:700 }}>✓ Signature électronique apposée</div>
                    <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>Le {today} à {new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} · IP masquée · Horodatée</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ background:C.bg, borderRadius:10, padding:"12px 14px", marginBottom:12, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
                      En signant, je confirme avoir pris connaissance de l'intégralité du contrat de prestation n° <strong>{contractNum}</strong> et en accepte toutes les clauses sans réserve.
                    </div>
                    <Btn full onClick={s.onSign} style={{ fontSize:14, padding:"14px" }}>
                      ✍️ Signer électroniquement
                    </Btn>
                  </div>
                )}
              </div>
            ))}

            {/* Statut global */}
            <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)", textAlign:"center" }}>
              {bothSigned ? (
                <div>
                  <div style={{ fontSize:28, marginBottom:8 }}>⚡</div>
                  <div style={{ fontWeight:800, color:C.violet, fontSize:14 }}>Finalisation en cours…</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:4 }}>Archivage et envoi des copies par email</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:24, marginBottom:8 }}>⏳</div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>
                    {!clientSigned && !prestaSigned ? "Les deux parties doivent signer" :
                     !clientSigned ? "En attente de la signature client" :
                     "En attente de la signature prestataire"}
                  </div>
                  <div style={{ color:C.textSub, fontSize:11, marginTop:4 }}>La mission ne peut démarrer qu'après signature des deux parties</div>
                </div>
              )}
            </div>

            {/* Info escrow */}
            <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:r, padding:"14px 16px", marginTop:14, fontSize:12, color:C.text, lineHeight:1.6 }}>
              🔒 <strong>Escrow sécurisé :</strong> Les <strong>{totalAmount} €</strong> sont actuellement bloqués chez JOBER et seront libérés vers {p.name} (<strong>{prestaNet} €</strong>) après validation mutuelle de la mission.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── CGU & POLITIQUE ───────────────────────────────────────────────
function LegalScreen({ type, onBack }) {
  const content = {
    cgu: {
      title:"Conditions Générales d’Utilisation",
      icon:"📋",
      sections:[
        { title:"1. Objet", text:"Les présentes CGU régissent l’utilisation de la plateforme JOBER, service de mise en relation entre clients et prestataires de services. En utilisant JOBER, vous acceptez sans réserve les présentes conditions." },
        { title:"2. Inscription", text:"L’inscription est gratuite. Vous devez fournir des informations exactes et à jour. Les prestataires doivent être auto-entrepreneurs en règle avec l’URSSAF et fournir les documents requis." },
        { title:"3. Responsabilités", text:"JOBER agit en qualité d’intermédiaire. La responsabilité de l’exécution de la mission incombe au prestataire. JOBER ne peut être tenu responsable des dommages résultant d’une mauvaise exécution." },
        { title:"4. Paiements", text:"Les paiements sont sécurisés via un système d’escrow. Les fonds sont bloqués lors de la réservation et libérés après validation mutuelle. La commission JOBER est incluse dans le tarif affiché." },
        { title:"5. Annulations", text:"Politique d’annulation : gratuit au-delà de 48h, 50% entre 24-48h, 100% en dessous de 24h. Ces frais s’appliquent tant aux clients qu’aux prestataires." },
        { title:"6. Litiges", text:"En cas de litige, les parties s’engagent à contacter la médiation JOBER en premier recours. À défaut de résolution amiable, les tribunaux de Paris seront compétents." },
        { title:"7. Données personnelles", text:"Vos données sont traitées conformément à notre Politique de confidentialité et au RGPD. Vous disposez d’un droit d’accès, de rectification et de suppression de vos données." },
      ]
    },
    privacy: {
      title:"Politique de confidentialité",
      icon:"🔒",
      sections:[
        { title:"1. Données collectées", text:"Nous collectons : informations d’identité (nom, prénom, email, téléphone), documents professionnels (SIRET, pièce d’identité), données de paiement (traitées par notre prestataire sécurisé), données de géolocalisation (avec votre consentement)." },
        { title:"2. Utilisation des données", text:"Vos données sont utilisées pour : la gestion de votre compte, la mise en relation client/prestataire, le traitement des paiements, l’amélioration de nos services et la lutte contre la fraude." },
        { title:"3. Conservation", text:"Vos données sont conservées pendant la durée de votre inscription, augmentée de 3 ans pour les données de facturation (obligation légale). Les documents d’identité sont supprimés après vérification." },
        { title:"4. Partage des données", text:"Vos données ne sont jamais vendues à des tiers. Elles peuvent être partagées avec : nos prestataires de paiement (Stripe), nos services de vérification d’identité, les autorités judiciaires sur réquisition." },
        { title:"5. Vos droits", text:"Conformément au RGPD, vous disposez des droits suivants : accès, rectification, suppression, portabilité, opposition. Exercez-les en nous contactant : privacy@jober.fr" },
        { title:"6. Cookies", text:"Nous utilisons des cookies essentiels au fonctionnement de l’app. Aucun cookie publicitaire n’est utilisé. Vous pouvez configurer vos préférences dans les paramètres." },
      ]
    }
  };

  const doc = content[type] || content.cgu;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ fontSize:28, marginBottom:8 }}>{doc.icon}</div>
        <h2 style={{ color:C.white, fontSize:19, fontWeight:800, margin:0, lineHeight:1.3 }}>{doc.title}</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"6px 0 0" }}>Mise à jour : janvier 2025</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {doc.sections.map((s,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:8 }}>{s.title}</div>
            <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7 }}>{s.text}</div>
          </div>
        ))}
        <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"14px 16px", marginTop:8, fontSize:12, color:C.textSub, textAlign:"center", lineHeight:1.6 }}>
          Pour toute question : <strong style={{ color:C.violet }}>legal@jober.fr</strong>
        </div>
      </div>
    </div>
  );
}

// ── FICHE DE PAIE ─────────────────────────────────────────────────
function PayslipScreen({ provider, mission, onBack }) {
  const p = provider || PROVIDERS[0];
  const m = mission || { role:"Cariste CACES 1", client:"Entrepôt XYZ", date:"12/05/2025", hours:8, tarifNet:14 };
  const brut = m.tarifNet * m.hours;
  const num = `FP-2025-${Math.floor(Math.random()*90000+10000)}`;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>📄 Attestation de mission</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>{num}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          {/* En-tête */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize:20, fontWeight:800, color:C.violet, fontFamily:font.display }}>JOBER</div>
              <div style={{ fontSize:10, color:C.textSub }}>Attestation de mission</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.text }}>{num}</div>
              <div style={{ fontSize:10, color:C.textSub }}>{new Date().toLocaleDateString("fr-FR")}</div>
            </div>
          </div>

          {/* Prestataire */}
          <div style={{ background:C.bg, borderRadius:12, padding:"14px", marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8 }}>PRESTATAIRE</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ fontSize:28 }}>{p.avatar}</div>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                <div style={{ color:C.textSub, fontSize:12 }}>Auto-entrepreneur · {p.role}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>SIRET : XXX XXX XXX XXXXX</div>
              </div>
            </div>
          </div>

          {/* Détails mission */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:10 }}>DÉTAILS DE LA MISSION</div>
            {[
              ["Client",m.client],["Mission",m.role],["Date",m.date],["Durée",`${m.hours} heures`],["Lieu","Paris, France"],
            ].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Rémunération */}
          <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}22`, borderRadius:12, padding:"14px" }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:10 }}>RÉMUNÉRATION NETTE</div>
            {[
              ["Taux horaire net",`${m.tarifNet.toFixed(2)} €/h`],
              ["Nombre d’heures",`${m.hours}h`],
              ["Montant net total",`${brut.toFixed(2)} €`],
              ["Statut","✅ Virement effectué"],
            ].map(([l,v],i)=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:i<3?`1px solid ${C.success}22`:"none" }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:i===2||i===3?800:600, color:i===2?C.success:i===3?C.success:C.text, fontSize:i===2?16:13 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop:12, fontSize:11, color:C.textSub, textAlign:"center", lineHeight:1.6 }}>
            En tant qu'auto-entrepreneur, vous êtes responsable de la déclaration de ce revenu auprès de l'URSSAF.
          </div>
        </div>

        {/* Alerte plafond CA */}
        <div style={{ background:`${C.accentGold}15`, border:`2px solid ${C.accentGold}44`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:6 }}>📊 Suivi plafond auto-entrepreneur</div>
          <div style={{ color:C.textSub, fontSize:12, marginBottom:10 }}>Plafond annuel : <strong style={{ color:C.text }}>77 700 €</strong></div>
          <div style={{ height:8, background:"#162547", borderRadius:4, overflow:"hidden", marginBottom:6 }}>
            <div style={{ height:"100%", width:"19%", background:`linear-gradient(90deg,${C.success},${C.accentGold})`, borderRadius:4 }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textSub }}>
            <span>CA réalisé : <strong style={{ color:C.success }}>14 800 €</strong></span>
            <span>Restant : <strong style={{ color:C.text }}>62 900 €</strong></span>
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={()=>alert("⬇️ Téléchargement\n\nVotre attestation de mission est en cours de téléchargement.\n\n(En production, le PDF certifié serait généré et téléchargé automatiquement.)")} style={{ flex:1, padding:"13px", fontSize:13 }}>⬇️ Télécharger</Btn>
          <Btn onClick={()=>{ const email = prompt("📧 Envoyer l’attestation\n\nEntrez l’adresse email :",`${p.name.toLowerCase().replace(" ",".")}@email.fr`); if(email) alert(`✅ Attestation envoyée à ${email}`); }} style={{ flex:1, padding:"13px", fontSize:13 }}>📧 Envoyer</Btn>
        </div>
      </div>
    </div>
  );
}

// ── HISTORIQUE MISSIONS CLIENT ────────────────────────────────────
function MissionHistoryScreen({ onNavigate, onBack }) {
  const [tab, setTab] = useState("all");

  const missions = [
    { id:1, presta:PROVIDERS[0], date:"12 Mai 2025", hours:8,  amount:131.6, status:"terminée",  role:"Cariste CACES 1"    },
    { id:2, presta:PROVIDERS[1], date:"08 Mai 2025", hours:6,  amount:108.0, status:"terminée",  role:"Chef de rang"        },
    { id:3, presta:PROVIDERS[3], date:"03 Mai 2025", hours:4,  amount:97.6,  status:"annulée",   role:"Resp. commerciale"   },
    { id:4, presta:PROVIDERS[4], date:"28 Avr 2025", hours:8,  amount:86.4,  status:"terminée",  role:"Agent de propreté"   },
    { id:5, presta:PROVIDERS[0], date:"20 Avr 2025", hours:10, amount:164.5, status:"terminée",  role:"Logisticien Senior"  },
  ];

  const filtered = tab==="all" ? missions : missions.filter(m=>m.status===tab);

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>📋 Mes missions</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{missions.length} missions au total</p>
      </div>

      <div style={{ padding:"16px 18px 0" }}>
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
          {[{id:"all",l:"Toutes"},{id:"terminée",l:"Terminées"},{id:"annulée",l:"Annulées"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"9px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:12, fontFamily:"inherit", transition:"all 0.2s" }}>{t.l}</button>
          ))}
        </div>

        {filtered.map(m=>(
          <div key={m.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
            <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:10 }}>
              <div style={{ width:48, height:48, borderRadius:r, background:`${m.presta.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{m.presta.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.presta.name}</div>
                <div style={{ color:C.textSub, fontSize:12 }}>{m.role}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>📅 {m.date} · {m.hours}h</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:C.violet, fontSize:14 }}>{m.amount.toFixed(0)} €</div>
                <Badge color={m.status==="terminée"?C.success:C.accent} small>{m.status}</Badge>
              </div>
            </div>
            {m.status==="terminée" && (
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>onNavigate("profile",m.presta)} style={{ flex:1, padding:"8px", borderRadius:11, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>👤 Profil</button>
                <button onClick={()=>onNavigate("payslip",{provider:m.presta})} style={{ flex:1, padding:"8px", borderRadius:11, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📄 Facture</button>
                <button onClick={()=>onNavigate("booking",m.presta)} style={{ flex:2, padding:"8px", borderRadius:11, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>🔄 Re-réserver</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── STATUT EN LIGNE PRESTATAIRE ───────────────────────────────────
function OnlineStatusWidget({ online, onToggle }) {
  return (
    <div onClick={onToggle} style={{ display:"flex", alignItems:"center", gap:10, background: online?`${C.success}18`:`${C.gray}15`, border:`2px solid ${online?C.success:C.grayLight}`, borderRadius:r, padding:"12px 16px", cursor:"pointer", transition:"all 0.3s", marginBottom:14 }}>
      <div style={{ width:14, height:14, borderRadius:"50%", background:online?C.success:C.gray, boxShadow:online?`0 0 8px ${C.success}`:"none", transition:"all 0.3s" }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:800, color:online?C.success:C.gray, fontSize:14 }}>{online?"En ligne — Je reçois des missions":"Hors ligne — Je ne reçois pas de missions"}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{online?"Vous apparaissez dans les recherches clients":"Activez pour recevoir des propositions"}</div>
      </div>
      <div style={{ width:44, height:24, borderRadius:12, background:online?C.success:C.grayLight, position:"relative", transition:"background 0.3s" }}>
        <div style={{ width:20, height:20, borderRadius:"50%", background:"#0D1B3E", position:"absolute", top:2, left:online?22:2, transition:"left 0.3s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }} />
      </div>
    </div>
  );
}

// ── DESKTOP SIDEBAR ───────────────────────────────────────────────
function DesktopSidebar({ screen, role, onNavigate, onlineStatus, onToggleOnline }) {
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if(!user) return;
      setUserEmail(user.email||"");
      supabase.from("profiles").select("prenom,nom").eq("id",user.id).single()
        .then(({ data:p })=>{ if(p) setUserName(`${p.prenom||""} ${p.nom||""}`.trim()); });
    });
  },[]);

  const clientNav = [
    { id:"home",           icon:"🏠", label:"Accueil"         },
    { id:"catalogue",      icon:"🗂️", label:"Secteurs"        },
    { id:"search_filters", icon:"🔍", label:"Rechercher"      },
    { id:"mission_history",icon:"📋", label:"Mes missions"    },
    { id:"team_booking",   icon:"👥", label:"Équipe"          },
    { id:"favorites",      icon:"❤️", label:"Favoris"         },
    { id:"notifications",  icon:"🔔", label:"Notifications"   },
    { id:"referral",       icon:"🎁", label:"Parrainage"      },
    { id:"dashboard",      icon:"👤", label:"Mon compte"      },
    { id:"settings",       icon:"⚙️", label:"Réglages"        },
  ];
  const prestaNav = [
    { id:"p_home",     icon:"🏠", label:"Accueil"      },
    { id:"p_missions", icon:"📋", label:"Missions"     },
    { id:"calendar",   icon:"📅", label:"Planning"     },
    { id:"notifications",icon:"🔔",label:"Notifications"},
    { id:"p_dashboard",icon:"👤", label:"Mon profil"   },
    { id:"settings",   icon:"⚙️", label:"Réglages"     },
  ];
  const nav = role === "prestataire" ? prestaNav : clientNav;
  const accentColor = role === "prestataire" ? C.accent : C.violet;

  return (
    <div style={{
      width: 240, flexShrink: 0,
      background: `linear-gradient(180deg, ${C.navy} 0%, ${C.navyMid} 100%)`,
      height: "100vh", display: "flex", flexDirection: "column",
      borderRight: `1px solid rgba(255,255,255,0.06)`,
      boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
    }}>
      {/* Logo */}
      <div style={{ padding: "28px 24px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${C.violet},${C.violetLight})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:`0 4px 12px ${C.violet}55` }}>⚡</div>
          <div style={{ fontSize:22, fontWeight:800, color:C.white, fontFamily:font.display, letterSpacing:-0.5 }}>JOBER</div>
        </div>
        {role && (
          <div style={{ marginTop:12, background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontSize:18 }}>{role==="prestataire"?"👷":"🏢"}</div>
            <div style={{ minWidth:0 }}>
              <div style={{ color:C.white, fontSize:12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{userName||userEmail||"Mon compte"}</div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{role==="prestataire"?"Prestataire":"Client"}</div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ flex:1, padding:"16px 12px", overflowY:"auto" }}>
        {nav.map(item => {
          const active = screen === item.id;
          return (
            <div key={item.id} onClick={() => onNavigate(item.id)}
              style={{
                display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                borderRadius:12, marginBottom:4, cursor:"pointer",
                background: active ? `${accentColor}22` : "transparent",
                border: `1px solid ${active ? accentColor+"44" : "transparent"}`,
                transition:"all 0.18s",
              }}
              onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
              onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}
            >
              <span style={{ fontSize:17 }}>{item.icon}</span>
              <span style={{ fontSize:13, fontWeight:active?700:400, color:active?C.white:"rgba(255,255,255,0.55)", transition:"color 0.18s" }}>{item.label}</span>
              {active && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ padding:"12px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
        {role==="prestataire" && (
          <div onClick={onToggleOnline} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:12, cursor:"pointer", background:onlineStatus?`${C.success}22`:"rgba(255,255,255,0.05)", border:`1px solid ${onlineStatus?C.success+"44":"rgba(255,255,255,0.1)"}`, marginBottom:8, transition:"all 0.2s" }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:onlineStatus?C.success:C.gray, boxShadow:onlineStatus?`0 0 6px ${C.success}`:"none" }} />
            <span style={{ fontSize:12, color:onlineStatus?C.success:"rgba(255,255,255,0.4)", fontWeight:600 }}>{onlineStatus?"En ligne":"Hors ligne"}</span>
            <div style={{ marginLeft:"auto", width:32, height:18, borderRadius:9, background:onlineStatus?C.success:C.gray, position:"relative", transition:"all 0.3s" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:"#0D1B3E", position:"absolute", top:2, left:onlineStatus?16:2, transition:"left 0.3s" }} />
            </div>
          </div>
        )}
        <div onClick={()=>onNavigate("bo_login")} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:10, cursor:"pointer", opacity:0.3, marginBottom:4 }}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.7"}
          onMouseLeave={e=>e.currentTarget.style.opacity="0.3"}
        >
          <span style={{ fontSize:14 }}>🔧</span>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.6)" }}>Administration</span>
        </div>
        <div onClick={async()=>{ await supabase.auth.signOut(); onNavigate("role"); }} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:10, cursor:"pointer", background:"rgba(242,94,94,0.08)", border:"1px solid rgba(242,94,94,0.2)" }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(242,94,94,0.18)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(242,94,94,0.08)"}
        >
          <span style={{ fontSize:14 }}>🚪</span>
          <span style={{ fontSize:11, color:"#F25E5E", fontWeight:600 }}>Se déconnecter</span>
        </div>
      </div>
    </div>
  );
}

// ── RESPONSIVE LAYOUT WRAPPER ─────────────────────────────────────
function ResponsiveLayout({ children, screen, role, isLoggedIn, onNavigate, showClientNav, showPrestaNav, onlineStatus, onToggleOnline }) {
  const { isMobile } = useResponsive();
  const [adminHover, setAdminHover] = useState(false);

  const hybridBanner = !isLaunchPhase() && !["bo_login","bo_dashboard"].includes(screen) && (
    <div style={{ background:"linear-gradient(90deg,#4F46E5,#7C3AED)", padding:"6px 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexShrink:0 }}>
      <span style={{ fontSize:13 }}>⚡</span>
      <span style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:0.5 }}>MODE HYBRIDE ACTIF — Abonnements activés · 0% commission</span>
    </div>
  );

  const showAdminBtn = !["bo_login","bo_dashboard"].includes(screen);
  const hasBottomNav = showClientNav || showPrestaNav;

  // Admin button — bottom-left
  const adminBtn = showAdminBtn && (
    <button
      onClick={() => onNavigate("bo_login")}
      onMouseEnter={() => setAdminHover(true)}
      onMouseLeave={() => setAdminHover(false)}
      title="Administration"
      style={{
        position: "absolute",
        bottom: hasBottomNav ? 74 : 14,
        left: 14,
        zIndex: 1000,
        width: adminHover ? "auto" : 34,
        height: 34,
        borderRadius: 17,
        background: adminHover ? "rgba(79,70,229,0.85)" : "rgba(255,255,255,0.07)",
        border: `1px solid ${adminHover ? "rgba(79,70,229,0.6)" : "rgba(255,255,255,0.12)"}`,
        color: adminHover ? "#fff" : "rgba(255,255,255,0.4)",
        fontSize: 15,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: adminHover ? "0 14px" : "0",
        backdropFilter: "blur(10px)",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
        overflow: "hidden",
        boxShadow: adminHover ? "0 4px 16px rgba(79,70,229,0.4)" : "none",
      }}
    >
      <span>🔧</span>
      {adminHover && <span style={{ fontSize: 12, fontWeight: 600 }}>Admin</span>}
    </button>
  );


  if (isMobile) {
    return (
      <div style={{ maxWidth:430, margin:"0 auto", height:"100vh", display:"flex", flexDirection:"column", fontFamily:"’DM Sans’,system-ui,sans-serif", background:C.bg, position:"relative", overflow:"hidden", boxShadow:"0 0 80px rgba(0,0,0,0.8)" }}>
        {hybridBanner}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden" }}>
          {children}
        </div>
        {showClientNav && <ClientNav active={screen} onNavigate={onNavigate} />}
        {showPrestaNav && <PrestaNav active={screen} onNavigate={onNavigate} />}
        {adminBtn}
      </div>
    );
  }

  // Desktop layout
  const showSidebar = isLoggedIn && !["bo_login","bo_dashboard","reset_password"].includes(screen);

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, fontFamily:"’Segoe UI’,system-ui,sans-serif", position:"relative" }}>
      {showSidebar && (
        <DesktopSidebar screen={screen} role={role} onNavigate={onNavigate} onlineStatus={onlineStatus} onToggleOnline={onToggleOnline} />
      )}
      <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", display:"flex", flexDirection:"column" }}>
        {hybridBanner}
        {/* Desktop content wrapper */}
        <div style={{
          maxWidth: showSidebar ? 900 : 480,
          width:"100%",
          margin: showSidebar ? "0 auto" : "0 auto",
          flex:1,
          padding: showSidebar ? "0 0 40px" : "0",
        }}>
          {children}
        </div>
      </div>
      {!showSidebar && adminBtn}
    </div>
  );
}

// ── CASHBACK SYSTEM ──────────────────────────────────────────────

// Paliers de fidélité
const CASHBACK_TIERS = [
  { id:"standard", label:"Standard", min:0,   max:2,   rate:0.03, color:"#8B8FA8", icon:"⭐"  },
  { id:"silver",   label:"Silver",   min:3,   max:5,   rate:0.05, color:"#C0C0C0", icon:"🥈"  },
  { id:"gold",     label:"Gold",     min:6,   max:9,   rate:0.07, color:"#F0B429", icon:"🥇"  },
  { id:"platinum", label:"Platinum", min:10,  max:999, rate:0.10, color:"#A89DF5", icon:"💎"  },
];

const getCashbackTier = (missionsThisMonth) => {
  return CASHBACK_TIERS.find(t => missionsThisMonth >= t.min && missionsThisMonth <= t.max) || CASHBACK_TIERS[0];
};

const calcCashback = (amount, missionsThisMonth) => {
  const tier = getCashbackTier(missionsThisMonth);
  return Math.round(amount * tier.rate * 100) / 100;
};

// Wallet state simulé
const INITIAL_WALLET = {
  balance:    42.50,   // solde cashback disponible
  pending:    12.80,   // en attente de validation
  totalEarned:89.30,   // total gagné depuis l'inscription
  missionsThisMonth: 4,
  history: [
    { id:1, date:"12/05/2025", mission:"Cariste CACES 1",     amount:132, cashback:6.60,  status:"disponible" },
    { id:2, date:"08/05/2025", mission:"Chef de rang",        amount:108, cashback:5.40,  status:"disponible" },
    { id:3, date:"03/05/2025", mission:"Agent de propreté",   amount:96,  cashback:4.80,  status:"disponible" },
    { id:4, date:"28/04/2025", mission:"Réceptionniste",      amount:156, cashback:7.80,  status:"utilisé"    },
    { id:5, date:"20/04/2025", mission:"Commercial terrain",  amount:180, cashback:9.00,  status:"disponible" },
    { id:6, date:"15/04/2025", mission:"Technicien surface",  amount:112, cashback:5.60,  status:"expiré"     },
    { id:7, date:"10/04/2025", mission:"Préparateur commandes",amount:96, cashback:4.80,  status:"utilisé"    },
  ],
};

function CashbackWalletScreen({ onBack, onNavigate }) {
  const w = INITIAL_WALLET;
  const tier = getCashbackTier(w.missionsThisMonth);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - w.missionsThisMonth : 0;
  const progressPct = nextTier
    ? ((w.missionsThisMonth - tier.min) / (nextTier.min - tier.min)) * 100
    : 100;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      {/* Header */}
      <div style={{ background:"#0D1B3E", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 28px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 4px" }}>Mon wallet</p>
            <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>Cashback</h2>
          </div>
          <Badge color={tier.color} small>{tier.icon} {tier.label}</Badge>
        </div>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Solde principal */}
        <div style={{
          background:`linear-gradient(135deg, rgba(124,111,224,0.20), rgba(91,79,207,0.12))`,
          border:`1px solid ${C.violet}40`,
          borderRadius:r+4, padding:"24px 20px", marginBottom:16,
          position:"relative", overflow:"hidden",
        }}>
          <div style={{ position:"absolute", top:-30, right:-30, width:140, height:140, borderRadius:"50%", background:`${C.violet}12`, pointerEvents:"none" }} />
          <p style={{ color:C.textSub, fontSize:11, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Solde disponible</p>
          <div style={{ fontSize:44, fontWeight:800, color:C.text, fontFamily:font.display, letterSpacing:-1, marginBottom:4 }}>
            {w.balance.toFixed(2)} <span style={{ fontSize:22, color:C.textSub }}>€</span>
          </div>
          <p style={{ color:C.textMuted, fontSize:12, margin:"0 0 16px" }}>
            + <span style={{ color:C.accentGold }}>{w.pending.toFixed(2)} €</span> en attente de validation
          </p>
          <Btn onClick={()=>onNavigate("search_filters")} style={{ fontSize:13, padding:"10px 20px" }}>
            Utiliser mon cashback →
          </Btn>
        </div>

        {/* Stats rapides */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          {[
            { label:"Total gagné", value:`${w.totalEarned.toFixed(2)} €`, color:C.success,  icon:"💰" },
            { label:"Ce mois",     value:`${w.missionsThisMonth} missions`, color:C.violet, icon:"📋" },
          ].map(s=>(
            <div key={s.label} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${s.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>{s.icon}</div>
              <div>
                <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{s.value}</div>
                <div style={{ color:C.textMuted, fontSize:11, marginTop:1 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Palier fidélité */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Votre statut fidélité</div>
            <Badge color={tier.color} small>{tier.icon} {tier.label} — {(tier.rate*100).toFixed(0)}%</Badge>
          </div>

          {/* Barre de progression */}
          <div style={{ height:6, background:"#162547", borderRadius:3, overflow:"hidden", marginBottom:8 }}>
            <div style={{ height:"100%", width:`${Math.min(progressPct,100)}%`, background:`linear-gradient(90deg,${tier.color},${nextTier?.color||tier.color})`, borderRadius:3, transition:"width 1s cubic-bezier(0.22,1,0.36,1)" }} />
          </div>

          {nextTier ? (
            <p style={{ color:C.textSub, fontSize:12 }}>
              Encore <strong style={{ color:C.text }}>{missionsToNext} mission{missionsToNext>1?"s":""}</strong> ce mois pour atteindre le palier{" "}
              <strong style={{ color:nextTier.color }}>{nextTier.icon} {nextTier.label} ({(nextTier.rate*100).toFixed(0)}%)</strong>
            </p>
          ) : (
            <p style={{ color:C.accentGold, fontSize:12, fontWeight:700 }}>💎 Vous êtes au palier maximum — félicitations !</p>
          )}

          {/* Tous les paliers */}
          <div style={{ display:"flex", gap:6, marginTop:14 }}>
            {CASHBACK_TIERS.map((t,i)=>(
              <div key={t.id} style={{
                flex:1, padding:"8px 4px", borderRadius:10, textAlign:"center",
                background: t.id===tier.id ? `${t.color}20` : C.bgSurface,
                border:`1px solid ${t.id===tier.id ? t.color+"55" : C.border}`,
              }}>
                <div style={{ fontSize:16, marginBottom:2 }}>{t.icon}</div>
                <div style={{ fontSize:9, fontWeight:700, color:t.id===tier.id?t.color:C.textMuted, textTransform:"uppercase", letterSpacing:0.3 }}>{t.label}</div>
                <div style={{ fontSize:11, fontWeight:800, color:t.id===tier.id?t.color:C.textMuted, marginTop:1 }}>{(t.rate*100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Historique */}
        <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>Historique des gains</div>
        {w.history.map((h,i)=>(
          <div key={i} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:8, display:"flex", alignItems:"center", gap:12, opacity:h.status==="expiré"?0.5:1 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:h.status==="disponible"?`${C.success}15`:h.status==="utilisé"?`${C.violet}15`:`${C.textMuted}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>
              {h.status==="disponible"?"💰":h.status==="utilisé"?"✓":"⌛"}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{h.mission}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{h.date} · Mission {h.amount} €</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontWeight:700, color:h.status==="disponible"?C.success:h.status==="utilisé"?C.violet:C.textMuted, fontSize:14 }}>
                +{h.cashback.toFixed(2)} €
              </div>
              <Badge color={h.status==="disponible"?C.success:h.status==="utilisé"?C.violet:C.textMuted} small>
                {h.status}
              </Badge>
            </div>
          </div>
        ))}

        {/* Info expiration */}
        <div style={{ background:"#162547", border:`1px solid ${C.border}`, borderRadius:r, padding:"12px 14px", marginTop:8, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          ℹ️ Le cashback est crédité <strong style={{ color:C.text }}>24h après validation</strong> de chaque mission. Il expire <strong style={{ color:C.text }}>6 mois</strong> après son crédit. Montant minimum d'utilisation : <strong style={{ color:C.text }}>10 €</strong>.
        </div>
      </div>
    </div>
  );
}

// ── NOTIFICATIONS VIVANTES ───────────────────────────────────────
const NOTIF_ICONS = { payment:"💶", mission:"📋", urgent:"🚨", cashback:"💰", rating:"⭐", reminder:"⏰", contract:"✍️", system:"🔔" };
const NOTIF_COLORS = { payment:C.success, mission:C.violet, urgent:C.accent, cashback:C.accentGold, rating:C.accentGold, reminder:C.textSub, contract:C.violet, system:C.textMuted };

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if(diff < 60) return "À l’instant";
  if(diff < 3600) return `Il y a ${Math.floor(diff/60)} min`;
  if(diff < 86400) return `Il y a ${Math.floor(diff/3600)}h`;
  return `Il y a ${Math.floor(diff/86400)}j`;
}

function NotificationsScreen({ onBack, onNavigate }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let channel;
    (async()=>{
      const { data:authData, error:authErr } = await supabase.auth.getUser();
      const user = authData?.user;
      if(authErr || !user){ setLoading(false); return; }

      const { data:notifData } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at",{ascending:false}).limit(50);
      setNotifs(notifData||[]);
      setLoading(false);

      channel = supabase.channel("notifs_"+user.id)
        .on("postgres_changes",{ event:"INSERT", schema:"public", table:"notifications", filter:`user_id=eq.${user.id}` },
          payload => setNotifs(prev=>[payload.new, ...prev])
        ).subscribe();
    })();
    return ()=>{ if(channel) supabase.removeChannel(channel); };
  },[]);

  const unread = notifs.filter(n=>!n.read).length;

  const markAllRead = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if(user) await supabase.from("notifications").update({read:true}).eq("user_id",user.id).eq("read",false);
    setNotifs(ns=>ns.map(n=>({...n,read:true})));
  };

  const markOneRead = async (id) => {
    await supabase.from("notifications").update({read:true}).eq("id",id);
    setNotifs(ns=>ns.map(n=>n.id===id?{...n,read:true}:n));
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 20px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Notifications</h2>
            {unread > 0 && <p style={{ color:C.textSub, fontSize:12, margin:"4px 0 0" }}>{unread} non lue{unread>1?"s":""}</p>}
          </div>
          {unread > 0 && (
            <button onClick={markAllRead} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:10, padding:"6px 12px", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
              Tout marquer lu
            </button>
          )}
        </div>
      </div>

      <div style={{ padding:"16px 18px" }}>
        {loading && <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>}
        {!loading && notifs.length===0 && (
          <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔔</div>
            <div>Aucune notification pour l'instant</div>
          </div>
        )}
        {notifs.map(n => {
          const color = NOTIF_COLORS[n.type] || C.textMuted;
          const icon  = NOTIF_ICONS[n.type]  || "🔔";
          return (
            <div key={n.id} onClick={()=>markOneRead(n.id)} style={{
              background: n.read ? "#0D1B3E" : `${color}12`,
              border: `1px solid ${n.read ? C.border : color+"35"}`,
              borderRadius:r, padding:"14px 15px", marginBottom:8,
              cursor:"pointer", display:"flex", gap:12, alignItems:"flex-start",
              transition:"all 0.2s", position:"relative",
            }}>
              {!n.read && <div style={{ position:"absolute", top:14, right:14, width:8, height:8, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}` }} />}
              <div style={{ width:40, height:40, borderRadius:12, background:`${color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{icon}</div>
              <div style={{ flex:1, paddingRight:16 }}>
                <div style={{ fontWeight:n.read?600:700, color:C.text, fontSize:13, marginBottom:3 }}>{n.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{n.body}</div>
                <div style={{ color:C.textMuted, fontSize:10, marginTop:5 }}>{timeAgo(n.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TIMELINE DE MISSION ───────────────────────────────────────────
function MissionTimeline({ status="in_progress" }) {
  const steps = [
    { id:"booked",    label:"Réservé",       icon:"📋", desc:"Mission confirmée"          },
    { id:"signed",    label:"Contrat signé", icon:"✍️", desc:"Les deux parties ont signé" },
    { id:"enroute",   label:"En route",      icon:"🚗", desc:"Le prestataire arrive"       },
    { id:"in_progress",label:"En cours",    icon:"⚡", desc:"Mission en cours"            },
    { id:"done",      label:"Terminé",       icon:"✅", desc:"Mission effectuée"           },
    { id:"paid",      label:"Payé",          icon:"💶", desc:"Paiement libéré"             },
  ];
  const activeIdx = steps.findIndex(s=>s.id===status);

  return (
    <div style={{ padding:"16px 0" }}>
      {steps.map((s,i) => {
        const done    = i < activeIdx;
        const active  = i === activeIdx;
        const pending = i > activeIdx;
        return (
          <div key={s.id} style={{ display:"flex", gap:12, marginBottom: i<steps.length-1?0:0, position:"relative" }}>
            {/* Vertical line */}
            {i < steps.length-1 && (
              <div style={{ position:"absolute", left:19, top:40, width:2, height:28, background: done?C.violet:C.border, borderRadius:1, transition:"background 0.3s" }} />
            )}
            <div style={{ width:40, height:40, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              background: active ? C.violet : done ? `${C.violet}30` : C.bgSurface,
              border: `2px solid ${active ? C.violet : done ? C.violet+"60" : C.border}`,
              boxShadow: active ? `0 0 16px ${C.violet}55` : "none",
              transition:"all 0.3s",
            }}>
              {done ? "✓" : s.icon}
            </div>
            <div style={{ paddingBottom:28, flex:1 }}>
              <div style={{ fontWeight: active?700:600, color: active?C.text:done?C.textSub:C.textMuted, fontSize:13 }}>{s.label}</div>
              <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>{s.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ÉCRAN NOTATION ────────────────────────────────────────────────
function RatingScreen({ provider, missionId, onSubmit, onBack }) {
  const p = provider || PROVIDERS[0];
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  const TAGS_POS = ["Ponctuel","Efficace","Professionnel","Communicatif","Excellent travail","Je recommande"];
  const TAGS_NEG = ["En retard","Qualité insuffisante","Communication difficile"];

  if(submitted) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.violet}33,#0A1628)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:16 }}>⭐</div>
      <h2 style={{ color:C.text, fontSize:24, fontWeight:700, margin:"0 0 10px", fontFamily:font.display }}>Merci pour votre avis !</h2>
      <p style={{ color:C.textSub, fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto 28px" }}>Votre note de <strong style={{ color:C.accentGold }}>{"★".repeat(rating)}</strong> a été publiée sur le profil de <strong style={{ color:C.text }}>{p.name}</strong>.</p>
      <Btn full onClick={onSubmit}>Retour à l'accueil</Btn>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Noter la mission</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Votre avis aide la communauté JOBER</p>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Carte prestataire */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20, display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ width:52, height:52, borderRadius:r, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{p.avatar}</div>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle || p.role}</div>
          </div>
        </div>

        {/* Étoiles géantes */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <p style={{ color:C.textSub, fontSize:13, marginBottom:14, letterSpacing:0.3 }}>Comment s'est passée la mission ?</p>
          <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:10 }}>
            {[1,2,3,4,5].map(i => (
              <span key={i}
                onClick={()=>setRating(i)}
                onMouseEnter={()=>setHover(i)}
                onMouseLeave={()=>setHover(0)}
                style={{
                  fontSize:44, cursor:"pointer",
                  color: i<=(hover||rating) ? C.accentGold : "rgba(255,255,255,0.12)",
                  transition:"all 0.15s",
                  transform: i<=(hover||rating) ? "scale(1.15)" : "scale(1)",
                  display:"inline-block",
                }}>★</span>
            ))}
          </div>
          {rating > 0 && (
            <p style={{ color:C.accentGold, fontSize:13, fontWeight:700 }}>
              {["","😞 Très décevant","😕 Décevant","😐 Correct","😊 Bien","🤩 Excellent !"][rating]}
            </p>
          )}
        </div>

        {/* Tags */}
        {rating > 0 && (
          <div style={{ marginBottom:20 }}>
            <p style={{ color:C.textSub, fontSize:12, marginBottom:10, letterSpacing:0.5, textTransform:"uppercase" }}>Points forts</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {(rating >= 3 ? TAGS_POS : TAGS_NEG).map(t => (
                <button key={t} onClick={()=>setTags(ts=>ts.includes(t)?ts.filter(x=>x!==t):[...ts,t])} style={{
                  padding:"7px 14px", borderRadius:100, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                  background: tags.includes(t) ? C.violet : "rgba(255,255,255,0.06)",
                  color: tags.includes(t) ? C.white : C.textSub,
                  border: `1px solid ${tags.includes(t) ? C.violet : C.border}`,
                  transition:"all 0.2s",
                }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {/* Commentaire */}
        <div style={{ marginBottom:20 }}>
          <label style={{ display:"block", color:C.textSub, fontSize:11, letterSpacing:0.8, textTransform:"uppercase", marginBottom:8, fontWeight:600 }}>Commentaire (optionnel)</label>
          <textarea
            value={comment}
            onChange={e=>setComment(e.target.value)}
            placeholder="Décrivez votre expérience avec ce prestataire…"
            style={{ width:"100%", padding:"13px 15px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", background:"#112240", color:C.text, lineHeight:1.6 }}
          />
        </div>

        <Btn full disabled={rating===0} onClick={()=>setSubmitted(true)} style={{ fontSize:15, padding:"16px" }}>
          ⭐ Publier mon avis
        </Btn>
        {rating===0 && <p style={{ textAlign:"center", color:C.textMuted, fontSize:12, marginTop:8 }}>Sélectionnez une note pour continuer</p>}
      </div>
    </div>
  );
}

// ── UPLOAD DOCUMENTS ─────────────────────────────────────────────
function DocUploadScreen({ onBack }) {
  const [docs, setDocs] = useState([
    { id:"kbis",    label:"Extrait KBIS / Avis INSEE",     icon:"📋", status:"valid",   expires:"01/2026", info:"Validé le 15/01/2025" },
    { id:"urssaf",  label:"Attestation URSSAF",            icon:"🏛️", status:"expiring",expires:"06/2025", info:"Expire dans 3 semaines" },
    { id:"cni",     label:"Pièce d’identité",              icon:"🪪", status:"valid",   expires:"09/2029", info:"Validé le 15/01/2025" },
    { id:"vitale",  label:"Carte Vitale",                  icon:"💊", status:"valid",   expires:"—",       info:"Validé le 15/01/2025" },
    { id:"domicile",label:"Justificatif de domicile",      icon:"🏠", status:"missing", expires:"—",       info:"Document requis"       },
    { id:"rib",     label:"RIB / IBAN",                    icon:"💳", status:"valid",   expires:"—",       info:"Validé le 15/01/2025" },
    { id:"rcpro",   label:"Attestation RC Pro",            icon:"🛡️", status:"missing", expires:"—",       info:"Recommandé"            },
  ]);

  const statusColors = { valid:C.success, expiring:C.accentGold, missing:C.accent };
  const statusLabels = { valid:"✓ Valide", expiring:"⚠️ Expire bientôt", missing:"Manquant" };

  const handleUpload = (id) => {
    setDocs(ds => ds.map(d => d.id===id ? {...d, status:"valid", info:"Validé à l’instant"} : d));
    alert(`📤 Document "${docs.find(d=>d.id===id)?.label}" envoyé !\n\nNos équipes le vérifieront sous 24h ouvrées.`);
  };

  const valid   = docs.filter(d=>d.status==="valid").length;
  const total   = docs.length;
  const pct     = Math.round((valid/total)*100);

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Mes documents</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Maintenez vos documents à jour pour rester actif</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Progression */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Dossier complet</span>
            <span style={{ fontWeight:800, color: pct===100?C.success:C.accentGold, fontSize:14 }}>{pct}%</span>
          </div>
          <div style={{ height:6, background:C.bgSurface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.violet},${C.success})`, borderRadius:3, transition:"width 0.5s" }} />
          </div>
          <p style={{ color:C.textMuted, fontSize:11, marginTop:8 }}>{valid}/{total} documents validés</p>
        </div>

        {/* Liste documents */}
        {docs.map((d,i) => (
          <div key={d.id} style={{ background:"#0D1B3E", border:`1px solid ${d.status==="valid" ? C.border : statusColors[d.status]+"40"}`, borderRadius:r, padding:"14px 15px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${statusColors[d.status]}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{d.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{d.label}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{d.info}{d.expires!=="—" ? ` · Expire : ${d.expires}` : ""}</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <Badge color={statusColors[d.status]} small>{statusLabels[d.status]}</Badge>
              {d.status !== "valid" && (
                <button onClick={()=>handleUpload(d.id)} style={{ background:C.violet, border:"none", borderRadius:8, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  📤 Charger
                </button>
              )}
            </div>
          </div>
        ))}

        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"12px 14px", marginTop:8, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          💡 Les documents sont vérifiés par notre équipe sous <strong style={{ color:C.text }}>24h ouvrées</strong>. Formats acceptés : PDF, JPG, PNG.
        </div>
      </div>
    </div>
  );
}


// ── OFFRE DE LANCEMENT ───────────────────────────────────────────
const LAUNCH_MONTHS = 6;

function LaunchBadge({ context="home" }) {
  if(!isLaunchPhase()) return null;
  const msgs = {
    home:    { icon:"🎉", title:"Offre de lancement — 6 mois", sub:"Tarifs préférentiels · Profitez-en avant la fin de la période" },
    presta:  { icon:"🚀", title:"Phase de lancement — 6 mois offerts", sub:"Accès illimité gratuit · 0% de commission sur vos missions" },
    booking: { icon:"💡", title:"Tarif de lancement", sub:"Commission réduite pendant la période de lancement de 6 mois" },
  };
  const m = msgs[context] || msgs.home;
  return (
    <div style={{ background:"rgba(16,217,143,0.10)", border:"1px solid rgba(16,217,143,0.30)", borderRadius:r, padding:"11px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
      <span style={{ fontSize:18, flexShrink:0 }}>{m.icon}</span>
      <div>
        <div style={{ fontWeight:700, color:"#10D98F", fontSize:13 }}>{m.title}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{m.sub}</div>
      </div>
    </div>
  );
}


// ── ABONNEMENT PRESTATAIRE ────────────────────────────────────────
function AbonnementPrestaScreen({ onBack }) {
  const [current,setCurrent]=useState("free");
  const [billing,setBilling]=useState("monthly");
  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:40 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>Mon abonnement</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>0% de commission sur vos missions</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {isLaunchPhase() && (
          <div style={{ background:C.success+"12", border:`1px solid ${C.success}35`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"center" }}>
            <span style={{ fontSize:20 }}>🚀</span>
            <div>
              <div style={{ fontWeight:700, color:C.success, fontSize:13 }}>Phase de lancement — Accès gratuit</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Toutes les missions sont incluses. Choisissez votre plan pour après le lancement.</div>
            </div>
          </div>
        )}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
          <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
            {[{id:"monthly",label:"Mensuel"},{id:"yearly",label:"Annuel -20%"}].map(b=>(
              <button key={b.id} onClick={()=>setBilling(b.id)} style={{ padding:"9px 18px", border:"none", borderRadius:10, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:billing===b.id?700:500, background:billing===b.id?C.violet:"transparent", color:billing===b.id?C.white:C.textSub }}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        {ABONNEMENTS_PRESTA.map(plan=>{
          const price=billing==="yearly"?Math.round(plan.price*0.8):plan.price;
          const active=current===plan.id;
          return (
            <div key={plan.id} style={{ background:active?plan.color+"15":"#0D1B3E", border:`2px solid ${active?plan.color:C.border}`, borderRadius:r+4, padding:"16px", marginBottom:12, position:"relative" }}>
              {plan.popular&&<div style={{ position:"absolute", top:12, right:12, background:plan.color, borderRadius:8, padding:"3px 10px", color:"#fff", fontSize:11, fontWeight:700 }}>Populaire</div>}
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:10 }}>
                <div style={{ width:42, height:42, borderRadius:12, background:plan.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{plan.icon}</div>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{plan.label}</div>
                  <div style={{ fontWeight:800, color:plan.color, fontSize:20 }}>{price===0?"Gratuit":price+" €"}{price>0&&<span style={{ fontSize:12, color:C.textSub, fontWeight:400 }}>/mois{isLaunchPhase()?" après lancement":""}</span>}</div>
                </div>
              </div>
              {plan.features.map((f,i)=>(
                <div key={i} style={{ display:"flex", gap:8, padding:"3px 0" }}>
                  <span style={{ color:plan.color, fontSize:13 }}>✓</span>
                  <span style={{ color:C.text, fontSize:12 }}>{f}</span>
                </div>
              ))}
              {price>0&&active&&<div style={{ marginTop:10, background:plan.color+"12", borderRadius:10, padding:"9px 12px", fontSize:12, color:C.textSub }}>Rentabilisé dès {Math.ceil(price/(8*14*0.20))} missions/mois</div>}
              <button onClick={()=>{ if(plan.id!==current&&window.confirm("Passer au plan "+plan.label+" ?")) setCurrent(plan.id); }} style={{ width:"100%", padding:"11px", border:"none", borderRadius:r, cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, marginTop:12, background:active?plan.color+"30":plan.price===0?C.bgSurface:`linear-gradient(135deg,${plan.color},${plan.color}cc)`, color:active?plan.color:plan.price===0?C.textSub:"#fff" }}>
                {active?"✓ Plan actuel":plan.price===0?"Utiliser gratuitement":"Choisir "+plan.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ── MISSION REQUEST SCREEN ───────────────────────────────────────
function MissionRequestScreen({ sector, onSubmit, onBack }) {
  const s = sector || {};
  const jobs = METIERS[s.id] || [];
  const [metier, setMetier]       = useState("");
  const [date, setDate]           = useState("");
  const [hours, setHours]         = useState(8);
  const [description, setDesc]    = useState("");
  const [adresse, setAdresse]     = useState("");
  const [ville, setVille]         = useState("");
  const [sending, setSending]     = useState(false);
  const isValid = date && adresse && ville;
  const { providers:allProviders } = useProviders();
  const matchCount = allProviders.filter(p => p.sector===s.id && (!metier || p.jobTitle===metier) && p.available).length;

  const handleSend = async () => {
    setSending(true);
    const mission = { sector:s, metier, date, hours, description, adresse, ville };
    try {
      const { data:_ud2 } = await supabase.auth.getUser();
      const user = _ud2?.user;
      if(user){
        const { data } = await supabase.from("missions").insert({
          client_id: user.id, sector: s.id, metier, date, hours,
          ville, description, status: "broadcast",
        }).select().single();
        if(data) mission.id = data.id;
      }
    } catch(e){ console.error("mission insert error", e); }
    setSending(false);
    onSubmit(mission);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ fontSize:32, marginBottom:6 }}>{s.icon||"📢"}</div>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Publier une mission</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{s.label} · {matchCount} prestataire{matchCount>1?"s":""} disponible{matchCount>1?"s":""}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>📢</span>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Diffusion à tous les prestataires disponibles</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2, lineHeight:1.5 }}>Votre demande est envoyée à tous les prestataires du secteur. Vous choisissez parmi ceux qui acceptent.</div>
          </div>
        </div>

        {jobs.length > 0 && (
          <Select label="Métier recherché" options={["Tous les métiers du secteur", ...jobs]} value={metier||"Tous les métiers du secteur"} onChange={e=>setMetier(e.target.value==="Tous les métiers du secteur"?"":e.target.value)} />
        )}

        <Input label="Date de la mission *" type="date" value={date} onChange={e=>setDate(e.target.value)} />

        <div style={{ marginBottom:16 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Durée estimée : <strong style={{ color:C.text }}>{hours}h</strong></label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {[4,6,8,10,12].map(h=>(
              <button key={h} onClick={()=>setHours(h)} style={{ padding:"9px 18px", borderRadius:20, border:"none", cursor:"pointer", background:hours===h?C.violet:C.grayLight, color:hours===h?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{h}h</button>
            ))}
          </div>
        </div>

        <Input label="Adresse de la mission *" placeholder="12 rue de la Paix" icon="📍" value={adresse} onChange={e=>setAdresse(e.target.value)} />
        <Input label="Ville *" placeholder="Paris" value={ville} onChange={e=>setVille(e.target.value)} />

        <div style={{ marginBottom:20 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:6 }}>Description de la mission <span style={{ fontWeight:400 }}>(optionnel)</span></label>
          <textarea placeholder="Tâches attendues, matériel fourni, accès, consignes…" value={description} onChange={e=>setDesc(e.target.value)}
            style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", color:C.text, background:"#0D1B3E" }} />
        </div>

        <Btn full disabled={!isValid||sending} onClick={handleSend} style={{ fontSize:16, padding:"17px" }}>
          {sending ? "Envoi…" : "📢 Envoyer aux prestataires →"}
        </Btn>
      </div>
    </div>
  );
}

// ── MISSION BROADCAST SCREEN ─────────────────────────────────────
function MissionBroadcastScreen({ mission, onChoose, onCancel }) {
  const m = mission || {};
  const { providers } = useProviders();
  const matching = providers.filter(p=>p.sector===m.sector?.id && (!m.metier||p.jobTitle===m.metier) && p.available);
  const [responses, setResponses] = useState([]);
  const [tick, setTick]           = useState(0);

  // Spinner CSS
  useEffect(()=>{
    const style = document.getElementById("jober-spin-style");
    if(!style){
      const s=document.createElement("style");
      s.id="jober-spin-style";
      s.textContent="@keyframes joberSpin{to{transform:rotate(360deg)}}";
      document.head.appendChild(s);
    }
  },[]);

  // Simulate prestataires responding one by one
  useEffect(()=>{
    if(!matching.length) return;
    setResponses([]);
    const timers = matching.map((p,i)=>{
      const delay = 2500 + i*1800 + Math.random()*1000;
      const accepted = Math.random() < 0.72;
      return setTimeout(()=>setResponses(prev=>[...prev,{provider:p, accepted}]), delay);
    });
    return ()=>timers.forEach(clearTimeout);
  },[m.sector?.id, m.metier]);

  const accepted  = responses.filter(r=>r.accepted);
  const declined  = responses.filter(r=>!r.accepted);
  const waiting   = matching.length - responses.length;
  const tarifLabel = p => formatE(prixClient(p.tarifNet, p.sector));

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <style>{`@keyframes joberSpin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 20px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onCancel} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Annuler la demande</button>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>📢 Demande diffusée</h2>
        <p style={{ color:C.textSub, fontSize:12, margin:0 }}>
          {m.sector?.label}{m.metier?" · "+m.metier:""} · {m.date} · {m.hours}h · {m.ville}
        </p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Compteurs */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:18 }}>
          {[
            { label:"Notifiés",   value:matching.length, color:C.violet   },
            { label:"Accepté",    value:accepted.length, color:C.success  },
            { label:"Décliné",    value:declined.length, color:C.accent   },
            { label:"En attente", value:waiting,         color:C.textSub  },
          ].map(s=>(
            <div key={s.label} style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 8px", textAlign:"center", border:`1px solid ${s.color}33` }}>
              <div style={{ fontWeight:800, color:s.color, fontSize:20 }}>{s.value}</div>
              <div style={{ color:C.textSub, fontSize:9, marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Indicateur attente */}
        {waiting > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:16, display:"flex", gap:12, alignItems:"center", border:`1px solid ${C.border}` }}>
            <div style={{ width:32, height:32, borderRadius:"50%", border:`3px solid ${C.violet}`, borderTopColor:"transparent", animation:"joberSpin 0.9s linear infinite", flexShrink:0 }} />
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>En attente de {waiting} prestataire{waiting>1?"s":""}</div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Les réponses arrivent en temps réel…</div>
            </div>
          </div>
        )}

        {/* Liste des acceptants */}
        {accepted.length > 0 && (
          <>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>
              ✅ {accepted.length} prestataire{accepted.length>1?"s":""} disponible{accepted.length>1?"s":""}
              {waiting===0 && <span style={{ fontWeight:500, color:C.textSub, fontSize:12 }}> — choisissez maintenant</span>}
            </div>
            {accepted.map(({provider:p})=>(
              <div key={p.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:10, border:`2px solid ${C.success}55`, boxShadow:"0 4px 16px rgba(0,0,0,0.4)" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ width:48, height:48, borderRadius:14, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{p.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle}</div>
                    <div style={{ display:"flex", gap:8, marginTop:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:12, color:C.accentGold, fontWeight:700 }}>★ {p.rating}</span>
                      <span style={{ color:C.textMuted, fontSize:11 }}>·</span>
                      <span style={{ fontSize:12, color:C.textSub }}>{p.experience}</span>
                      <span style={{ color:C.textMuted, fontSize:11 }}>·</span>
                      <span style={{ fontSize:12, color:C.textSub }}>{p.distance}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight:800, color:C.success, fontSize:16 }}>{tarifLabel(p)}</div>
                    <div style={{ color:C.textSub, fontSize:10, textAlign:"right" }}>{m.hours}h = {formatE(prixClient(p.tarifNet,p.sector)*m.hours).replace("/h","")}</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn full variant="success" onClick={()=>onChoose(p)} style={{ padding:"12px", fontSize:14 }}>
                    Choisir {p.name.split(" ")[0]} →
                  </Btn>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Déclinés */}
        {declined.length > 0 && (
          <div style={{ marginTop:8, marginBottom:12 }}>
            <div style={{ fontWeight:600, color:C.textSub, fontSize:12, marginBottom:8 }}>
              {declined.length} prestataire{declined.length>1?"s":""} indisponible{declined.length>1?"s":""}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {declined.map(({provider:p})=>(
                <div key={p.id} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"7px 12px", display:"flex", gap:8, alignItems:"center", opacity:0.45 }}>
                  <span style={{ fontSize:16 }}>{p.avatar}</span>
                  <span style={{ fontSize:12, color:C.textSub }}>{p.name.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* État vide initial */}
        {responses.length===0 && (
          <div style={{ textAlign:"center", padding:"48px 20px" }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📱</div>
            <div style={{ fontWeight:700, color:C.text, fontSize:16, marginBottom:8 }}>Notifications envoyées</div>
            <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7 }}>
              {matching.length} prestataire{matching.length>1?"s":""} consulte{matching.length===1?"":"nt"} votre demande…<br/>
              Les réponses apparaissent ici en temps réel.
            </div>
          </div>
        )}

        {/* Plus personne en attente, aucun acceptant */}
        {waiting===0 && accepted.length===0 && (
          <div style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}30`, borderRadius:r, padding:"14px 16px", marginTop:8, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Aucun prestataire disponible</div>
            <div style={{ color:C.textSub, fontSize:12 }}>Essayez en mode urgence ou changez de date.</div>
            <Btn onClick={onCancel} style={{ marginTop:14 }}>Modifier la demande</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── APP ROOT ──────────────────────────────────────────────────────
export default function App() {
  const [screen,setScreen]=useState("splash");
  const [model,setModel]=useState(()=>MODEL_CONFIG.currentModel);
  const [role,setRole]=useState(null);
  const [supaUser,setSupaUser]=useState(null);
  const [selectedProvider,setSelectedProvider]=useState(null);
  const [pendingProvider,setPendingProvider]=useState(null);
  const [selectedSector,setSelectedSector]=useState(null);
  const [paymentAmount,setPaymentAmount]=useState(0);
  const [paymentHours,setPaymentHours]=useState(8);
  const [boUnlocked,setBoUnlocked]=useState(false);
  const [legalType,setLegalType]=useState("cgu");
  const [payslipData,setPayslipData]=useState(null);
  const [onlineStatus,setOnlineStatus]=useState(true);
  const [pendingMission,setPendingMission]=useState(null);
  const [bookingSource,setBookingSource]=useState("profile");

  // Écouter les changements de session (déconnexion, reset password)
  // Ne pas auto-naviguer au démarrage : l'utilisateur passe toujours par le splash
  useEffect(()=>{
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event,session)=>{
      setSupaUser(session?.user||null);
      if(event==="PASSWORD_RECOVERY") { setScreen("reset_password"); return; }
      if(event==="SIGNED_OUT") { setRole(null); setScreen("role"); }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Appelé quand l'utilisateur clique "Commencer" sur le splash
  const handleSplashNext = async () => {
    const { data:{ session } } = await supabase.auth.getSession();
    if(session){
      setSupaUser(session.user);
      const { data:profile } = await supabase.from("profiles").select("role").eq("id",session.user.id).single();
      if(profile?.role){ setRole(profile.role); setScreen(profile.role==="prestataire"?"p_home":"home"); return; }
    }
    setScreen("role");
  };

  const navigate=(to,data)=>{
    if(to==="profile"||to==="chat"||to==="tracking"||to==="validation"||to==="cancellation"||to==="contract") setSelectedProvider(data);
    if(to==="sector_detail") setSelectedSector(data);
    if(to==="booking") { setSelectedProvider(data); setBookingSource("profile"); }
    if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); }
    if(to==="legal") setLegalType(data||"cgu");
    if(to==="payslip") setPayslipData(data);
    if(to==="mission_request") setSelectedSector(data);
    if(to==="mission_broadcast") setPendingMission(data);
    setScreen(to);
  };

  const clientScreens=["home","catalogue","search_filters","dashboard","settings","contact_support"];
  const prestaScreens=["p_home","p_missions","p_dashboard","calendar","settings","contact_support"];
  const showClientNav=role==="client"&&clientScreens.includes(screen);
  const showPrestaNav=role==="prestataire"&&prestaScreens.includes(screen);

  return (
    <ResponsiveLayout
      screen={screen} role={role} isLoggedIn={!!supaUser} onNavigate={navigate}
      showClientNav={showClientNav} showPrestaNav={showPrestaNav}
      onlineStatus={onlineStatus} onToggleOnline={()=>setOnlineStatus(s=>!s)}
    >
      {screen==="reset_password"    && <ResetPasswordScreen onDone={()=>setScreen("role")} />}
      {screen==="settings"          && <SettingsScreen role={role} onNavigate={navigate} onBack={()=>setScreen(role==="prestataire"?"p_home":"home")} onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} />}
      {screen==="contact_support"   && <ContactSupportScreen onBack={()=>setScreen("settings")} />}
      {screen==="splash"            && <SplashScreen onNext={handleSplashNext} onBackoffice={()=>setScreen("bo_login")} />}
      {screen==="role"              && <RoleScreen onSelect={r=>{ setRole(r); setScreen(r==="prestataire"?"auth_presta":"auth_client"); }} />}

      {/* Auth — connexion ou inscription pour les deux rôles */}
      {screen==="auth_client"       && <AuthScreen role="client"
          onLogin={()=>setScreen("home")}
          onRegister={()=>setScreen("how_client")}
          onBack={()=>setScreen("role")} />}
      {screen==="auth_presta"       && <AuthScreen role="prestataire"
          onLogin={()=>setScreen("p_home")}
          onRegister={()=>setScreen("how_presta")}
          onBack={()=>setScreen("role")} />}

      {/* Comment ca marche — uniquement pour les nouveaux inscrits */}
      {screen==="how_client"        && <HowItWorksScreen role="client" onNext={()=>setScreen("client_onboarding")} onBack={()=>setScreen("auth_client")} />}
      {screen==="how_presta"        && <HowItWorksScreen role="prestataire" onNext={()=>setScreen("presta_onboarding")} onBack={()=>setScreen("auth_presta")} />}

      {/* Onboarding complet — uniquement pour les nouveaux */}
      {screen==="client_onboarding" && <ClientOnboarding onComplete={()=>setScreen("home")} onBack={()=>setScreen("how_client")} />}
      {screen==="client_auth"       && <AuthScreen role="client" onLogin={()=>setScreen("home")} onRegister={()=>setScreen("how_client")} onBack={()=>setScreen("role")} />}
      {screen==="home"              && <HomeScreen onNavigate={navigate} />}
      {screen==="catalogue"         && <CatalogueScreen onNavigate={navigate} />}
      {screen==="sector_detail"     && <SectorDetailScreen sector={selectedSector} onNavigate={navigate} />}
      {screen==="mission_request"   && <MissionRequestScreen sector={selectedSector} onBack={()=>setScreen("sector_detail")} onSubmit={mission=>{ setPendingMission(mission); setScreen("mission_broadcast"); }} />}
      {screen==="mission_broadcast" && <MissionBroadcastScreen mission={pendingMission} onCancel={()=>setScreen("mission_request")} onChoose={p=>{ setSelectedProvider(p); setBookingSource("mission_broadcast"); setScreen("booking"); }} />}
      {screen==="search_filters"    && <SearchFiltersScreen onNavigate={navigate} />}
      {screen==="profile"           && <ProfileScreen provider={selectedProvider} onNavigate={navigate} onBack={()=>setScreen(selectedSector?"sector_detail":"search_filters")} />}
      {screen==="cv"                && <CVScreen provider={selectedProvider} onBack={()=>setScreen("profile")} onNavigate={navigate} />}
      {screen==="booking"           && <BookingScreen provider={selectedProvider} onNavigate={(to,data)=>{ if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setScreen("stripe_pay"); } else navigate(to,data); }} onBack={()=>{ setBookingSource("profile"); setScreen(bookingSource); }} />}
      {screen==="stripe_pay"        && <StripePaymentScreen amount={paymentAmount} provider={selectedProvider} onSuccess={()=>{ setPendingProvider(selectedProvider); setScreen("mission_pending"); }} onBack={()=>setScreen("booking")} />}
      {screen==="mission_pending"   && <MissionPendingScreen
        provider={pendingProvider||selectedProvider}
        amount={paymentAmount}
        hours={paymentHours}
        onAccepted={()=>setScreen("contract")}
        onCancelled={()=>{ setScreen("sector_detail"); }}
        onBack={()=>setScreen("home")}
      />}
      {screen==="contract"          && <ContractScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} onSign={()=>setTimeout(()=>setScreen("tracking"),1000)} onBack={()=>setScreen("stripe_pay")} />}
      {screen==="tracking"          && <TrackingScreen provider={selectedProvider} onNavigate={navigate} />}
      {screen==="validation"        && <ValidationScreen provider={selectedProvider} role={role} onNavigate={navigate} />}
      {screen==="invoice"           && <InvoiceScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} onBack={()=>setScreen("dashboard")} />}
      {screen==="cancellation"      && <CancellationScreen provider={selectedProvider} onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="team_booking"      && <TeamBookingScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="mission_history"   && <MissionHistoryScreen onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="chat"              && <ChatScreen provider={selectedProvider} onBack={()=>setScreen(role==="prestataire"?"p_missions":"search_filters")} />}
      {screen==="notifications"     && <NotificationsScreen onBack={()=>setScreen("home")} onNavigate={navigate} />}
      {screen==="favorites"         && <FavoritesScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="referral"          && <ReferralScreen onBack={()=>setScreen("home")} />}
      {screen==="abonnement_presta" && <AbonnementPrestaScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="cashback"          && <CashbackWalletScreen onBack={()=>setScreen("dashboard")} onNavigate={navigate} />}
      {screen==="rating"            && <RatingScreen provider={selectedProvider} onSubmit={()=>setScreen("home")} onBack={()=>setScreen("validation")} />}
      {screen==="doc_upload"        && <DocUploadScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="calendar"          && <CalendarScreen />}
      {screen==="legal"             && <LegalScreen type={legalType} onBack={()=>setScreen(role?"dashboard":"splash")} />}
      {screen==="payslip"           && <PayslipScreen provider={payslipData?.provider||selectedProvider} mission={payslipData} onBack={()=>setScreen(role==="prestataire"?"p_dashboard":"dashboard")} />}
      {screen==="bo_login"          && <BackofficeLogin onLogin={()=>{ setBoUnlocked(true); setScreen("bo_dashboard"); }} onBack={()=>setScreen("splash")} />}
      {screen==="bo_dashboard"      && boUnlocked && <BackofficeDashboard onBack={()=>setScreen("splash")} onModelChange={m=>{ MODEL_CONFIG.currentModel=m; setModel(m); }} />}

      {screen==="dashboard" && (
        <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:90 }}>

          {/* Header premium */}
          <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:-60, right:-60, width:200, height:200, borderRadius:"50%", background:`radial-gradient(circle, ${C.violet}15 0%, transparent 65%)`, pointerEvents:"none" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 4px" }}>Mon espace</p>
                <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>Mon compte</h2>
              </div>
              <div style={{ width:46, height:46, borderRadius:r, background:`${C.violet}20`, border:`1px solid ${C.violet}35`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>👤</div>
            </div>

            {/* Cashback banner dans le header */}
            <div onClick={()=>navigate("cashback")} style={{ background:`${C.violet}18`, border:`1px solid ${C.violet}35`, borderRadius:r, padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>💰</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:1 }}>
                  <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Cashback disponible</span>
                  <Badge color={getCashbackTier(INITIAL_WALLET.missionsThisMonth).color} small>
                    {getCashbackTier(INITIAL_WALLET.missionsThisMonth).icon} {getCashbackTier(INITIAL_WALLET.missionsThisMonth).label}
                  </Badge>
                </div>
                <div style={{ color:C.textSub, fontSize:12 }}>
                  <strong style={{ color:C.success }}>{INITIAL_WALLET.balance.toFixed(2)} €</strong> · {(getCashbackTier(INITIAL_WALLET.missionsThisMonth).rate*100).toFixed(0)}% sur chaque mission
                </div>
              </div>
              <span style={{ color:C.violet, fontSize:18 }}>›</span>
            </div>
          </div>

          <div style={{ padding:"20px 18px" }}>

            {/* Actions rapides */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
              {[
                { icon:"📋", label:"Mes missions",   color:C.violet,     action:"mission_history" },
                { icon:"❤️", label:"Mes favoris",    color:"#F25E5E",    action:"favorites"       },
                { icon:"👥", label:"Équipe",         color:C.accentGold, action:"team_booking"    },
                { icon:"🔔", label:"Notifications",  color:C.success,    action:"notifications"   },
              ].map((item,i) => (
                <div key={i} onClick={()=>navigate(item.action)} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:11, transition:"all 0.2s" }}
                  className="card-hover">
                  <div style={{ width:38, height:38, borderRadius:11, background:`${item.color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{item.icon}</div>
                  <span style={{ fontWeight:600, color:C.text, fontSize:13 }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Menu secondaire */}
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12, letterSpacing:0.3 }}>Gestion</div>
            {[
              { icon:"📄", label:"Mes factures",      sub:"Télécharger mes justificatifs",    action:"invoice"       },
              { icon:"🎁", label:"Parrainage",         sub:"50€ pour vous et votre filleul",  action:"referral"      },
              { icon:"📋", label:"CGU",                sub:"Conditions générales",             action:"legal_cgu"     },
              { icon:"🔒", label:"Confidentialité",    sub:"Politique de données",             action:"legal_privacy" },
              { icon:"⚙️", label:"Paramètres",         sub:"Compte, sécurité, paiement",      action:"settings"      },
            ].map((item,i) => (
              <div key={i} onClick={()=>{
                if(item.action==="legal_cgu") navigate("legal","cgu");
                else if(item.action==="legal_privacy") navigate("legal","privacy");
                else if(item.action==="settings") navigate("settings");
                else if(item.action) navigate(item.action);
              }} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:8, display:"flex", alignItems:"center", gap:12, cursor:"pointer", transition:"all 0.2s" }}
                className="card-hover">
                <div style={{ width:38, height:38, borderRadius:11, background:"rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{item.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>{item.label}</div>
                  <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{item.sub}</div>
                </div>
                <span style={{ color:C.textMuted, fontSize:18, fontWeight:300 }}>›</span>
              </div>
            ))}

            {/* Version / Sign out */}
            <div style={{ marginTop:20, textAlign:"center" }}>
              <div style={{ color:C.textMuted, fontSize:11, marginBottom:8 }}>JOBER v1.0 — Île-de-France</div>
              <button onClick={()=>{ if(window.confirm("Se déconnecter ?")) { window.location.reload(); }}} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:r, padding:"10px 28px", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {screen==="presta_onboarding" && <PrestaOnboarding onComplete={()=>setScreen("presta_pending")} onBack={()=>setScreen("how_presta")} />}
      {screen==="presta_pending" && (
        <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20, #0A1628, #162547)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, ${C.accentGold}12 0%, transparent 65%)`, pointerEvents:"none" }} />
          <div style={{ fontSize:72, marginBottom:20 }}>📬</div>
          <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:"0 0 12px", fontFamily:font.display }}>Dossier envoyé !</h2>
          <p style={{ color:C.textSub, fontSize:15, lineHeight:1.8, maxWidth:300, margin:"0 auto 12px" }}>Notre équipe examine votre dossier sous <strong style={{ color:C.accentGold }}>24 à 48h ouvrées</strong>.</p>
          <p style={{ color:C.textMuted, fontSize:13, lineHeight:1.6, maxWidth:280, margin:"0 auto 32px" }}>Vous recevrez une notification dès que votre compte est activé.</p>
          <Btn full onClick={()=>setScreen("p_home")} style={{ fontSize:16, maxWidth:280 }}>Accéder à mon espace →</Btn>
        </div>
      )}

      {(screen==="p_home"||screen==="p_missions"||screen==="p_dashboard") && (
        <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
          <PrestaDashboard onNavigate={(to,data)=>{
            if(to==="payslip") navigate("payslip",data);
            else if(to==="legal") navigate("legal",data);
            else navigate(to,data);
          }} />
          {screen==="p_dashboard" && (
            <div style={{ padding:"0 18px 18px" }}>
              <OnlineStatusWidget online={onlineStatus} onToggle={()=>setOnlineStatus(s=>!s)} />
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={()=>navigate("legal","cgu")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📋 CGU</button>
                <button onClick={()=>navigate("legal","privacy")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>🔒 Confidentialité</button>
                <button onClick={()=>navigate("payslip",{provider:PROVIDERS[0],role:"Cariste CACES 1",client:"Entrepôt XYZ",date:"12/05/2025",hours:8,tarifNet:14})} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📄 Fiche paie</button>
              </div>
            </div>
          )}
        </div>
      )}
    </ResponsiveLayout>
  );
}