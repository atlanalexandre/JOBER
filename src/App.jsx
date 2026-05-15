import { useState, useEffect, useRef, Component } from "react";
import { supabase } from "./lib/supabase.js";

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(e) { return { hasError:true, error:e }; }
  componentDidCatch(e, info) { console.error("ErrorBoundary:", e, info); }
  render() {
    if(!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight:"100vh", background:"#050E20", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
        <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 10px" }}>Une erreur inattendue est survenue</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, marginBottom:24 }}>Rechargez la page pour continuer.</p>
        <button onClick={()=>window.location.reload()} style={{ background:"#7C6FE0", border:"none", borderRadius:12, padding:"12px 28px", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer" }}>
          Recharger
        </button>
      </div>
    );
  }
}

// ── Logo ALANE — Variation A : cercles pleins avec halo lumineux ─────
function ALANELogo({ size = "md" }) {
  const cfg = {
    sm: { svgW:36, svgH:24, vW:160, fs:17, gap:7  },
    md: { svgW:44, svgH:30, vW:160, fs:18, gap:9  },
    lg: { svgW:60, svgH:40, vW:160, fs:28, gap:12 },
  }[size] || { svgW:44, svgH:30, vW:160, fs:18, gap:9 };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:cfg.gap }}>
      <svg width={cfg.svgW} height={cfg.svgH} viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="al-line" x1="52" y1="55" x2="108" y2="55" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7C6FE0"/>
            <stop offset="100%" stopColor="#F0B429"/>
          </linearGradient>
          <filter id="al-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Left node — violet */}
        <circle cx="40" cy="55" r="28" fill="#7C6FE0" opacity="0.15"/>
        <circle cx="40" cy="55" r="18" fill="#7C6FE0" filter="url(#al-glow)"/>
        <circle cx="40" cy="55" r="7" fill="#fff"/>
        {/* Connector */}
        <line x1="58" y1="55" x2="102" y2="55" stroke="url(#al-line)" strokeWidth="3" strokeLinecap="round"/>
        {/* Right node — gold */}
        <circle cx="120" cy="55" r="28" fill="#F0B429" opacity="0.15"/>
        <circle cx="120" cy="55" r="18" fill="#F0B429" filter="url(#al-glow)"/>
        <circle cx="120" cy="55" r="7" fill="#fff"/>
      </svg>
      <span style={{ color:"#FFFFFF", fontSize:cfg.fs, fontWeight:700, letterSpacing:-0.3, fontFamily:"inherit" }}>ALANE</span>
    </div>
  );
}

// ── Géolocalisation — Haversine ───────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
}

function travelTimeStr(km) {
  const mins = Math.round((km / 30) * 60 / 5) * 5;
  return mins < 60 ? `~${mins} min` : `~${Math.round(mins / 60)}h`;
}

// Table de correspondance CP → [lat, lng] pour les 20 premiers départements
const CP_COORDS = {
  "75":[ 48.8566,  2.3522], "92":[ 48.8924,  2.2540], "93":[ 48.9156,  2.4825],
  "94":[ 48.7847,  2.4697], "91":[ 48.6325,  2.4427], "95":[ 49.0379,  2.0769],
  "77":[ 48.8400,  2.9713], "78":[ 48.8017,  1.9670], "69":[ 45.7640,  4.8357],
  "13":[ 43.2965,  5.3698], "33":[ 44.8378, -0.5792], "31":[ 43.6047,  1.4442],
  "59":[ 50.6292,  3.0573], "67":[ 48.5734,  7.7521], "44":[ 47.2184, -1.5536],
  "06":[ 43.7102,  7.2620], "34":[ 43.6119,  3.8772], "76":[ 49.4432,  1.0993],
  "38":[ 45.1885,  5.7245], "35":[ 48.1173, -1.6778],
};

function cpToCoords(cp) {
  const dept = (cp||"").slice(0,2);
  return CP_COORDS[dept] || null;
}

// Génère un code à 4 chiffres déterministe basé sur l'ID du prestataire + date du jour
// Les deux parties (client et presta) calculent le même code sans communication
function genMissionCode(provId, type) {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const base = (provId * 7919 + parseInt(today.slice(-4)) * 31) % 9000;
  const offset = type === "out" ? 4567 : 0;
  return String(((Math.abs(base) + offset) % 9000) + 1000).slice(-4);
}

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
  display: "’Plus Jakarta Sans’, ‘Inter’, system-ui, sans-serif",
  body:    "’Inter’, system-ui, sans-serif",
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

// ── Modèle hybride — abonnements prestataires, 0% commission ─────
const IS_LAUNCH = true; // Période de lancement — offre 10 missions gratuites pour les 100 premiers
const isLaunchPhase = () => IS_LAUNCH; // conservé pour compatibilité, sera nettoyé après

const MARGES = { proprete:0.20, logistique:0.18, hotellerie:0.20, btp:0.15, restauration:0.25, commercial:0.22, distribution:0.18, divers:0.20 };
const FRAIS_MER = { single:4.90, range:2.90, urgent:9.90 };
const ABONNEMENTS_PRESTA = [
  { id:"free",    label:"Gratuit", price:0,  color:"#8B8FA8", icon:"🆓", missions:10,  popular:false, features:["10 missions/mois *","Profil visible"],       locked:["Missions illimitées","Badge Vérifié","Missions urgentes"], note:"* 10 missions/mois réservé aux 100 premiers inscrits. 2 missions/mois ensuite." },
  { id:"premium", label:"Premium", price:29, color:"#7C6FE0", icon:"⚡", missions:999, popular:true,  features:["Missions illimitées","Badge Vérifié","Urgences"], locked:["Manager dédié"] },
  { id:"elite",   label:"Elite",   price:59, color:"#F0B429", icon:"👑", missions:999, popular:false, features:["Missions illimitées","Badge Elite","Position #1 *","Manager dédié"], locked:[], note:"* Position #1 attribuée selon la notation et les commentaires positifs du prestataire." },
];
const prixClient = (tarifNet, _sector) => tarifNet;
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
  // ── Extras ──────────────────────────────────────────────────────
  13: { // Inès Moreau
    titre:"Serveuse — Service en salle & Brasseries",
    accroche:"Serveuse dynamique avec 3 ans d'expérience en brasseries parisiennes. Sens du service irréprochable, sourire naturel et aisance avec une clientèle variée.",
    experiences:[
      { poste:"Serveuse", entreprise:"Brasserie Bouillon Chartier", periode:"2023 – 2025", desc:"Service en salle · 80+ couverts/service · Encaissement · Accueil clients" },
      { poste:"Serveuse", entreprise:"Café de Flore", periode:"2022 – 2023", desc:"Service rapide brasserie · Gestion des tables · Formation nouveaux serveurs" },
    ],
    formations:[
      { diplome:"CAP Service en Salle", etablissement:"CFA Hôtelier Paris", annee:"2022" },
      { diplome:"Hygiène alimentaire (HACCP)", etablissement:"Chambre de Commerce Paris", annee:"2022" },
    ],
    langues:["Français (natif)","Anglais (B1)"],
    permis:"Permis B",
    hasCV: true,
  },
  15: { // Camille Dupont
    titre:"Serveuse Gastronomique — Service VIP & Anglophone",
    accroche:"5 ans en restauration haut de gamme, bilingue français-anglais. Expérience service VIP et sommellerie de base. Reconnue pour son professionnalisme et sa discrétion.",
    experiences:[
      { poste:"Serveuse VIP", entreprise:"Hôtel Le Meurice", periode:"2022 – 2025", desc:"Service en salle gastronomique · Clientèle internationale · Sommellerie de base · Upselling" },
      { poste:"Chef de rang", entreprise:"Restaurant Guy Savoy", periode:"2020 – 2022", desc:"Service étoilé Michelin · Coordination salle · Gestion des alliances mets-vins" },
      { poste:"Serveuse", entreprise:"Brasserie Terminus Nord", periode:"2019 – 2020", desc:"Service brasserie volume · 100+ couverts · Travail en équipe" },
    ],
    formations:[
      { diplome:"BTS Hôtellerie-Restauration", etablissement:"Lycée Hôtelier Jean Drouant", annee:"2019" },
      { diplome:"Formation Sommellerie Niveau 1", etablissement:"CIVB Bordeaux", annee:"2021" },
    ],
    langues:["Français (natif)","Anglais (courant C1)"],
    permis:"Permis B",
    hasCV: true,
  },
  34: { // Mathilde Perrin
    titre:"Réceptionniste Trilingue — Hôtellerie 4 & 5 étoiles",
    accroche:"7 ans en hôtellerie haut de gamme. Trilingue français-anglais-espagnol, maîtrise Opera PMS et Fidelio. Passionnée par l'accueil et le service personnalisé.",
    experiences:[
      { poste:"Réceptionniste Senior", entreprise:"Four Seasons Hotel George V Paris", periode:"2022 – 2025", desc:"Check-in/out VIP · Conciergerie · Gestion réclamations · Supervision stagiaires" },
      { poste:"Réceptionniste", entreprise:"Hôtel de Crillon", periode:"2019 – 2022", desc:"Accueil clientèle internationale · Facturation · Opera PMS · Standard" },
      { poste:"Agent de réservation", entreprise:"Marriott Paris", periode:"2018 – 2019", desc:"Gestion réservations · Yield management · Upselling suites" },
    ],
    formations:[
      { diplome:"BTS Tourisme option Hôtellerie", etablissement:"Institut Paul Bocuse Lyon", annee:"2018" },
      { diplome:"Certification Opera PMS avancé", etablissement:"Oracle Hospitality", annee:"2020" },
    ],
    langues:["Français (natif)","Anglais (C1)","Espagnol (B2)"],
    permis:"Permis B",
    hasCV: true,
  },
  47: { // Houda Saidi
    titre:"Agente de Propreté — Bureaux & Surfaces Commerciales",
    accroche:"3 ans d'expérience en entretien de bureaux et surfaces commerciales. Consciencieuse et discrète, maîtrise des techniques de nettoyage et des produits professionnels.",
    experiences:[
      { poste:"Agente de propreté", entreprise:"ISS Facility Services", periode:"2023 – 2025", desc:"Nettoyage bureaux · Désinfection surfaces · Gestion produits chimiques · Traçabilité" },
      { poste:"Agente de surface", entreprise:"Onet Propreté", periode:"2022 – 2023", desc:"Entretien centres commerciaux · Nettoyage vitres · Tri sélectif" },
    ],
    formations:[
      { diplome:"CAP Maintenance et Hygiène des Locaux", etablissement:"AFPA Île-de-France", annee:"2022" },
      { diplome:"Formation produits chimiques (INRS)", etablissement:"INRS Paris", annee:"2023" },
    ],
    langues:["Français (courant)","Arabe (natif)"],
    permis:"Permis B",
    hasCV: true,
  },
  61: { // Sophie Renard
    titre:"Commercial(e) B2B Senior — Grands Comptes & Closing",
    accroche:"Top performer commerciale avec 8 ans d'expérience B2B. Spécialiste grands comptes et cycles de vente complexes. Track record : +2M€ CA généré sur les 3 dernières années.",
    experiences:[
      { poste:"Account Executive Senior", entreprise:"HubSpot France", periode:"2022 – 2025", desc:"Portefeuille 80 comptes ETI · CA généré 750k€/an · Taux de rétention 91% · Mentoring juniors" },
      { poste:"Business Developer", entreprise:"Dassault Systèmes", periode:"2019 – 2022", desc:"Prospection secteur industrie · Closing cycles 6-18 mois · Négociation contrats 200k€+" },
      { poste:"Commerciale terrain", entreprise:"Oracle", periode:"2017 – 2019", desc:"Prospection terrain IDF · 45 RDV/mois · Taux transformation 38%" },
    ],
    formations:[
      { diplome:"Master Commerce & Négociation", etablissement:"ESSEC Business School", annee:"2017" },
      { diplome:"Certification Salesforce Sales Cloud", etablissement:"Salesforce", annee:"2019" },
    ],
    langues:["Français (natif)","Anglais (C2)","Allemand (B1)"],
    permis:"Permis B — véhiculée",
    hasCV: true,
  },
  71: { // Stéphanie Collin
    titre:"Hôtesse de Caisse — Grande Distribution",
    accroche:"4 ans en grande distribution, spécialiste encaissement et relation client. Rapide, fiable et habituée aux environnements à fort flux. Connaissance SAV et fidélité.",
    experiences:[
      { poste:"Hôtesse de caisse principale", entreprise:"Carrefour Market Paris 15e", periode:"2022 – 2025", desc:"Encaissement flux élevé · Formation nouveaux caissiers · Gestion coffre · SAV caisse" },
      { poste:"Caissière", entreprise:"Monoprix République", periode:"2021 – 2022", desc:"Encaissement · Accueil · Programme fidélité · Échanges et remboursements" },
    ],
    formations:[
      { diplome:"CAP Employé de Commerce", etablissement:"CFA Paris Commerce", annee:"2021" },
      { diplome:"Formation Geste & Posture Caisse", etablissement:"CARREFOUR Academy", annee:"2022" },
    ],
    langues:["Français (natif)"],
    permis:"Permis B",
    hasCV: true,
  },
  81: { // Stéphane Veron
    titre:"Agent de Sécurité — CQP APS · Sûreté Aéroportuaire",
    accroche:"8 ans d'expérience en sécurité privée, habilitation sûreté aéroportuaire. Calme, réactif et professionnel. Spécialiste surveillance vidéo et gestion de crise.",
    experiences:[
      { poste:"Agent de sécurité APS", entreprise:"Prosegur France", periode:"2021 – 2025", desc:"Rondes sécurité · Surveillance vidéo · Gestion accès · Rédaction mains courantes" },
      { poste:"Agent de sûreté aéroportuaire", entreprise:"Securitas Airport Services", periode:"2018 – 2021", desc:"Contrôle sûreté passagers · Détection d'objets interdits · Protocoles DGAC" },
      { poste:"Vigile", entreprise:"G4S France", periode:"2017 – 2018", desc:"Gardiennage entrepôt · Rondes nocturnes · Accueil visiteurs" },
    ],
    formations:[
      { diplome:"CQP APS (Agent de Prévention et Sécurité)", etablissement:"CNPP Vernon", annee:"2017" },
      { diplome:"SST (Secouriste du Travail)", etablissement:"INRS", annee:"2019" },
      { diplome:"Habilitation Sûreté Aéroportuaire (DGAC)", etablissement:"Aéroports de Paris", annee:"2018" },
    ],
    langues:["Français (natif)","Anglais (B1)"],
    permis:"Permis B — véhiculé",
    hasCV: true,
  },
  91: { // Didier Fontaine
    titre:"Électricien Qualifié — Habilitations BR-B1V · Norme NF C 15-100",
    accroche:"12 ans en électricité du bâtiment, travaux neufs et rénovation. Habilitations BR et B1V à jour. Rigoureux, autonome, respectueux des normes de sécurité.",
    experiences:[
      { poste:"Électricien chef d'équipe", entreprise:"Spie Batignolles IDF", periode:"2020 – 2025", desc:"Travaux neufs résidentiel & tertiaire · Mise en conformité tableaux · Encadrement 3 personnes" },
      { poste:"Électricien", entreprise:"Bouygues Energies & Services", periode:"2016 – 2020", desc:"Câblage courants forts/faibles · Raccordement TGBT · Tests et mesures" },
      { poste:"Électricien junior", entreprise:"SNEF Paris", periode:"2013 – 2016", desc:"Tirage de câbles · Pose chemins de câbles · Aide mise en service" },
    ],
    formations:[
      { diplome:"Bac Pro Électrotechnique", etablissement:"Lycée Diderot Paris", annee:"2013" },
      { diplome:"Habilitations B1V-BR-BC", etablissement:"APAVE Paris", annee:"2021" },
      { diplome:"CACES Nacelle 3B", etablissement:"AFTRAL", annee:"2019" },
    ],
    langues:["Français (natif)"],
    permis:"Permis B — véhiculé",
    hasCV: true,
  },
  90: { // Rachid Benali
    titre:"Maçon Confirmé — Travaux Neufs & Rénovation",
    accroche:"10 ans en maçonnerie, aussi bien sur chantiers neufs qu'en rénovation. Maîtrise coffrage, béton armé et enduits. Autonome et capable de conduire une équipe.",
    experiences:[
      { poste:"Maçon chef d'équipe", entreprise:"Eiffage Construction IDF", periode:"2021 – 2025", desc:"Maçonnerie gros œuvre · Coffrage banche · Coulage béton · Coordination équipe 4 personnes" },
      { poste:"Maçon", entreprise:"Vinci Construction France", periode:"2018 – 2021", desc:"Élévation murs · Dalles béton · Réservations techniques · Lecture plans" },
      { poste:"Aide maçon", entreprise:"Chantiers Loiseau", periode:"2015 – 2018", desc:"Préparation mortier · Manutention · Nettoyage chantier · Assistance maçons" },
    ],
    formations:[
      { diplome:"CAP Maçon", etablissement:"CFA BTP Île-de-France", annee:"2015" },
      { diplome:"Bac Pro Technicien du Bâtiment", etablissement:"Lycée Gustave Eiffel Cachan", annee:"2017" },
      { diplome:"AIPR (Autorisation Intervention Proximité Réseaux)", etablissement:"OPPBTP", annee:"2022" },
    ],
    langues:["Français (courant)","Arabe (natif)"],
    permis:"Permis B — véhiculé",
    hasCV: true,
  },
  99: { // Laura Schmitt
    titre:"Cuisinière Confirmée — Brigade étoilée & Cuisine française",
    accroche:"9 ans en cuisine professionnelle, de la brasserie au restaurant étoilé. Créative, rigoureuse HACCP et à l'aise sur tous les postes de brigade. Disponible en renfort ou remplacement.",
    experiences:[
      { poste:"Cuisinière (Chef de partie froid)", entreprise:"Restaurant Taillevent **", periode:"2022 – 2025", desc:"Garde-manger · Entrées froides · Pâtisserie salée · Respect HACCP strict" },
      { poste:"Commis puis demi-chef", entreprise:"Hôtel Lutetia — Restaurant Paris", periode:"2019 – 2022", desc:"Poste chaud et froid · Préparations en amont · Aide chef de partie" },
      { poste:"Cuisinière", entreprise:"Brasserie Flo Paris", periode:"2016 – 2019", desc:"Production volume · Cuissons vapeur/four · Fiches techniques" },
    ],
    formations:[
      { diplome:"CAP Cuisine", etablissement:"École Ferrandi Paris", annee:"2016" },
      { diplome:"Mention Complémentaire Cuisine Gastronomique", etablissement:"École Ferrandi Paris", annee:"2017" },
      { diplome:"Formation Hygiène HACCP", etablissement:"UMIH Formation", annee:"2018" },
    ],
    langues:["Français (natif)","Anglais (B1)"],
    permis:"Permis B",
    hasCV: true,
  },
  103: { // Nicolas Faure
    titre:"Concierge 5 Étoiles — Multilingue & Conciergerie Haut de Gamme",
    accroche:"11 ans en conciergerie de luxe, trilingue français-anglais-arabe. Réseau solide de prestataires premium. Reconnu pour sa discrétion, sa réactivité et son sens du service.",
    experiences:[
      { poste:"Chef Concierge", entreprise:"Hôtel Ritz Paris", periode:"2020 – 2025", desc:"Conciergerie VIP · Réseau prestataires · Organisation événements privés · Management équipe 5 personnes" },
      { poste:"Concierge", entreprise:"Hôtel Plaza Athénée", periode:"2016 – 2020", desc:"Réservations gastronomiques · Transferts privés · Visites privées musées · Clientèle UHNWI" },
      { poste:"Groom / Agent d'accueil", entreprise:"Hôtel Le Bristol Paris", periode:"2014 – 2016", desc:"Accueil clientèle · Bagagerie · Service voiturier · Orientation" },
    ],
    formations:[
      { diplome:"Bac Pro Hôtellerie", etablissement:"Lycée Hôtelier de Nice", annee:"2014" },
      { diplome:"Clefs d'Or — Membre Association des Concierges de Palace", etablissement:"Les Clefs d'Or France", annee:"2019" },
    ],
    langues:["Français (natif)","Anglais (C2)","Arabe (B2)"],
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
  _mkP({ id:82, name:"Fatoumata Balde",  jobTitle:"Agent de sécurité",        tarifNet:13.5, avatar:"👮‍♀️",color:"#7986CB", rating:4.5, reviews:24, skills:["CQP APS","Contrôle accès","Prévention"],       experience:"4 ans",  available:true,  sector:"divers",       bio:"Agente de sécurité qualifiée, spécialiste contrôle accès.",   distance:"0,6 km", responseTime:"~2 min",  missions:24, role:"Agent de sécurité" }),
  // BTP
  _mkP({ id:90, name:"Rachid Benali",     jobTitle:"Maçon",                   tarifNet:17.0, avatar:"🧱",  color:"#FF8A65", rating:4.7, reviews:38, skills:["Maçonnerie","Béton","Coffrage","Enduit"],          experience:"10 ans", available:true,  sector:"btp",          bio:"Maçon confirmé, travaux neufs et rénovation.",                distance:"1,8 km", responseTime:"~7 min",  missions:38, role:"Maçon" }),
  _mkP({ id:91, name:"Didier Fontaine",   jobTitle:"Électricien",             tarifNet:20.0, avatar:"⚡",  color:"#FF8A65", rating:4.8, reviews:51, skills:["Câblage","Tableau élec.","Norme NF C 15-100"],      experience:"12 ans", available:true,  sector:"btp",          bio:"Électricien qualifié, habilitations BR-B1V à jour.",          distance:"2,4 km", responseTime:"~9 min",  missions:51, role:"Électricien" }),
  _mkP({ id:92, name:"Karim Hajjar",      jobTitle:"Plombier",                tarifNet:19.0, avatar:"🔧",  color:"#FF8A65", rating:4.6, reviews:33, skills:["Plomberie","Soudure","Sanitaire","Chauffage"],      experience:"8 ans",  available:true,  sector:"btp",          bio:"Plombier chauffagiste, installations neuves et dépannage.",   distance:"3,1 km", responseTime:"~13 min", missions:33, role:"Plombier" }),
  _mkP({ id:93, name:"Julien Merlin",     jobTitle:"Peintre en bâtiment",     tarifNet:15.0, avatar:"🎨",  color:"#FF8A65", rating:4.5, reviews:27, skills:["Peinture intérieure","Enduit","Ravalement"],        experience:"6 ans",  available:true,  sector:"btp",          bio:"Peintre soigneux, intérieur et extérieur, délais respectés.", distance:"0,9 km", responseTime:"~4 min",  missions:27, role:"Peintre en bâtiment" }),
  _mkP({ id:94, name:"Ibrahima Diallo",   jobTitle:"Manœuvre BTP",            tarifNet:13.0, avatar:"🏗️", color:"#FF8A65", rating:4.3, reviews:14, skills:["Aide maçonnerie","Port de charges","Nettoyage chantier"],experience:"2 ans",available:true, sector:"btp",           bio:"Manœuvre polyvalent, ponctuel et disponible rapidement.",      distance:"1,5 km", responseTime:"~6 min",  missions:14, role:"Manœuvre BTP" }),
  _mkP({ id:95, name:"Patrice Giroux",    jobTitle:"Carreleur",               tarifNet:18.0, avatar:"🪟",  color:"#FF8A65", rating:4.7, reviews:42, skills:["Carrelage","Faïence","Chape","Ragréage"],           experience:"9 ans",  available:false, sector:"btp",           bio:"Carreleur-faïencier expert, finitions soignées.",             distance:"4,2 km", responseTime:"~20 min", missions:42, role:"Carreleur" }),
  // Logistique (extras)
  _mkP({ id:96, name:"Élodie Vasseur",    jobTitle:"Préparateur(trice) commandes", tarifNet:12.5, avatar:"📦", color:"#4FC3F7", rating:4.5, reviews:22, skills:["Prépa commandes","Scan","WMS","CACES 1"],    experience:"3 ans",  available:true,  sector:"logistique",   bio:"Rapide et rigoureuse, habituée aux grands entrepôts.",        distance:"1,0 km", responseTime:"~4 min",  missions:22, role:"Préparateur(trice) commandes" }),
  _mkP({ id:97, name:"Yannick Aubert",    jobTitle:"Chauffeur VL",            tarifNet:14.5, avatar:"🚐",  color:"#4FC3F7", rating:4.6, reviews:35, skills:["Permis B","Livraison VL","Scan colis","Plan de tournée"],experience:"5 ans",available:true,sector:"logistique",  bio:"Chauffeur livreur fiable, connaissance IDF.",                 distance:"2,6 km", responseTime:"~10 min", missions:35, role:"Chauffeur VL" }),
  _mkP({ id:98, name:"Abdelkader Saadi",  jobTitle:"Cariste CACES 3",         tarifNet:15.0, avatar:"🏋️", color:"#4FC3F7", rating:4.7, reviews:40, skills:["CACES 3","CACES 5","Palettisation","Stock"],        experience:"7 ans",  available:true,  sector:"logistique",   bio:"Cariste CACES 3 et 5, expert gestion de stock.",              distance:"0,8 km", responseTime:"~3 min",  missions:40, role:"Cariste CACES 3" }),
  // Restauration (extras)
  _mkP({ id:99, name:"Laura Schmitt",     jobTitle:"Cuisinier(ère)",          tarifNet:14.0, avatar:"👨‍🍳", color:"#F06292", rating:4.8, reviews:61, skills:["Cuisine française","Pastry","HACCP","Cold kitchen"],experience:"9 ans",  available:true,  sector:"restauration", bio:"Cuisinière confirmée, brigade étoilée et brasseries.",        distance:"1,3 km", responseTime:"~5 min",  missions:61, role:"Cuisinier(ère)" }),
  _mkP({ id:100, name:"Ali Toure",        jobTitle:"Plongeur / Commis",       tarifNet:11.5, avatar:"🍳",  color:"#F06292", rating:4.4, reviews:16, skills:["Plonge","Aide cuisine","Découpe","Nettoyage"],       experience:"2 ans",  available:true,  sector:"restauration", bio:"Dynamique et rigoureux, disponible soirs et week-ends.",      distance:"0,4 km", responseTime:"~2 min",  missions:16, role:"Plongeur / Commis" }),
  _mkP({ id:101, name:"Chloé Nguyen",     jobTitle:"Barman / Barmaid",        tarifNet:13.0, avatar:"🍸",  color:"#F06292", rating:4.6, reviews:39, skills:["Cocktails","Gestion stock bar","Caisse","Accueil"],  experience:"5 ans",  available:true,  sector:"restauration", bio:"Barmaid créative, expérience cocktail bars et restaurants.",  distance:"1,9 km", responseTime:"~7 min",  missions:39, role:"Barman / Barmaid" }),
  // Hôtellerie (extras)
  _mkP({ id:102, name:"Amira Slimani",    jobTitle:"Femme / Valet de chambre", tarifNet:12.0, avatar:"🛏️", color:"#FFB74D", rating:4.5, reviews:28, skills:["Nettoyage chambres","Hygiène hôtelière","Check-out"],experience:"4 ans", available:true,  sector:"hotellerie",   bio:"Gouvernante expérimentée, hôtels 3 et 4 étoiles.",            distance:"1,6 km", responseTime:"~6 min",  missions:28, role:"Femme / Valet de chambre" }),
  _mkP({ id:103, name:"Nicolas Faure",    jobTitle:"Concierge",               tarifNet:15.0, avatar:"🗺️", color:"#FFB74D", rating:4.9, reviews:74, skills:["Conciergerie","Multilingue","Réservations","Accueil VIP"],experience:"11 ans",available:true,sector:"hotellerie",  bio:"Concierge 5 étoiles, anglais-espagnol-arabe courants.",       distance:"0,7 km", responseTime:"~3 min",  missions:74, role:"Concierge" }),
  _mkP({ id:104, name:"Pauline Dumont",   jobTitle:"Responsable petit-déjeuner", tarifNet:13.5, avatar:"☕", color:"#FFB74D", rating:4.6, reviews:31, skills:["Service buffet","Hygiène alimentaire","Caisse"],    experience:"5 ans",  available:false, sector:"hotellerie",   bio:"Spécialiste service petit-déjeuner, rigoureuse HACCP.",       distance:"3,5 km", responseTime:"~15 min", missions:31, role:"Responsable petit-déjeuner" }),
  // Propreté (extras)
  _mkP({ id:105, name:"Sylvie Lecomte",   jobTitle:"Agent de propreté",       tarifNet:12.5, avatar:"✨",  color:"#26C6DA", rating:4.8, reviews:58, skills:["Nettoyage bureaux","Technique J38","Sols spéciaux"],  experience:"8 ans",  available:true,  sector:"proprete",     bio:"Agente confirmée, expérience immeubles de prestige.",         distance:"0,5 km", responseTime:"~2 min",  missions:58, role:"Agent de propreté" }),
  _mkP({ id:106, name:"Hamidou Traoré",   jobTitle:"Technicien de surface",   tarifNet:13.5, avatar:"🧴",  color:"#26C6DA", rating:4.5, reviews:22, skills:["Monobrosse","Autolaveuse","Produits Pro"],            experience:"5 ans",  available:true,  sector:"proprete",     bio:"Technicien machines, remise en état sols et moquettes.",      distance:"2,3 km", responseTime:"~9 min",  missions:22, role:"Technicien de surface" }),
  // Commercial (extras)
  _mkP({ id:107, name:"Vanessa Piotrowski",jobTitle:"Téléprospecteur(trice)", tarifNet:13.0, avatar:"📞", color:"#BA68C8", rating:4.5, reviews:30, skills:["Cold calling","CRM","Qualification leads","Argumentation"],experience:"4 ans",available:true,sector:"commercial",  bio:"Téléprospectrice B2B, taux de prise de RDV au-dessus de la moyenne.",distance:"1,2 km",responseTime:"~5 min",missions:30,role:"Téléprospecteur(trice)" }),
  _mkP({ id:108, name:"Hugo Bertin",      jobTitle:"Chargé(e) de compte",     tarifNet:16.0, avatar:"🤝",  color:"#BA68C8", rating:4.6, reviews:41, skills:["Account management","Upsell","Fidélisation","CRM"],   experience:"6 ans",  available:true,  sector:"commercial",   bio:"Chargé de compte confirmé, portefeuille PME-ETI.",            distance:"2,8 km", responseTime:"~11 min", missions:41, role:"Chargé(e) de compte" }),
  // Distribution (extras)
  _mkP({ id:109, name:"Leila Ouali",      jobTitle:"Mise en rayon",           tarifNet:11.5, avatar:"🏪",  color:"#4DB6AC", rating:4.4, reviews:19, skills:["Facing","Réassort","Étiquetage","PLV"],              experience:"2 ans",  available:true,  sector:"distribution", bio:"Expérience grandes surfaces, disponible tôt le matin.",       distance:"0,9 km", responseTime:"~4 min",  missions:19, role:"Mise en rayon" }),
  _mkP({ id:110, name:"Frédéric Blanche", jobTitle:"Chef de rayon",           tarifNet:14.0, avatar:"📊",  color:"#4DB6AC", rating:4.7, reviews:46, skills:["Gestion rayon","Commandes","Management","Pertes"],    experience:"7 ans",  available:true,  sector:"distribution", bio:"Chef de rayon expérimenté, réduction des pertes et DLC.",      distance:"3,3 km", responseTime:"~14 min", missions:46, role:"Chef de rayon" }),
  // Divers (extras)
  _mkP({ id:111, name:"Cédric Masson",    jobTitle:"Chauffeur VTC",           tarifNet:15.5, avatar:"🚗",  color:"#7986CB", rating:4.8, reviews:67, skills:["Permis B","VTC","Anglais","Carte pro"],               experience:"5 ans",  available:true,  sector:"divers",       bio:"Chauffeur VTC professionnel, discret et ponctuel.",           distance:"0,3 km", responseTime:"~1 min",  missions:67, role:"Chauffeur VTC" }),
  _mkP({ id:112, name:"Roxane Levy",      jobTitle:"Assistant(e) événementiel", tarifNet:13.0, avatar:"🎉", color:"#7986CB", rating:4.6, reviews:34, skills:["Organisation événements","Accueil","Logistique","Tenue pro"],experience:"4 ans",available:true,sector:"divers",    bio:"Hotesse et assistante événementielle, multilingue.",           distance:"1,7 km", responseTime:"~7 min",  missions:34, role:"Assistant(e) événementiel" })
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

const Input = ({ label, type="text", placeholder, icon, value, onChange, hint, disabled=false, autoComplete, name, inputMode }) => (
  <div style={{ marginBottom:16, minWidth:0 }}>
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
        autoComplete={autoComplete}
        name={name}
        inputMode={inputMode}
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

      {/* Logo aligné à gauche */}
      <div style={{ paddingTop:64, marginBottom:"auto" }}>
        <ALANELogo size="lg" />
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
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:13, marginBottom:2 }}>Offre de lancement</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.5 }}>10 missions gratuites · Réservé aux 100 premiers prestataires inscrits</div>
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
  const [showCGU,setShowCGU]=useState(false);
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20 0%, #0A1628 50%, #162547 100%)`, display:"flex", flexDirection:"column", padding:"60px 24px 48px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.20) 0%, transparent 65%)`, pointerEvents:"none" }} />

      <div style={{ marginBottom:48 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <ALANELogo size="sm" />
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
            <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement</div>
            <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, lineHeight:1.5 }}>10 missions gratuites · Réservé aux 100 premiers prestataires inscrits</div>
          </div>
        </div>
      )}

      <p style={{ color:C.textMuted, fontSize:11, textAlign:"center", marginTop:16 }}>
        En continuant, vous acceptez nos <span onClick={()=>setShowCGU(true)} style={{ color:C.violet, cursor:"pointer", textDecoration:"underline" }}>CGU</span>
      </p>
      {showCGU && (
        <div onClick={()=>setShowCGU(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 22px 40px", width:"100%", maxWidth:540, maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:16 }}>📋 Conditions Générales</div>
              <button onClick={()=>setShowCGU(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {[
              { title:"1. Objet", text:"ALANE est une plateforme de mise en relation entre clients professionnels et prestataires qualifiés. L'utilisation de la plateforme implique l'acceptation des présentes conditions." },
              { title:"2. Inscription", text:"L'accès aux services nécessite la création d'un compte. Les informations fournies doivent être exactes et à jour. ALANE se réserve le droit de refuser ou suspendre tout compte." },
              { title:"3. Missions", text:"Les missions sont conclues directement entre clients et prestataires via la plateforme. ALANE agit en tant qu'intermédiaire et n'est pas partie au contrat de prestation." },
              { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. Les fonds sont placés en escrow jusqu'à validation de la mission par le client. Toute contestation doit être soumise sous 48h." },
              { title:"5. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'inexécution ou de la mauvaise exécution des missions. Chaque prestataire est couvert par sa propre RC Professionnelle." },
              { title:"6. Données personnelles", text:"Les données sont traitées conformément au RGPD. Vous disposez d'un droit d'accès, de rectification et de suppression. Contact : legal@alane.fr" },
            ].map((s,i)=>(
              <div key={i} style={{ marginBottom:14 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.7 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── AUTH SCREEN — Connexion / Inscription ────────────────────────

const COMPETENCES_PAR_SECTEUR = {
  proprete:    ["Nettoyage bureaux","Désinfection","Nettoyage industriel","Vitres","Sols spéciaux","Monobrosse","Autolaveuse","HACCP","Tri sélectif"],
  logistique:  ["CACES 1","CACES 3","CACES 5","Prépa commandes","Gestion de stock","WMS","Scan","Palettisation","Réception/Expédition"],
  hotellerie:  ["Opera PMS","Accueil VIP","Check-in/out","Conciergerie","Réservations","Service buffet","Gestion réclamations","Fidelio","Yield management"],
  btp:         ["Maçonnerie","Coffrage","Béton armé","Câblage électrique","NF C 15-100","Plomberie","Soudure","Peinture intérieure","Carrelage","Lecture plans","AIPR","CACES Nacelle"],
  restauration:["Service en salle","HACCP","Cuisine française","Cuissons","Pâtisserie","Sommellerie","Barman cocktails","Caisse","Accueil clientèle"],
  commercial:  ["Prospection B2B","CRM","Closing","Négociation","Salesforce","HubSpot","Account management","Upselling","Cold calling"],
  distribution:["Encaissement","Mise en rayon","Gestion DLC","Facing","PLV","Inventaire","SAV caisse","Gestion de rayon"],
  divers:      ["CQP APS","Surveillance vidéo","Contrôle accès","Permis B","VTC","Animation événements","Bureautique","Standard téléphonique"],
};

function PrestaRegisterFlow({ onRegister, onBack, accentColor }) {
  const TOTAL = 7;
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [secteur, setSecteur] = useState("");
  const [metier, setMetier] = useState("");
  const [niveau, setNiveau] = useState("");
  const [experienceAns, setExperienceAns] = useState(2);
  const [competences, setCompetences] = useState([]);
  const [langues, setLangues] = useState(["Français"]);
  const [dispos, setDispos] = useState({});
  const [dispoImmediat, setDispoImmediat] = useState(true);
  const [tarifNet, setTarifNet] = useState(13);
  const [ribIban, setRibIban] = useState("");
  const [statutPro, setStatutPro] = useState("auto-entrepreneur");
  const [planChoisi, setPlanChoisi] = useState("free");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (secteur && metier && METIERS_TARIFS[secteur]?.[metier]) {
      setTarifNet(METIERS_TARIFS[secteur][metier].default);
    }
  }, [secteur, metier]);

  const toggleItem = (arr, setArr, item) =>
    setArr(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);

  const validateStep = () => {
    if (step === 1) {
      if (!prenom.trim() || !nom.trim()) return "Prénom et nom obligatoires";
      if (telephone.replace(/[\s.\-]/g,"").length < 10) return "Numéro de téléphone obligatoire";
    }
    if (step === 2) {
      if (!secteur) return "Choisissez un secteur d'activité";
      if (!metier)  return "Choisissez votre métier";
    }
    if (step === 3) { if (!niveau) return "Sélectionnez votre niveau"; }
    if (step === 4) {
      if (!Object.values(dispos).some(cr => cr?.length > 0)) return "Sélectionnez au moins un créneau";
    }
    if (step === 7) {
      if (!email || !password)  return "Email et mot de passe requis";
      if (password.length < 6)  return "Mot de passe minimum 6 caractères";
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(""); setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true); setError("");
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email, password,
      options: { data: {
        role: "prestataire", prenom: prenom.trim(), nom: nom.trim(),
        telephone: telephone.replace(/[\s.\-]/g,""),
        secteur, metier, niveau, experience_ans: experienceAns, competences, langues,
        dispon_jours: JOURS.filter(j => (dispos[j]||[]).length > 0), dispon_jours_creneaux: dispos, dispo_immediat: dispoImmediat,
        tarif_net: tarifNet, statut_pro: statutPro, rib: ribIban.replace(/\s/g,"") || null,
        plan_abonnement: planChoisi,
      }},
    });
    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message.includes("already") || signUpErr.message.includes("registered")
        ? "Un compte existe déjà avec cet email. Connectez-vous à la place."
        : signUpErr.message);
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role: "prestataire", prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/notify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prenom: prenom.trim(), nom: nom.trim(), email, role: "prestataire" }),
      }).catch(() => {});
      await fetch("/api/welcome-email", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, prenom: prenom.trim(), nom: nom.trim(), role:"prestataire" }) }).catch(()=>{});
      await supabase.auth.signOut();
    }
    setLoading(false);
    onRegister();
  };

  const secteurInfo  = SECTORS.find(s => s.id === secteur);
  const metiersListe = secteur ? Object.keys(METIERS_TARIFS[secteur] || {}) : [];
  const compListe    = COMPETENCES_PAR_SECTEUR[secteur] || [];
  const tarifInfo    = secteur && metier ? METIERS_TARIFS[secteur]?.[metier] : null;
  const sliderMin    = 1;
  const sliderMax    = 100;
  const tarifClient  = prixClient(tarifNet, secteur || "divers");

  const STEP_TITLES = ["Votre identité","Secteur & Métier","Expérience","Disponibilités","Rémunération & Statut","Votre abonnement","Récapitulatif"];
  const STEP_ICONS  = ["👤","🏗️","⭐","📅","💶","⚡","✅"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ padding:"54px 24px 16px" }}>
        <button onClick={step===1 ? onBack : ()=>{setError("");setStep(s=>s-1)}} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>
          ← {step===1 ? "Retour à la connexion" : "Étape précédente"}
        </button>
        <div style={{ display:"flex", gap:4, marginBottom:16 }}>
          {Array.from({length:TOTAL},(_,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i<step?accentColor:`${accentColor}25`, transition:"background 0.3s" }} />
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${accentColor}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{STEP_ICONS[step-1]}</div>
          <div>
            <div style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Étape {step}/{TOTAL} — Inscription Prestataire</div>
            <div style={{ color:C.text, fontSize:18, fontWeight:700, fontFamily:font.display }}>{STEP_TITLES[step-1]}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, padding:"8px 24px 16px", overflowY:"auto" }}>
        {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

        {step === 1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
          </div>
          <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(e.target.value)} />
          <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginTop:4, display:"flex", gap:10 }}>
            <span style={{ fontSize:18 }}>💡</span>
            <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>Votre numéro ne sera communiqué au client qu'après confirmation d'une mission.</p>
          </div>
        </>}

        {step === 2 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:12 }}>Dans quel secteur exercez-vous votre activité ?</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {SECTORS.map(s => (
              <button key={s.id} onClick={()=>{setSecteur(s.id); setMetier(""); setCompetences([]);}} style={{ padding:"14px 10px", borderRadius:r, border:`2px solid ${secteur===s.id?s.color:C.border}`, background:secteur===s.id?`${s.color}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:26, marginBottom:6 }}>{s.icon}</div>
                <div style={{ color:secteur===s.id?s.color:C.textSub, fontWeight:secteur===s.id?700:500, fontSize:12 }}>{s.label}</div>
              </button>
            ))}
          </div>
          {secteur && <>
            <p style={{ color:C.textSub, fontSize:13, marginBottom:10 }}>Quel est votre métier principal ?</p>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {metiersListe.map(m => (
                <button key={m} onClick={()=>setMetier(m)} style={{ padding:"13px 16px", borderRadius:r, border:`2px solid ${metier===m?(secteurInfo?.color||accentColor):C.border}`, background:metier===m?`${secteurInfo?.color||accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"all 0.2s" }}>
                  <span style={{ color:metier===m?(secteurInfo?.color||accentColor):C.text, fontWeight:metier===m?700:500, fontSize:14 }}>{m}</span>
                  {METIERS_TARIFS[secteur]?.[m] && <span style={{ color:C.textSub, fontSize:12 }}>{METIERS_TARIFS[secteur][m].min}–{METIERS_TARIFS[secteur][m].max} €/h</span>}
                </button>
              ))}
            </div>
          </>}
        </>}

        {step === 3 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:12 }}>Votre niveau pour le poste de <strong style={{ color:C.text }}>{metier}</strong> ?</p>
          <div style={{ display:"flex", gap:8, marginBottom:20 }}>
            {NIVEAUX.map(n => (
              <button key={n} onClick={()=>setNiveau(n)} style={{ flex:1, padding:"13px 8px", borderRadius:r, border:`2px solid ${niveau===n?accentColor:C.border}`, background:niveau===n?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:22, marginBottom:4 }}>{n==="Débutant"?"🌱":n==="Confirmé"?"💪":"🏆"}</div>
                <div style={{ color:niveau===n?accentColor:C.textSub, fontWeight:niveau===n?700:500, fontSize:12 }}>{n}</div>
              </button>
            ))}
          </div>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>
            Années d'expérience : <span style={{ color:accentColor, fontWeight:800 }}>{experienceAns} an{experienceAns>1?"s":""}</span>
          </label>
          <input type="range" min={0} max={20} value={experienceAns} onChange={e=>setExperienceAns(Number(e.target.value))} style={{ width:"100%", accentColor, marginBottom:20 }} />
          {compListe.length > 0 && <>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Compétences clés (optionnel)</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
              {compListe.map(c => (
                <button key={c} onClick={()=>toggleItem(competences,setCompetences,c)} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${competences.includes(c)?accentColor:C.border}`, background:competences.includes(c)?`${accentColor}25`:"transparent", color:competences.includes(c)?accentColor:C.textSub, fontSize:12, fontWeight:competences.includes(c)?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{c}</button>
              ))}
            </div>
          </>}
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Langues parlées</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {LANGUES_LIST.map(l => (
              <button key={l} onClick={()=>{
                if (l === "Français") return;
                toggleItem(langues, setLangues, l);
              }} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${langues.includes(l)?accentColor:C.border}`, background:langues.includes(l)?`${accentColor}25`:"transparent", color:langues.includes(l)?accentColor:C.textSub, fontSize:12, fontWeight:langues.includes(l)?700:400, cursor:l==="Français"?"default":"pointer", fontFamily:"inherit", transition:"all 0.2s", opacity:l==="Français"?0.6:1 }}>
                {l}{l==="Français" ? " ✓" : ""}
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6, paddingLeft:2 }}>Le français est sélectionné par défaut</div>
        </>}

        {step === 4 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:14 }}>Indiquez vos créneaux disponibles jour par jour.</p>
          {JOURS.map(jour => {
            const sel = dispos[jour] || [];
            const hasSel = sel.length > 0;
            return (
              <div key={jour} style={{ marginBottom:10, borderRadius:12, border:`2px solid ${hasSel?accentColor:C.border}`, overflow:"hidden", transition:"border-color 0.2s" }}>
                <div style={{ padding:"10px 14px", background:hasSel?`${accentColor}10`:"rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, color:hasSel?accentColor:C.text, fontSize:14 }}>{jour}</span>
                  {hasSel
                    ? <span style={{ fontSize:11, color:accentColor, fontWeight:600 }}>{sel.map(c=>c.split(" ")[0]).join(" · ")}</span>
                    : <span style={{ color:C.textSub, fontSize:11 }}>Non disponible</span>}
                </div>
                <div style={{ padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}`, background:"rgba(0,0,0,0.15)" }}>
                  {PLAGES.map(plage => {
                    const active = sel.includes(plage);
                    return (
                      <button key={plage} onClick={()=>setDispos(prev=>{ const cur=prev[jour]||[]; return {...prev,[jour]:active?cur.filter(x=>x!==plage):[...cur,plage]}; })}
                        style={{ padding:"7px 13px", borderRadius:10, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:active?700:500, background:active?accentColor:"rgba(255,255,255,0.07)", color:active?C.white:C.textSub, transition:"all 0.15s" }}>
                        {plage.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div onClick={()=>setDispoImmediat(!dispoImmediat)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", cursor:"pointer", marginTop:6 }}>
            <div>
              <div style={{ color:C.text, fontWeight:600, fontSize:14 }}>Disponible immédiatement</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Apparaissez dans les résultats urgents</div>
            </div>
            <div style={{ width:44, height:24, borderRadius:12, background:dispoImmediat?accentColor:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
              <div style={{ position:"absolute", top:2, left:dispoImmediat?22:2, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>
        </>}

        {step === 5 && <>
          <div style={{ marginBottom:20 }}>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:12, textTransform:"uppercase", letterSpacing:0.8 }}>
              Tarif horaire net souhaité : <span style={{ color:accentColor, fontWeight:800, fontSize:16 }}>{tarifNet.toFixed(2)} €/h</span>
            </label>
            <input type="range" min={sliderMin} max={sliderMax} step={0.5} value={tarifNet} onChange={e=>setTarifNet(Number(e.target.value))} style={{ width:"100%", accentColor, marginBottom:8 }} />
            <div style={{ display:"flex", justifyContent:"space-between", color:C.textMuted, fontSize:11 }}>
              <span>{sliderMin} €/h</span><span>{sliderMax} €/h</span>
            </div>
            {tarifInfo && (
              <div style={{ background: tarifNet < tarifInfo.min ? "rgba(242,94,94,0.08)" : tarifNet > tarifInfo.max ? "rgba(240,180,41,0.08)" : "rgba(255,255,255,0.04)", border:`1px solid ${tarifNet < tarifInfo.min ? "#F25E5E44" : tarifNet > tarifInfo.max ? `${C.accentGold}44` : C.border}`, borderRadius:8, padding:"7px 12px", marginTop:8, fontSize:11, color:C.textSub }}>
                {tarifNet < tarifInfo.min && <span style={{ color:"#F25E5E", fontWeight:700 }}>⚠️ En dessous du marché · </span>}
                {tarifNet > tarifInfo.max && <span style={{ color:C.accentGold, fontWeight:700 }}>📈 Au-dessus du marché · </span>}
                📊 Fourchette marché : <strong style={{ color:C.text }}>{tarifInfo.min} – {tarifInfo.max} €/h net</strong>
              </div>
            )}
            <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"12px 14px", marginTop:12, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>ℹ️</span>
              <span style={{ color:C.textSub, fontSize:12 }}>Le client verra <strong style={{ color:C.text }}>{tarifClient.toFixed(2)} €/h</strong> (frais inclus). Vous encaissez <strong style={{ color:accentColor }}>{tarifNet.toFixed(2)} €/h</strong>.</span>
            </div>
          </div>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Statut professionnel *</label>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            {[
              { id:"auto-entrepreneur", label:"Auto-entrepreneur / Micro-entreprise", icon:"🧾" },
            ].map(s => (
              <button key={s.id} onClick={()=>setStatutPro(s.id)} style={{ padding:"13px 16px", borderRadius:r, border:`2px solid ${statutPro===s.id?accentColor:C.border}`, background:statutPro===s.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:10, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:18 }}>{s.icon}</span>
                <span style={{ color:statutPro===s.id?accentColor:C.text, fontWeight:statutPro===s.id?700:500, fontSize:13 }}>{s.label}</span>
              </button>
            ))}
          </div>
          <Input label="IBAN / RIB *" placeholder="FR76 3000 4028 0000 0000 0000 000" icon="🏦" value={ribIban} onChange={e=>setRibIban(e.target.value.toUpperCase())} />
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:-10, paddingLeft:4 }}>Requis pour recevoir le paiement de vos missions</div>
        </>}

        {step === 6 && <>
          <div style={{ marginBottom:8 }}>
            <p style={{ color:C.textSub, fontSize:13, margin:"0 0 16px", lineHeight:1.6 }}>Choisissez votre formule. Vous pouvez changer à tout moment depuis votre espace.</p>
            {ABONNEMENTS_PRESTA.map(plan => {
              const active = planChoisi === plan.id;
              return (
                <div key={plan.id} onClick={() => setPlanChoisi(plan.id)}
                  style={{ background: active ? `${plan.color}18` : "#0D1B3E", border: `2px solid ${active ? plan.color : C.border}`, borderRadius: r + 4, padding:"16px", marginBottom:10, cursor:"pointer", position:"relative", transition:"all 0.2s" }}>
                  {plan.popular && <div style={{ position:"absolute", top:-10, right:14, background:plan.color, color:"#fff", fontSize:10, fontWeight:800, borderRadius:99, padding:"3px 10px", letterSpacing:0.5 }}>POPULAIRE</div>}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:22 }}>{plan.icon}</span>
                      <div>
                        <div style={{ fontWeight:800, color: active ? plan.color : C.text, fontSize:15 }}>{plan.label}</div>
                        <div style={{ color:C.textSub, fontSize:12 }}>{plan.price === 0 ? "Gratuit" : `${plan.price} €/mois`}</div>
                      </div>
                    </div>
                    <div style={{ width:22, height:22, borderRadius:"50%", border:`2px solid ${active ? plan.color : C.border}`, background: active ? plan.color : "transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>
                      {active && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {plan.features.map(f => (
                      <span key={f} style={{ fontSize:11, color: active ? plan.color : C.textSub, background: active ? `${plan.color}18` : "rgba(255,255,255,0.05)", borderRadius:99, padding:"3px 9px", fontWeight:600 }}>✓ {f}</span>
                    ))}
                    {plan.locked.map(f => (
                      <span key={f} style={{ fontSize:11, color:C.textMuted, background:"rgba(255,255,255,0.03)", borderRadius:99, padding:"3px 9px" }}>🔒 {f}</span>
                    ))}
                  </div>
                  {plan.note && <p style={{ color:C.textMuted, fontSize:10, margin:"8px 0 0", lineHeight:1.5, fontStyle:"italic" }}>{plan.note}</p>}
                </div>
              );
            })}
            {isLaunchPhase() && (
              <div style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}44`, borderRadius:r, padding:"11px 14px", marginTop:6, fontSize:12, color:C.text }}>
                🚀 <strong>Offre de lancement</strong> — Les <strong style={{ color:C.violetLight }}>100 premiers inscrits</strong> → <strong style={{ color:C.accentGold }}>10 missions/mois gratuites</strong> !<br/>
                <span style={{ color:C.textSub }}>2 missions/mois ensuite pour le plan Gratuit.</span>
              </div>
            )}
          </div>
        </>}

        {step === 7 && <>
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", marginBottom:20 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>📋 Récapitulatif de votre profil</div>
            {[
              { l:"Nom",           v:`${prenom} ${nom}` },
              { l:"Téléphone",     v:telephone },
              { l:"Secteur",       v:secteurInfo?.label || secteur },
              { l:"Métier",        v:metier },
              { l:"Niveau",        v:niveau },
              { l:"Expérience",    v:`${experienceAns} an${experienceAns>1?"s":""}` },
              { l:"Disponibilités",v:JOURS.filter(j=>(dispos[j]||[]).length>0).map(j=>`${j.slice(0,3)}: ${(dispos[j]||[]).map(c=>c.split(" ")[0]).join(", ")}`).join(" · ") || "—" },
              { l:"Langues",       v:langues.join(", ") },
              { l:"Tarif net",     v:`${tarifNet.toFixed(2)} €/h` },
              { l:"Statut",        v:statutPro },
              { l:"Abonnement",    v:(ABONNEMENTS_PRESTA.find(p=>p.id===planChoisi)||ABONNEMENTS_PRESTA[0]).label },
            ].map(({l,v}) => (
              <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:6 }}>
                <span style={{ color:C.textSub }}>{l}</span>
                <span style={{ color:C.text, fontWeight:600, maxWidth:"60%", textAlign:"right" }}>{v}</span>
              </div>
            ))}
          </div>
          <Input label="Adresse email *" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
          <div style={{ position:"relative" }}>
            <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{showPass?"Cacher":"Voir"}</button>
          </div>
          <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", lineHeight:1.6 }}>
            En créant un compte vous acceptez nos <span style={{ color:accentColor, cursor:"pointer" }}>CGU</span> et notre <span style={{ color:accentColor, cursor:"pointer" }}>Politique de confidentialité</span>
          </p>
        </>}
      </div>

      {/* Bottom nav */}
      <div style={{ padding:"16px 24px 40px", display:"flex", gap:10 }}>
        {step > 1 && <Btn variant="ghost" onClick={()=>{setError("");setStep(s=>s-1)}} style={{ flex:1 }}>← Retour</Btn>}
        <Btn onClick={step===TOTAL?handleSubmit:handleNext} disabled={loading} style={{ flex:2, background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, padding:"14px" }}>
          {step===TOTAL ? (loading?"Création…":"Créer mon compte →") : "Continuer →"}
        </Btn>
      </div>
    </div>
  );
}

function ClientRegisterFlow({ onRegister, onBack, accentColor }) {
  const TOTAL = 3;
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [typeCompte, setTypeCompte] = useState("particulier");
  const [societeNom, setSocieteNom] = useState("");
  const [kbisNum, setKbisNum] = useState("");
  const [secteursBesoins, setSecteursBesoins] = useState([]);
  const [metiersBesoins, setMetiersBesoins] = useState([]);
  const [frequence, setFrequence] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [lieuxIntervention, setLieuxIntervention] = useState([{ adresse:"", codePostal:"", ville:"" }]);
  const [volumeHoraire, setVolumeHoraire] = useState("");
  const [rib, setRib] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const toggleSecteur = id => {
    setSecteursBesoins(prev => {
      const next = prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id];
      const metiersValides = next.flatMap(s => Object.keys(METIERS_TARIFS[s] || {}));
      setMetiersBesoins(m => m.filter(x => metiersValides.includes(x)));
      return next;
    });
  };

  const toggleMetier = id =>
    setMetiersBesoins(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);

  const validateStep = () => {
    if (step === 1) {
      if (!prenom.trim() || !nom.trim()) return "Prénom et nom obligatoires";
      if (telephone.replace(/[\s.\-]/g,"").length < 10) return "Numéro de téléphone obligatoire";
      if (typeCompte === "professionnel") {
        if (!societeNom.trim()) return "Nom de société obligatoire";
        if (!kbisNum.trim())    return "Numéro SIRET/KBIS obligatoire";
      }
    }
    if (step === 2) {
      if (!secteursBesoins.length) return "Sélectionnez au moins un secteur";
      if (!frequence)              return "Indiquez la fréquence de vos besoins";
      if (!ville.trim())           return "Indiquez votre ville";
      if (!codePostal.trim())      return "Indiquez votre code postal";
      if (!volumeHoraire)          return "Indiquez votre volume horaire estimé";
      if (lieuxIntervention.some(l => !l.adresse.trim() || !l.ville.trim())) return "Remplissez tous les lieux d'intervention (adresse et ville)";
    }
    if (step === 3) {
      if (!email || !password) return "Email et mot de passe requis";
      if (password.length < 6) return "Mot de passe minimum 6 caractères";
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(""); setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true); setError("");
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email, password,
      options: { data: {
        role: "client", prenom: prenom.trim(), nom: nom.trim(),
        telephone: telephone.replace(/[\s.\-]/g,""),
        type_compte: typeCompte, societe_nom: societeNom||null, kbis: kbisNum||null,
        secteurs_besoins: secteursBesoins, metiers_besoins: metiersBesoins, frequence_besoins: frequence,
        lieux_intervention: lieuxIntervention.filter(l=>l.adresse.trim()||l.ville.trim()),
        adresse: adresse||null, code_postal: codePostal||null, ville,
        volume_horaire: volumeHoraire,
        rib: rib.replace(/\s/g,"") || null,
      }},
    });
    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message.includes("already") || signUpErr.message.includes("registered")
        ? "Un compte existe déjà avec cet email. Connectez-vous à la place."
        : signUpErr.message);
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role: "client", prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/notify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prenom: prenom.trim(), nom: nom.trim(), email, role: "client" }),
      }).catch(() => {});
      await fetch("/api/welcome-email", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, prenom: prenom.trim(), nom: nom.trim(), role:"client" }) }).catch(()=>{});
      await supabase.auth.signOut();
    }
    setLoading(false);
    onRegister();
  };

  const STEP_TITLES = ["Votre identité","Vos besoins","Votre compte"];
  const STEP_ICONS  = ["👤","🎯","🔐"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"54px 24px 16px" }}>
        <button onClick={step===1 ? onBack : ()=>{setError("");setStep(s=>s-1)}} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>
          ← {step===1 ? "Retour à la connexion" : "Étape précédente"}
        </button>
        <div style={{ display:"flex", gap:4, marginBottom:16 }}>
          {Array.from({length:TOTAL},(_,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i<step?accentColor:`${accentColor}25`, transition:"background 0.3s" }} />
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${accentColor}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{STEP_ICONS[step-1]}</div>
          <div>
            <div style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Étape {step}/{TOTAL} — Inscription Client</div>
            <div style={{ color:C.text, fontSize:18, fontWeight:700, fontFamily:font.display }}>{STEP_TITLES[step-1]}</div>
          </div>
        </div>
      </div>

      <div style={{ flex:1, padding:"8px 24px 16px", overflowY:"auto" }}>
        {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

        {step === 1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
          </div>
          <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(e.target.value)} />
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Type de compte *</label>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[{id:"particulier",label:"👤 Particulier"},{id:"professionnel",label:"🏢 Professionnel"}].map(t=>(
              <button key={t.id} onClick={()=>setTypeCompte(t.id)} style={{ flex:1, padding:"12px", borderRadius:r, border:`2px solid ${typeCompte===t.id?accentColor:C.border}`, background:typeCompte===t.id?`${accentColor}20`:"transparent", color:typeCompte===t.id?accentColor:C.textSub, fontWeight:typeCompte===t.id?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
            ))}
          </div>
          {typeCompte === "professionnel" && <>
            <Input label="Nom de société *" placeholder="ACME SARL" icon="🏢" value={societeNom} onChange={e=>setSocieteNom(e.target.value)} />
            <Input label="N° SIRET / KBIS *" placeholder="123 456 789 00010" icon="📄" value={kbisNum} onChange={e=>setKbisNum(e.target.value)} inputMode="numeric" />
          </>}
        </>}

        {step === 2 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:12 }}>
            Dans quels secteurs avez-vous besoin de main-d'œuvre ? <span style={{ color:C.textMuted }}>(plusieurs choix possibles)</span>
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {SECTORS.map(s => (
              <button key={s.id} onClick={()=>toggleSecteur(s.id)} style={{ padding:"13px 10px", borderRadius:r, border:`2px solid ${secteursBesoins.includes(s.id)?s.color:C.border}`, background:secteursBesoins.includes(s.id)?`${s.color}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s", position:"relative" }}>
                {secteursBesoins.includes(s.id) && <div style={{ position:"absolute", top:6, right:8, width:16, height:16, borderRadius:"50%", background:s.color, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ color:"#fff", fontSize:10, fontWeight:900 }}>✓</span></div>}
                <div style={{ fontSize:22, marginBottom:5 }}>{s.icon}</div>
                <div style={{ color:secteursBesoins.includes(s.id)?s.color:C.textSub, fontWeight:secteursBesoins.includes(s.id)?700:500, fontSize:12 }}>{s.label}</div>
              </button>
            ))}
          </div>
          {secteursBesoins.length > 0 && <>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Métiers recherchés <span style={{ color:C.textMuted, textTransform:"none", letterSpacing:0 }}>(plusieurs choix possibles)</span></label>
            {secteursBesoins.map(sid => {
              const s = SECTORS.find(x=>x.id===sid);
              const metiers = Object.keys(METIERS_TARIFS[sid] || {});
              if (!metiers.length) return null;
              return (
                <div key={sid} style={{ marginBottom:14 }}>
                  <div style={{ color:s?.color||accentColor, fontSize:12, fontWeight:700, marginBottom:6 }}>{s?.icon} {s?.label}</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {metiers.map(m => (
                      <button key={m} onClick={()=>toggleMetier(m)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${metiersBesoins.includes(m)?(s?.color||accentColor):C.border}`, background:metiersBesoins.includes(m)?`${s?.color||accentColor}20`:"rgba(255,255,255,0.03)", color:metiersBesoins.includes(m)?(s?.color||accentColor):C.textSub, fontWeight:metiersBesoins.includes(m)?700:400, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                        {metiersBesoins.includes(m) && "✓ "}{m}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ height:8 }} />
          </>}
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Fréquence de vos besoins *</label>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            {[
              { id:"ponctuel",  label:"Ponctuel",           desc:"Missions occasionnelles selon les besoins",  icon:"⚡" },
              { id:"regulier",  label:"Régulier",           desc:"Besoin récurrent chaque semaine ou mois",    icon:"📅" },
              { id:"les-deux",  label:"Ponctuel & Régulier",desc:"Mix de missions récurrentes et ponctuelles", icon:"🔄" },
            ].map(f => (
              <button key={f.id} onClick={()=>setFrequence(f.id)} style={{ padding:"13px 16px", borderRadius:r, border:`2px solid ${frequence===f.id?accentColor:C.border}`, background:frequence===f.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:12, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:20 }}>{f.icon}</span>
                <div>
                  <div style={{ color:frequence===f.id?accentColor:C.text, fontWeight:frequence===f.id?700:500, fontSize:13 }}>{f.label}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{f.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <Input label="Adresse *" placeholder="12 rue de la Paix" icon="📍" value={adresse} onChange={e=>setAdresse(e.target.value)} autoComplete="off" />
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}><Input label="Code postal *" placeholder="75001" value={codePostal} onChange={e=>setCodePostal(e.target.value)} autoComplete="off" inputMode="numeric" /></div>
            <div style={{ flex:2, minWidth:0 }}><Input label="Ville *" placeholder="Paris" value={ville} onChange={e=>setVille(e.target.value)} autoComplete="off" /></div>
          </div>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Volume horaire estimé *</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { id:"<8h",   label:"Moins de 8h",  desc:"Quelques heures / semaine",    icon:"🕐" },
              { id:"8-20h", label:"8 à 20h",       desc:"1 à 3 jours / semaine",       icon:"📆" },
              { id:"20-40h",label:"20 à 40h",      desc:"Mi-temps à temps plein",      icon:"💼" },
              { id:">40h",  label:"Plus de 40h",   desc:"Plusieurs personnes / sites",  icon:"🏢" },
            ].map(v => (
              <button key={v.id} onClick={()=>setVolumeHoraire(v.id)} style={{ padding:"12px 10px", borderRadius:r, border:`2px solid ${volumeHoraire===v.id?accentColor:C.border}`, background:volumeHoraire===v.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:20, marginBottom:4 }}>{v.icon}</div>
                <div style={{ color:volumeHoraire===v.id?accentColor:C.text, fontWeight:volumeHoraire===v.id?700:500, fontSize:13 }}>{v.label}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{v.desc}</div>
              </button>
            ))}
          </div>

          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, marginTop:20, textTransform:"uppercase", letterSpacing:0.8 }}>Lieux d'intervention *</label>
          <p style={{ color:C.textMuted, fontSize:12, margin:"0 0 12px" }}>Indiquez où le prestataire devra intervenir (plusieurs adresses possibles).</p>
          {lieuxIntervention.map((lieu, i) => (
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:r, padding:"12px 14px", marginBottom:10, position:"relative" }}>
              {lieuxIntervention.length > 1 && (
                <button onClick={()=>setLieuxIntervention(prev=>prev.filter((_,j)=>j!==i))} style={{ position:"absolute", top:10, right:10, background:"transparent", border:"none", color:"rgba(242,94,94,0.7)", fontSize:16, cursor:"pointer", lineHeight:1 }}>✕</button>
              )}
              <Input label={`Adresse ${lieuxIntervention.length > 1 ? i+1 : ""}`} placeholder="12 rue de la Paix" icon="📍"
                value={lieu.adresse} onChange={e=>{ const v=e.target.value; setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,adresse:v}:l)); }} autoComplete="off" />
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}><Input label="Code postal" placeholder="75001"
                  value={lieu.codePostal} onChange={e=>{ const v=e.target.value; setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,codePostal:v}:l)); }} autoComplete="off" inputMode="numeric" /></div>
                <div style={{ flex:2, minWidth:0 }}><Input label="Ville" placeholder="Paris"
                  value={lieu.ville} onChange={e=>{ const v=e.target.value; setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,ville:v}:l)); }} autoComplete="off" /></div>
              </div>
            </div>
          ))}
          <button onClick={()=>setLieuxIntervention(prev=>[...prev,{adresse:"",codePostal:"",ville:""}])} style={{ width:"100%", padding:"11px", borderRadius:r, border:`1.5px dashed ${accentColor}60`, background:"transparent", color:accentColor, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", marginBottom:8 }}>
            + Ajouter un lieu
          </button>
        </>}

        {step === 3 && <>
          <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10 }}>
            <span style={{ fontSize:18 }}>🏦</span>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:3 }}>IBAN / RIB (optionnel)</div>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.5, margin:0 }}>Non obligatoire à l'inscription, mais nécessaire pour confirmer vos commandes.</p>
            </div>
          </div>
          <Input label="IBAN / RIB" placeholder="FR76 3000 4028 0000 0000 0000 000" icon="🏦" value={rib} onChange={e=>setRib(e.target.value.toUpperCase())} />
          <Input label="Adresse email *" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
          <div style={{ position:"relative" }}>
            <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{showPass?"Cacher":"Voir"}</button>
          </div>
          <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", lineHeight:1.6 }}>
            En créant un compte vous acceptez nos <span style={{ color:accentColor, cursor:"pointer" }}>CGU</span> et notre <span style={{ color:accentColor, cursor:"pointer" }}>Politique de confidentialité</span>
          </p>
        </>}
      </div>

      <div style={{ padding:"16px 24px 40px", display:"flex", gap:10 }}>
        {step > 1 && <Btn variant="ghost" onClick={()=>{setError("");setStep(s=>s-1)}} style={{ flex:1 }}>← Retour</Btn>}
        <Btn onClick={step===TOTAL?handleSubmit:handleNext} disabled={loading} style={{ flex:2, background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, padding:"14px" }}>
          {step===TOTAL ? (loading?"Création…":"Créer mon compte →") : "Continuer →"}
        </Btn>
      </div>
    </div>
  );
}


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
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [typeCompte, setTypeCompte] = useState("particulier");
  const [societeNom, setSocieteNom] = useState("");
  const [kbisNum, setKbisNum] = useState("");
  const [rib, setRib] = useState("");
  const [telephone, setTelephone] = useState("");

  const isClient = role === "client";
  const accentColor = isClient ? C.violet : C.accentGold;
  const emoji = isClient ? "🏢" : "👷";
  const roleLabel = isClient ? "Client" : "Prestataire";

  const handleLogin = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setLoading(false); setError(err.message); return; }

    const { data:{ user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("role,status").eq("id", user.id).single();
    setLoading(false);

    if (!profile?.role || profile.role !== role) {
      setError(`Ce compte est un compte ${profile?.role === "prestataire" ? "Prestataire" : "Client"}. Utilisez l'espace correspondant.`);
      await supabase.auth.signOut();
      return;
    }
    if (!profile?.status || profile.status === "pending") {
      setError("Votre compte est en attente de validation par notre équipe. Vous serez notifié par email.");
      await supabase.auth.signOut();
      return;
    }
    if (profile?.status === "rejected") {
      setError("Votre compte a été refusé. Contactez le support pour plus d'informations.");
      await supabase.auth.signOut();
      return;
    }
    if (stayLoggedIn) {
      localStorage.setItem("alane_stay_logged_in", "1");
      sessionStorage.removeItem("alane_session_active");
    } else {
      sessionStorage.setItem("alane_session_active", "1");
      localStorage.removeItem("alane_stay_logged_in");
    }
    onLogin();
  };

  const handleRegister = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    if (password.length < 6) { setError("Mot de passe minimum 6 caractères"); return; }
    if (!prenom.trim() || !nom.trim()) { setError("Prénom et nom obligatoires"); return; }
    const telClean = telephone.replace(/[\s.\-]/g,"");
    if (!telClean || telClean.length < 10) { setError("Numéro de téléphone obligatoire"); return; }
    if (isClient && typeCompte === "professionnel") {
      if (!societeNom.trim()) { setError("Nom de société obligatoire"); return; }
      if (!kbisNum.trim()) { setError("Numéro KBIS obligatoire"); return; }
    }
    const ribClean = rib.replace(/\s/g,"");
    setLoading(true); setError("");
    const { data, error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { role, prenom, nom, telephone: telClean, type_compte: isClient ? typeCompte : null, societe_nom: societeNom||null, kbis: kbisNum||null, rib: ribClean||null } },
    });
    if (err) {
      setLoading(false);
      if (err.message.includes("already") || err.message.includes("registered")) {
        setError("Un compte existe déjà avec cet email. Connectez-vous à la place.");
      } else {
        setError(err.message);
      }
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role, prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/notify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prenom: prenom.trim(), nom: nom.trim(), email, role }),
      }).catch(() => {});
      await supabase.auth.signOut();
    }
    setLoading(false);
    onRegister();
  };

  if (mode === "register") {
    if (isClient) return <ClientRegisterFlow onRegister={onRegister} onBack={()=>setMode("login")} accentColor={accentColor} />;
    return <PrestaRegisterFlow onRegister={onRegister} onBack={()=>setMode("login")} accentColor={accentColor} />;
  }

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
              {mode==="login" ? "Bon retour 👋" : "Rejoignez ALANE"}
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
              <span style={{ fontWeight:700, color:"#10D98F", fontSize:12 }}>Offre de lancement</span>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {role==="client" ? "Tarif transparent · le prix affiché est le vrai prix de la mission" : "10 missions gratuites · Réservé aux 100 premiers prestataires inscrits"}
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

            <label style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18, cursor:"pointer" }}>
              <div onClick={()=>setStayLoggedIn(!stayLoggedIn)} style={{ width:20, height:20, borderRadius:6, border:`2px solid ${stayLoggedIn?accentColor:C.border}`, background:stayLoggedIn?accentColor:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.15s" }}>
                {stayLoggedIn && <span style={{ color:"#fff", fontSize:12, fontWeight:900, lineHeight:1 }}>✓</span>}
              </div>
              <span onClick={()=>setStayLoggedIn(!stayLoggedIn)} style={{ color:C.textSub, fontSize:13 }}>Rester connecté</span>
            </label>

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
                Vous allez créer un compte <strong style={{ color:C.text }}>{roleLabel} ALANE</strong>.
                {isClient
                  ? " Renseignez vos informations et commencez à réserver en quelques minutes."
                  : " Vous serez guidé à travers les étapes de validation de votre dossier."
                }
              </p>
            </div>

            {/* Prénom / Nom */}
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
              <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
            </div>

            <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(e.target.value)} />

            {/* Type de compte — client seulement */}
            {isClient && (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Type de compte *</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[{id:"particulier",label:"👤 Particulier"},{id:"professionnel",label:"🏢 Professionnel"}].map(t=>(
                    <button key={t.id} onClick={()=>setTypeCompte(t.id)} style={{ flex:1, padding:"11px", borderRadius:r, border:`2px solid ${typeCompte===t.id?accentColor:C.border}`, background:typeCompte===t.id?`${accentColor}20`:"transparent", color:typeCompte===t.id?accentColor:C.textSub, fontWeight:typeCompte===t.id?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Champs professionnel */}
            {isClient && typeCompte === "professionnel" && (
              <>
                <Input label="Nom de société *" placeholder="ACME SARL" icon="🏢" value={societeNom} onChange={e=>setSocieteNom(e.target.value)} />
                <Input label="N° KBIS / SIRET *" placeholder="123 456 789 00010" icon="📄" value={kbisNum} onChange={e=>setKbisNum(e.target.value)} inputMode="numeric" />
              </>
            )}

            <Input label="IBAN / RIB (optionnel)" placeholder="FR76 3000 4028 0000 0000 0000 000" icon="🏦" value={rib} onChange={e=>setRib(e.target.value.toUpperCase())} />
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:-10, marginBottom:14, paddingLeft:4 }}>Requis pour passer des commandes ou accepter des missions</div>

            <Input label="Adresse email *" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ position:"relative" }}>
              <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
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

// ── EN ATTENTE DE VALIDATION ──────────────────────────────────────
function PendingApprovalScreen({ onLogout }) {
  const [userEmail, setUserEmail] = useState("");
  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{ if(data?.user) setUserEmail(data.user.email||""); });
  },[]);

  const steps = [
    { icon:"✅", label:"Inscription reçue",      sub:"Votre dossier a bien été enregistré",          done:true,  active:false },
    { icon:"🔍", label:"Vérification en cours",  sub:"Délai habituel : 24 à 48h ouvrés",            done:false, active:true  },
    { icon:"🎉", label:"Accès accordé",           sub:"Vous recevrez un email de confirmation",      done:false, active:false },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#050E20,#0A1628,#162547)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px", textAlign:"center" }}>
      <div style={{ width:80, height:80, borderRadius:24, background:"rgba(124,111,224,0.15)", border:"2px solid rgba(124,111,224,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, marginBottom:24 }}>⏳</div>
      <h2 style={{ color:"#fff", fontSize:24, fontWeight:800, fontFamily:"'Playfair Display',serif", margin:"0 0 10px" }}>Compte en attente</h2>
      <p style={{ color:"rgba(255,255,255,0.55)", fontSize:14, lineHeight:1.7, maxWidth:300, margin:"0 0 28px" }}>
        Vos informations sont en cours de vérification. Notre équipe reviendra vers vous très rapidement.
      </p>

      {/* Timeline */}
      <div style={{ width:"100%", maxWidth:320, marginBottom:28, textAlign:"left" }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
              <div style={{ width:38, height:38, borderRadius:"50%", background:step.done?"rgba(16,217,143,0.2)":step.active?"rgba(124,111,224,0.2)":"rgba(255,255,255,0.06)", border:`2px solid ${step.done?"#10D98F":step.active?"#7C6FE0":"rgba(255,255,255,0.12)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{step.icon}</div>
              {i < steps.length-1 && <div style={{ width:2, height:26, background:step.done?"rgba(16,217,143,0.35)":"rgba(255,255,255,0.08)", margin:"4px 0" }} />}
            </div>
            <div style={{ paddingTop:9, paddingBottom:i<steps.length-1?0:0 }}>
              <div style={{ color:step.done?"#10D98F":step.active?"#fff":"rgba(255,255,255,0.3)", fontWeight:step.active||step.done?700:400, fontSize:13 }}>{step.label}</div>
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:11, marginTop:1, marginBottom:i<steps.length-1?16:0 }}>{step.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.25)", borderRadius:14, padding:"14px 20px", marginBottom:24, width:"100%", maxWidth:320 }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginBottom:4 }}>Notification envoyée à</div>
        <div style={{ fontSize:14, fontWeight:700, color:"#fff" }}>{userEmail||"votre email"}</div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>Vérifiez vos spams si vous ne recevez rien</div>
      </div>

      <button onClick={onLogout} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.15)", borderRadius:12, padding:"12px 28px", color:"rgba(255,255,255,0.5)", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
        Se déconnecter
      </button>
    </div>
  );
}

// ── RÉGLAGES ──────────────────────────────────────────────────────
function SettingsScreen({ role, onNavigate, onBack, onLogout }) {
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName]   = useState("");
  const [clientMeta, setClientMeta] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [cpAdresse, setCpAdresse]     = useState("");
  const [cpCodePostal, setCpCodePostal] = useState("");
  const [cpVille, setCpVille]         = useState("");
  const [cpVolume, setCpVolume]       = useState("");
  const [cpFrequence, setCpFrequence] = useState("");
  const [cpSaving, setCpSaving]       = useState(false);
  const [cpSaved, setCpSaved]         = useState(false);
  const [editingIdentite, setEditingIdentite] = useState(false);
  const [editPrenom, setEditPrenom]   = useState("");
  const [editNom, setEditNom]         = useState("");
  const [editTelephone, setEditTelephone] = useState("");
  const [identiteSaving, setIdentiteSaving] = useState(false);
  const [identiteSaved, setIdentiteSaved]   = useState(false);

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if(!user) return;
      setUserEmail(user.email||"");
      const m = user.user_metadata || {};
      if(role === "client") {
        setClientMeta(m);
        setCpAdresse(m.adresse||"");
        setCpCodePostal(m.code_postal||"");
        setCpVille(m.ville||"");
        setCpVolume(m.volume_horaire||"");
        setCpFrequence(m.frequence_besoins||"");
      }
      supabase.from("profiles").select("prenom,nom").eq("id",user.id).single()
        .then(({ data:p })=>{ if(p){ setUserName(`${p.prenom||""} ${p.nom||""}`.trim()); setEditPrenom(p.prenom||""); setEditNom(p.nom||""); } });
      setEditTelephone(m.telephone||"");
    });
  },[]);

  const handleSaveClientProfile = async () => {
    setCpSaving(true);
    await supabase.auth.updateUser({ data: {
      adresse: cpAdresse, code_postal: cpCodePostal, ville: cpVille,
      volume_horaire: cpVolume, frequence_besoins: cpFrequence,
    }});
    setCpSaving(false); setCpSaved(true);
    setTimeout(()=>{ setCpSaved(false); setEditingProfile(false); }, 1200);
  };

  const handleSaveIdentite = async () => {
    setIdentiteSaving(true);
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if(uid) {
      await Promise.all([
        supabase.from("profiles").update({ prenom:editPrenom, nom:editNom }).eq("id",uid),
        supabase.auth.updateUser({ data:{ prenom:editPrenom, nom:editNom, telephone:editTelephone } }),
      ]);
      setUserName(`${editPrenom} ${editNom}`.trim());
    }
    setIdentiteSaving(false); setIdentiteSaved(true);
    setTimeout(()=>{ setIdentiteSaved(false); setEditingIdentite(false); }, 1200);
  };

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
        { icon:"📖", label:"FAQ", action:()=>onNavigate("faq"), chevron:true },
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
            <div style={{ color:C.violet, fontSize:11, fontWeight:600, marginTop:4 }}>{role==="prestataire"?"Prestataire":"Client"} ALANE</div>
          </div>
        </div>

        {/* Profil client éditable */}
        {/* Édition identité */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mes informations</div>
            <button onClick={()=>setEditingIdentite(!editingIdentite)} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{editingIdentite?"Annuler":"✏️ Modifier"}</button>
          </div>
          {!editingIdentite ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>👤</span><span style={{ color:C.textSub, fontSize:13 }}>{userName||"—"}</span></div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>✉️</span><span style={{ color:C.textSub, fontSize:13 }}>{userEmail||"—"}</span></div>
              {editTelephone && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>📱</span><span style={{ color:C.textSub, fontSize:13 }}>{editTelephone}</span></div>}
            </div>
          ) : (
            <div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}><Input label="Prénom" placeholder="Prénom" icon="👤" value={editPrenom} onChange={e=>setEditPrenom(e.target.value)} /></div>
                <div style={{ flex:1 }}><Input label="Nom" placeholder="Nom" value={editNom} onChange={e=>setEditNom(e.target.value)} /></div>
              </div>
              <Input label="Téléphone" placeholder="06 12 34 56 78" icon="📱" value={editTelephone} onChange={e=>setEditTelephone(e.target.value)} />
              <Btn full onClick={handleSaveIdentite} disabled={identiteSaving} style={{ background:C.violet, padding:"13px" }}>
                {identiteSaving?"Enregistrement…":identiteSaved?"✅ Sauvegardé !":"Enregistrer"}
              </Btn>
            </div>
          )}
        </div>

        {role === "client" && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mon profil client</div>
              <button onClick={()=>setEditingProfile(!editingProfile)} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{editingProfile?"Annuler":"✏️ Modifier"}</button>
            </div>
            {!editingProfile ? (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {clientMeta?.adresse && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>📍</span><span style={{ color:C.textSub, fontSize:13 }}>{clientMeta.adresse}, {clientMeta.code_postal} {clientMeta.ville}</span></div>}
                {clientMeta?.frequence_besoins && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>🔄</span><span style={{ color:C.textSub, fontSize:13, textTransform:"capitalize" }}>{clientMeta.frequence_besoins}</span></div>}
                {clientMeta?.volume_horaire && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>⏱️</span><span style={{ color:C.textSub, fontSize:13 }}>{clientMeta.volume_horaire} / semaine</span></div>}
                {clientMeta?.secteurs_besoins?.length > 0 && <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>{clientMeta.secteurs_besoins.map(sid=>{ const s=SECTORS.find(x=>x.id===sid); return s?<span key={sid} style={{ background:`${s.color}20`, border:`1px solid ${s.color}44`, borderRadius:6, padding:"2px 8px", color:s.color, fontSize:11, fontWeight:600 }}>{s.icon} {s.label}</span>:null; })}</div>}
                {!clientMeta?.adresse && !clientMeta?.frequence_besoins && <div style={{ color:C.textSub, fontSize:12 }}>Aucune information de profil renseignée.</div>}
              </div>
            ) : (
              <div>
                <Input label="Adresse" placeholder="12 rue de la Paix" icon="📍" value={cpAdresse} onChange={e=>setCpAdresse(e.target.value)} />
                <div style={{ display:"flex", gap:10 }}>
                  <div style={{ flex:1 }}><Input label="Code postal" placeholder="75001" value={cpCodePostal} onChange={e=>setCpCodePostal(e.target.value)} /></div>
                  <div style={{ flex:2 }}><Input label="Ville" placeholder="Paris" value={cpVille} onChange={e=>setCpVille(e.target.value)} /></div>
                </div>
                <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Fréquence des besoins</label>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {[{id:"ponctuel",label:"⚡ Ponctuel"},{id:"regulier",label:"📅 Régulier"},{id:"les-deux",label:"🔄 Les deux"}].map(f=>(
                    <button key={f.id} onClick={()=>setCpFrequence(f.id)} style={{ flex:1, padding:"9px 6px", borderRadius:r, border:`2px solid ${cpFrequence===f.id?C.violet:C.border}`, background:cpFrequence===f.id?`${C.violet}20`:"transparent", color:cpFrequence===f.id?C.violet:C.textSub, fontSize:11, fontWeight:cpFrequence===f.id?700:400, cursor:"pointer", fontFamily:"inherit" }}>{f.label}</button>
                  ))}
                </div>
                <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Volume horaire estimé</label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                  {[{id:"<8h",l:"< 8h"},{id:"8-20h",l:"8–20h"},{id:"20-40h",l:"20–40h"},{id:">40h",l:"> 40h"}].map(v=>(
                    <button key={v.id} onClick={()=>setCpVolume(v.id)} style={{ padding:"9px", borderRadius:r, border:`2px solid ${cpVolume===v.id?C.violet:C.border}`, background:cpVolume===v.id?`${C.violet}20`:"transparent", color:cpVolume===v.id?C.violet:C.textSub, fontSize:12, fontWeight:cpVolume===v.id?700:400, cursor:"pointer", fontFamily:"inherit" }}>{v.l}</button>
                  ))}
                </div>
                <Btn full onClick={handleSaveClientProfile} disabled={cpSaving} style={{ background:C.violet, padding:"13px" }}>
                  {cpSaving?"Enregistrement…":cpSaved?"✅ Sauvegardé !":"Enregistrer"}
                </Btn>
              </div>
            )}
          </div>
        )}

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

        <p style={{ textAlign:"center", color:C.textMuted, fontSize:11, marginTop:20 }}>ALANE v1.0 · Tous droits réservés</p>
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
const TOUR_STEPS = [
  {
    icon:"👋",
    title:"Bienvenue sur ALANE !",
    desc:"ALANE vous met en relation avec des prestataires qualifiés dans de nombreux secteurs. Voici comment ça marche en 4 étapes.",
    color:"#7C6FE0",
  },
  {
    icon:"🗂️",
    title:"1. Trouvez votre prestataire",
    desc:"Parcourez les secteurs (Logistique, BTP, Restauration…), filtrez par disponibilité, tarif ou note, et consultez les profils.",
    color:"#4FC3F7",
  },
  {
    icon:"📅",
    title:"2. Réservez & payez",
    desc:"Choisissez la date, la durée et confirmez. Le paiement est sécurisé en escrow — vous n'êtes pas débité tant que la mission n'est pas validée.",
    color:"#F0B429",
  },
  {
    icon:"⏳",
    title:"3. Le prestataire confirme",
    desc:"Il dispose d'un délai (1h si c'est aujourd'hui, 4h sinon) pour accepter ou refuser. Vous êtes notifié immédiatement de sa réponse.",
    color:"#81C784",
  },
  {
    icon:"✅",
    title:"4. Validez la mission",
    desc:"Une fois la mission terminée, validez-la depuis votre espace. Les fonds sont libérés au prestataire et vous gagnez du cashback !",
    color:"#F06292",
  },
];

function ClientTour({ onDone }) {
  const [step, setStep] = useState(0);
  const s = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(5,14,32,0.92)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 28px" }}>
      <div style={{ width:"100%", maxWidth:360, background:"#0D1B3E", borderRadius:24, overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
        {/* Progress dots */}
        <div style={{ display:"flex", gap:6, justifyContent:"center", padding:"18px 0 0" }}>
          {TOUR_STEPS.map((_,i) => (
            <div key={i} style={{ width:i===step?22:7, height:7, borderRadius:4, background:i===step?s.color:"rgba(255,255,255,0.15)", transition:"all 0.3s" }} />
          ))}
        </div>
        {/* Icon */}
        <div style={{ textAlign:"center", padding:"24px 28px 0" }}>
          <div style={{ width:84, height:84, borderRadius:"50%", background:s.color+"20", border:`2px solid ${s.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>{s.icon}</div>
          <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 12px", fontFamily:font.display, lineHeight:1.2 }}>{s.title}</h2>
          <p style={{ color:"rgba(255,255,255,0.65)", fontSize:14, lineHeight:1.7, margin:0 }}>{s.desc}</p>
        </div>
        {/* Actions */}
        <div style={{ padding:"24px 28px 28px", display:"flex", gap:10 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"13px", border:"1px solid rgba(255,255,255,0.15)", borderRadius:14, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>← Précédent</button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(s=>s+1); }} style={{ flex:2, padding:"13px", border:"none", borderRadius:14, background:s.color, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            {isLast ? "C'est parti ! 🚀" : "Suivant →"}
          </button>
        </div>
        {/* Skip */}
        {!isLast && (
          <button onClick={onDone} style={{ display:"block", width:"100%", padding:"0 0 18px", background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Passer</button>
        )}
      </div>
    </div>
  );
}

function HomeScreen({ onNavigate, notifCount=0 }) {
  const [urgentMode, setUrgentMode] = useState(false);
  const [userName, setUserName] = useState("");
  const [walletMissions, setWalletMissions] = useState(0);
  const [walletBalance,  setWalletBalance]  = useState(0);
  const [showTour, setShowTour] = useState(false);
  const { isDesktop } = useResponsive();
  const { providers, loading: providersLoading } = useProviders();
  const tier = getCashbackTier(walletMissions);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - walletMissions : 0;
  const tierProgress = nextTier
    ? Math.min(100, Math.max(8, (walletMissions / nextTier.min) * 100))
    : 8;

  useEffect(()=>{
    let mounted = true;
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if (!user || !mounted) return;
      const tourKey = `alane_tour_done_${user.id}`;
      if (!localStorage.getItem(tourKey)) setShowTour(true);
      supabase.from("profiles").select("prenom,cashback_balance,missions_completed_month").eq("id", user.id).single()
        .then(({ data: p }) => {
          if (!p || !mounted) return;
          if (p.prenom) setUserName(p.prenom);
          setWalletBalance(p.cashback_balance || 0);
          setWalletMissions(p.missions_completed_month || 0);
        });
    });
    return ()=>{ mounted=false; };
  }, []);

  const violetLite = "#A29BFE";

  const dismissTour = async () => {
    setShowTour(false);
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (user) localStorage.setItem(`alane_tour_done_${user.id}`, "1");
  };

  return (
    <div style={{
      minHeight:"100%",
      background:`radial-gradient(120% 80% at 50% -10%, ${C.bgCard} 0%, ${C.bg} 55%, #06101F 100%)`,
      paddingBottom:90,
      position:"relative",
      overflow:"hidden",
    }}>
      {showTour && <ClientTour onDone={dismissTour} />}
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
          }}>{userName?.charAt(0)?.toUpperCase()||"A"}</div>
          <div>
            <div style={{ fontSize:11, color:C.textMuted, letterSpacing:0.4, lineHeight:1.2 }}>Bonjour 👋</div>
            <div style={{ fontSize:14, fontWeight:600, color:C.text, lineHeight:1.2 }}>{userName || "Mon espace"}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>onNavigate("notifications")} style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, cursor:"pointer", position:"relative", color:C.text }}>
            🔔
            {notifCount > 0 && (
              <div style={{ position:"absolute", top:-4, right:-4, background:"#E74C3C", borderRadius:"50%", minWidth:18, height:18, fontSize:10, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px", lineHeight:1 }}>{notifCount > 9 ? "9+" : notifCount}</div>
            )}
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
          {providers.length > 0
            ? <>Plus de {providers.length} prestataire{providers.length > 1 ? "s" : ""} vérifié{providers.length > 1 ? "s" : ""}, prêt{providers.length > 1 ? "s" : ""} à intervenir.</>
            : <>Rejoignez la plateforme ALANE et accédez aux meilleurs prestataires.</>}
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
              {walletBalance.toFixed(2).replace(".", ",")}
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
              <div style={{ fontSize:9, color:C.textMuted, marginTop:2, position:"relative" }}>{providers.filter(p=>p.sector===s.id).length} pros</div>
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
          {providersLoading ? (
            <div style={{ background:`${C.bgCard}`, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 16px", textAlign:"center" }}>
              <div style={{ color:C.textMuted, fontSize:13 }}>Chargement…</div>
            </div>
          ) : providers.filter(p=>p.available).length === 0 ? (
            <div style={{ background:`linear-gradient(135deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 20px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>👷</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:6 }}>Bientôt disponible</div>
              <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5 }}>Les premiers prestataires ALANE arrivent très prochainement.</div>
            </div>
          ) : (
            providers.filter(p=>p.available).slice(0,3).map((p,i)=>(
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
                  <div style={{ fontSize:11.5, color:C.textSub, marginBottom:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.jobTitle}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:C.textMuted }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                      <Stars rating={p.rating} size={10}/>
                      <span style={{ color:C.text, fontWeight:600 }}>{p.rating || "—"}</span>
                    </span>
                    {p.code_postal && <><span>·</span><span>📍 {p.code_postal}</span></>}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontFamily:font.display, fontWeight:700, fontSize:15, color:violetLite, lineHeight:1 }}>{p.hourlyRate}</div>
                  <div style={{ fontSize:10, color:C.textMuted, marginTop:4 }}>HT/h</div>
                </div>
              </div>
            ))
          )}
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
              Parrainez & gagnez <span style={{ color:C.accentGold }}>1 mois Premium</span>
            </div>
            <div style={{ fontSize:11.5, color:C.textSub }}>3 filleuls abonnés = 1 mois offert</div>
          </div>
          <span style={{ color:C.accentGold, fontSize:18 }}>›</span>
        </div>
      </div>
    </div>
  );
}


// ── CATALOGUE style Uber Eats ─────────────────────────────────────
function CatalogueScreen({ onNavigate, realProviders=[] }) {
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
          const sectorProviders = realProviders.filter(p=>p.sector===sector.id);
          return (
            <div key={sector.id} ref={el=>sectorRefs.current[sector.id]=el} style={{ marginBottom:8 }}>
              {/* Bannière secteur cliquable uniquement */}
              <div style={{ margin:"0 18px 14px", background:`linear-gradient(135deg,${sector.color}44,${sector.color}22)`, borderRadius:18, padding:"20px 18px", position:"relative", overflow:"hidden", cursor:"pointer" }} onClick={()=>onNavigate("sector_detail",sector)}>
                <div style={{ position:"absolute", right:-10, top:-10, fontSize:64, opacity:0.25 }}>{sector.banner}</div>
                <div style={{ position:"absolute", right:14, bottom:14, fontSize:36 }}>{sector.icon}</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:18 }}>{sector.label}</div>
                <div style={{ color:C.textSub, fontSize:13, marginTop:4 }}>{sectorProviders.length} prestataires · {sectorProviders.filter(p=>p.available).length} disponibles maintenant</div>
                <div style={{ marginTop:10 }}><Badge color={sector.color} small>Voir tous les prestataires →</Badge></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── HOOK : vrais prestataires depuis Supabase ─────────────────────
let _providersCache = null;
let _providersCachePromise = null;

function useProviders() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  useEffect(() => {
    if (_providersCache) { setProviders(_providersCache); setLoading(false); return; }
    if (!_providersCachePromise) {
      _providersCachePromise = fetch("/api/prestataires")
        .then(r => r.json())
        .then(({ prestataires = [] }) => {
          const mapped = prestataires.map(p => {
            const sectorInfo = SECTORS.find(s => s.id === p.secteur);
            const rateNum    = prixClient(p.tarif_net || 12, p.secteur || "divers");
            return {
              id:           p.id,
              name:         p.name,
              prenom:       p.prenom,
              nom:          p.nom,
              sector:       p.secteur,
              jobTitle:     p.metier,
              rateNum,
              hourlyRate:   `${rateNum.toFixed(2).replace(".", ",")} € HT/h`,
              available:    p.dispo_immediat !== false,
              dispon_jours: p.dispon_jours || [],
              code_postal:  p.code_postal,
              rating:       0,
              reviews:      0,
              distance:     "—",
              responseTime: "—",
              avatar:       sectorInfo?.icon || "👷",
              color:        sectorInfo?.color || "#7C6FE0",
              niveau:       p.niveau,
            };
          });
          _providersCache = mapped;
          return mapped;
        })
        .catch(() => { _providersCachePromise = null; return []; });
    }
    _providersCachePromise.then(mapped => { setProviders(mapped); setLoading(false); });
  }, []);
  return { providers, loading };
}

// ── SECTOR DETAIL ─────────────────────────────────────────────────
function SectorDetailScreen({ sector, onNavigate, clientCoords, realProviders=[] }) {
  const s = sector || SECTORS[0];
  const [selectedJob, setSelectedJob] = useState(null);
  const [urgentMode, setUrgentMode] = useState(false);
  const [filterDispo, setFilterDispo] = useState(false);
  const [filterTarifMax, setFilterTarifMax] = useState(50);
  const [filterNoteMin, setFilterNoteMin] = useState(0);
  const [sortBy, setSortBy] = useState("rating");
  const filterKey = `alane_filters_${s.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(filterKey)||"{}");
      if(saved.selectedJob!==undefined) setSelectedJob(saved.selectedJob);
      if(saved.filterDispo!==undefined) setFilterDispo(saved.filterDispo);
      if(saved.filterTarifMax!==undefined) setFilterTarifMax(saved.filterTarifMax);
      if(saved.filterNoteMin!==undefined) setFilterNoteMin(saved.filterNoteMin);
      if(saved.sortBy!==undefined) setSortBy(saved.sortBy);
    } catch(_) {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(filterKey, JSON.stringify({ selectedJob, filterDispo, filterTarifMax, filterNoteMin, sortBy }));
    } catch(_) {}
  }, [selectedJob, filterDispo, filterTarifMax, filterNoteMin, sortBy]);
  const [showFilters, setShowFilters] = useState(false);
  const [missionDate, setMissionDate] = useState("");
  const SURCHARGE = 2;
  const DAY_NAMES = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const selectedDay = missionDate ? DAY_NAMES[new Date(missionDate).getDay()] : null;
  const { providers } = useProviders();

  const allServices = (METIERS[s.id]||[]).map(name => {
    const count = providers.filter(p=>p.sector===s.id && p.jobTitle===name).length;
    const availCount = providers.filter(p=>p.sector===s.id && p.jobTitle===name && p.available).length;
    const tarif = METIERS_TARIFS[s.id]?.[name];
    const base = tarif ? prixClient(tarif.default, s.id) : 12;
    const price = urgentMode ? base + SURCHARGE : base;
    return { name, rate:`${price.toFixed(2).replace(".",",")} € HT/h`, count, availCount, base, price };
  });

  const filteredProviders = providers
    .filter(p => p.sector===s.id && (!selectedJob || p.jobTitle===selectedJob))
    .filter(p => !filterDispo || p.available)
    .filter(p => !selectedDay || (p.dispon_jours||[]).includes(selectedDay))
    .filter(p => p.rateNum <= filterTarifMax)
    .filter(p => p.rating >= filterNoteMin)
    .sort((a,b) => {
      if(sortBy==="tarif")    return a.rateNum - b.rateNum;
      if(sortBy==="distance") return parseFloat(a.distance||"9") - parseFloat(b.distance||"9");
      return b.rating - a.rating;
    });

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
          <div onClick={()=>{ setSelectedJob(null); setUrgentMode(false); setShowFilters(false); }} style={{ display:"flex", alignItems:"center", gap:6, color:C.violet, fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:14 }}>
            ← Tous les métiers
          </div>

          {/* Barre filtres */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:showFilters?12:0 }}>
              <button onClick={()=>setShowFilters(!showFilters)} style={{ flex:1, padding:"10px 14px", borderRadius:r, border:`1.5px solid ${showFilters?s.color:C.border}`, background:showFilters?`${s.color}20`:"rgba(255,255,255,0.04)", color:showFilters?s.color:C.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, transition:"all 0.2s" }}>
                🎛️ Filtres {filterDispo||filterNoteMin>0||filterTarifMax<50?<span style={{ background:s.color, color:"#fff", borderRadius:"50%", width:16, height:16, fontSize:10, display:"inline-flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>!</span>:null}
              </button>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ flex:1, padding:"10px 10px", borderRadius:r, border:`1.5px solid ${C.border}`, background:"rgba(255,255,255,0.04)", color:C.text, fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>
                <option value="rating">⭐ Par note</option>
                <option value="tarif">💶 Par tarif</option>
                <option value="distance">📍 Par distance</option>
              </select>
            </div>
            {showFilters && (
              <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px" }}>
                <div style={{ marginBottom:14 }}>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:6, fontWeight:600 }}>Date de la mission</div>
                  <input type="date" value={missionDate} onChange={e=>setMissionDate(e.target.value)} min={new Date().toISOString().slice(0,10)}
                    style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  {selectedDay && <div style={{ color:s.color, fontSize:11, fontWeight:700, marginTop:4 }}>📅 {selectedDay} — uniquement les prestataires disponibles ce jour</div>}
                </div>
                <div onClick={()=>setFilterDispo(!filterDispo)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, cursor:"pointer" }}>
                  <span style={{ color:C.text, fontSize:13, fontWeight:600 }}>Disponible maintenant uniquement</span>
                  <div style={{ width:40, height:22, borderRadius:11, background:filterDispo?s.color:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                    <div style={{ position:"absolute", top:2, left:filterDispo?20:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:6 }}>Tarif max : <strong style={{ color:s.color }}>{filterTarifMax === 50 ? "Tous" : `${filterTarifMax} €/h`}</strong></div>
                  <input type="range" min={10} max={50} step={1} value={filterTarifMax} onChange={e=>setFilterTarifMax(Number(e.target.value))} style={{ width:"100%", accentColor:s.color }} />
                  <div style={{ display:"flex", justifyContent:"space-between", color:C.textMuted, fontSize:10, marginTop:2 }}><span>10 €/h</span><span>50 €/h</span></div>
                </div>
                <div>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:8 }}>Note minimum</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {[0,3,4,4.5].map(n=>(
                      <button key={n} onClick={()=>setFilterNoteMin(n)} style={{ flex:1, padding:"7px 4px", borderRadius:8, border:`1.5px solid ${filterNoteMin===n?s.color:C.border}`, background:filterNoteMin===n?`${s.color}20`:"transparent", color:filterNoteMin===n?s.color:C.textSub, fontSize:11, fontWeight:filterNoteMin===n?700:400, cursor:"pointer", fontFamily:"inherit" }}>
                        {n===0?"Tous":`${n}★+`}
                      </button>
                    ))}
                  </div>
                </div>
                {(filterDispo||filterNoteMin>0||filterTarifMax<50||missionDate) && (
                  <button onClick={()=>{ setFilterDispo(false); setFilterNoteMin(0); setFilterTarifMax(50); setMissionDate(""); }} style={{ width:"100%", marginTop:12, padding:"8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Réinitialiser les filtres</button>
                )}
              </div>
            )}
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
                          <span style={{ color:C.textSub, fontSize:11 }}>{(()=>{ if(clientCoords && p.code_postal){ const coords=cpToCoords(p.code_postal); if(coords){ const km=haversineKm(clientCoords.lat,clientCoords.lng,coords[0],coords[1]); return `🚗 ${travelTimeStr(km)} · ${km} km`; } } return p.distance||"—"; })()}</span>
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
  const p = provider;
  if (!p) return null;
  const cv = CV_DATA[p.id];

  if(!cv) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:16 }}>📄</div>
      <h3 style={{ color:C.text, fontSize:18, fontWeight:700, margin:"0 0 10px", fontFamily:font.display }}>CV non disponible</h3>
      <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:260, margin:"0 auto 28px" }}>
        {p.name} n'a pas encore renseigné son CV sur ALANE.
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
  const p = provider;
  if (!p) return null;
  const [fav,setFav]=useState(false);
  const [userId,setUserId]=useState(null);
  const cv = CV_DATA[p.id];
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid=data?.user?.id;
      if(!uid) return;
      setUserId(uid);
      const favs=JSON.parse(localStorage.getItem(`alane_favs_${uid}`)||"[]");
      setFav(favs.includes(p.id));
    });
  },[p.id]);
  const toggleFav=()=>{
    if(!userId) return;
    const key=`alane_favs_${userId}`;
    const favs=JSON.parse(localStorage.getItem(key)||"[]");
    const next=fav?favs.filter(id=>id!==p.id):[...favs,p.id];
    localStorage.setItem(key,JSON.stringify(next));
    setFav(!fav);
  };
  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg, #0A1628, ${p.color}99)`, padding:"48px 22px 36px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
          <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>
          <button onClick={toggleFav} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", cursor:"pointer", fontSize:18 }}>{fav?"❤️":"🤍"}</button>
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
  const p = provider;
  if (!p) return null;
  const isUrgent = p.urgentMode || false;
  const urgentPrice = p.urgentPrice || null;
  const [step,setStep]=useState(1);
  const [userRib,setUserRib]=useState(null);
  const [ribError,setRibError]=useState(false);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{ setUserRib(data?.user?.user_metadata?.rib||null); });
  },[]);
  const [payMethod,setPayMethod]=useState("carte");
  const [hours,setHours]=useState(isUrgent ? 4 : 8);
  const [missionType, setMissionType] = useState("single");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [description, setDescription] = useState("");
  const [breakMin, setBreakMin] = useState(isUrgent ? 0 : 20); // 20min par défaut car hours=8 au démarrage
  const [cvOpen, setCvOpen] = useState(false);

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
      {/* Overlay CV */}
      {cvOpen && (() => {
        const cv = CV_DATA[p.id];
        return (
          <div style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(5,14,32,0.96)", overflowY:"auto", paddingBottom:40 }}>
            <div style={{ background:`linear-gradient(135deg,${p.color}55,${p.color}22)`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", top:-40, right:-40, width:200, height:200, borderRadius:"50%", background:`${p.color}15`, pointerEvents:"none" }} />
              <button onClick={()=>setCvOpen(false)} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:"#fff", cursor:"pointer", fontSize:13, marginBottom:18 }}>← Retour à la réservation</button>
              <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
                <div style={{ width:60, height:60, borderRadius:18, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, border:"2px solid rgba(255,255,255,0.2)" }}>{p.avatar}</div>
                <div>
                  <h2 style={{ color:"#fff", fontSize:20, fontWeight:700, margin:"0 0 3px", fontFamily:font.display }}>{p.name}</h2>
                  <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{cv ? cv.titre : p.jobTitle||p.role}</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Badge color="rgba(255,255,255,0.9)" small>⭐ {p.rating}/5</Badge>
                <Badge color="rgba(255,255,255,0.9)" small>📋 {p.missions} missions</Badge>
                <Badge color="rgba(255,255,255,0.9)" small>🕐 {p.experience}</Badge>
              </div>
            </div>
            <div style={{ padding:"20px 18px" }}>
              {!cv ? (
                <div style={{ textAlign:"center", padding:"40px 20px", color:C.textSub, fontSize:14, lineHeight:1.7 }}>
                  <div style={{ fontSize:50, marginBottom:14 }}>📄</div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:16, marginBottom:8 }}>CV en cours de rédaction</div>
                  {p.name} n'a pas encore renseigné son CV complet.<br/>Consultez son profil et ses avis pour vous décider.
                </div>
              ) : (<>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>👤</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Profil</span>
                  </div>
                  <p style={{ color:C.textSub, fontSize:13, lineHeight:1.7, margin:0 }}>{cv.accroche}</p>
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>💼</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Expériences</span>
                  </div>
                  {cv.experiences.map((e,i)=>(
                    <div key={i} style={{ paddingBottom:i<cv.experiences.length-1?16:0, marginBottom:i<cv.experiences.length-1?16:0, borderBottom:i<cv.experiences.length-1?`1px solid ${C.border}`:"none", paddingLeft:18, position:"relative" }}>
                      <div style={{ position:"absolute", left:0, top:4, width:8, height:8, borderRadius:"50%", background:C.violet }} />
                      <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{e.poste}</div>
                      <div style={{ color:p.color, fontSize:12, margin:"2px 0" }}>{e.entreprise} · {e.periode}</div>
                      <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{e.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🎓</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Formations</span>
                  </div>
                  {cv.formations.map((f,i)=>(
                    <div key={i} style={{ marginBottom:i<cv.formations.length-1?10:0, paddingBottom:i<cv.formations.length-1?10:0, borderBottom:i<cv.formations.length-1?`1px solid ${C.border}`:"none" }}>
                      <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>{f.diplome}</div>
                      <div style={{ color:C.textSub, fontSize:12 }}>{f.etablissement} · {f.annee}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", display:"flex", gap:16, flexWrap:"wrap" }}>
                  {cv.langues?.length > 0 && <div><div style={{ color:C.textSub, fontSize:11, fontWeight:600, marginBottom:4 }}>LANGUES</div>{cv.langues.map((l,i)=><div key={i} style={{ color:C.text, fontSize:13 }}>🌐 {l}</div>)}</div>}
                  {cv.permis && <div><div style={{ color:C.textSub, fontSize:11, fontWeight:600, marginBottom:4 }}>PERMIS</div><div style={{ color:C.text, fontSize:13 }}>🚗 {cv.permis}</div></div>}
                </div>
                <div style={{ marginTop:14 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {p.skills?.map((s,i)=><Badge key={i} color={p.color} small>{s}</Badge>)}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        );
      })()}

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

          {/* Bouton CV */}
          <button onClick={()=>setCvOpen(true)} style={{ width:"100%", background:`${p.color}14`, border:`1px solid ${p.color}44`, borderRadius:12, padding:"11px 16px", marginBottom:14, color:p.color, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <span>📄</span> Consulter le CV de {p.name}
          </button>

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
          {ribError && (
            <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:13, color:"#F25E5E", lineHeight:1.6 }}>
              🏦 <strong>IBAN / RIB manquant</strong><br/>Ajoutez votre IBAN dans vos réglages pour passer une commande.
            </div>
          )}
          <Btn full onClick={()=>{ if(!userRib){ setRibError(true); return; } onNavigate("stripe_pay",{ amount: totalGlobal, hours, date: startDate||"" }); }} style={{ background: isUrgent?C.accent:undefined }}>
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
function MissionPendingScreen({ provider, amount, hours, missionId, onAccepted, onCancelled, onBack }) {
  const p = provider || PROVIDERS[0];
  const { providers: allProviders } = useProviders();
  const [secsLeft, setSecsLeft]     = useState(3600);
  const [totalSecs, setTotalSecs]   = useState(3600);
  const [phase, setPhase]           = useState("waiting");
  const [loaded, setLoaded]         = useState(!missionId);
  const [clientId, setClientId]     = useState(null);

  // Charger le délai réel depuis Supabase
  useEffect(() => {
    if (!missionId) { setLoaded(true); return; }
    let mounted = true;
    supabase.from("missions").select("status,acceptance_deadline,client_id").eq("id", missionId).single()
      .then(({ data }) => {
        if (!mounted || !data) return;
        if (data.status === "assigned") { setPhase("accepted"); return; }
        if (data.status === "refused")  { setPhase("refused");  return; }
        setClientId(data.client_id || null);
        if (data.acceptance_deadline) {
          const secs = Math.max(0, Math.floor((new Date(data.acceptance_deadline).getTime() - Date.now()) / 1000));
          setSecsLeft(secs);
          setTotalSecs(secs > 0 ? secs : 3600);
        }
        setLoaded(true);
      });
    return () => { mounted = false; };
  }, [missionId]);

  // Polling toutes les 5s pour détecter la réponse du prestataire
  useEffect(() => {
    if (!missionId || phase !== "waiting") return;
    let mounted = true;
    const poll = async () => {
      const { data } = await supabase.from("missions").select("status").eq("id", missionId).single();
      if (!mounted || !data) return;
      if (data.status === "assigned") setPhase("accepted");
      else if (data.status === "refused") setPhase("refused");
    };
    const interval = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, [missionId, phase]);

  // Compte à rebours
  useEffect(() => {
    if (!loaded || phase !== "waiting") return;
    const t = setInterval(() => {
      setSecsLeft(s => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [loaded, phase]);

  // Timeout : refus automatique
  useEffect(() => {
    if (!loaded || secsLeft !== 0 || phase !== "waiting") return;
    setPhase("timeout");
    if (missionId) {
      supabase.from("missions").update({ status: "refused" }).eq("id", missionId).then(()=>{});
      if (clientId) {
        supabase.from("notifications").insert({
          user_id: clientId, type: "mission_refused",
          title: "Mission non confirmée",
          message: `${p.name} n'a pas répondu dans le délai imparti. Choisissez un autre prestataire.`,
        }).then(()=>{});
      }
    }
  }, [loaded, secsLeft, phase, missionId, clientId]);


  const formatTimer = (secs) => {
    if (secs <= 0) return "0s";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return h + "h " + String(m).padStart(2,"0") + "min";
    if (m > 0) return String(m).padStart(2,"0") + "min " + String(s).padStart(2,"0") + "s";
    return String(s).padStart(2,"0") + "s";
  };

  const pct = totalSecs > 0 ? Math.round((secsLeft / totalSecs) * 100) : 0;
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
        {(()=>{
          const alts = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0,3);
          if(alts.length===0) return null;
          return (
            <div style={{ marginBottom:24, textAlign:"left" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:10 }}>Disponibles dans ce secteur :</div>
              {alts.map(alt=>(
                <div key={alt.id} style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:24 }}>{alt.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{alt.name}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{alt.jobTitle} · {alt.hourlyRate}</div>
                  </div>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:C.success }} />
                </div>
              ))}
            </div>
          );
        })()}
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
        {(()=>{
          const alts = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0,3);
          if(alts.length===0) return null;
          return (
            <div style={{ marginBottom:24, textAlign:"left" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:10 }}>Disponibles dans ce secteur :</div>
              {alts.map(alt=>(
                <div key={alt.id} style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:24 }}>{alt.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{alt.name}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{alt.jobTitle} · {alt.hourlyRate}</div>
                  </div>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:C.success }} />
                </div>
              ))}
            </div>
          );
        })()}
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

function TrackingScreen({ provider, missionId, onNavigate }) {
  const p = provider;
  if (!p) return null;
  const [timelineStatus, setTimelineStatus] = useState("enroute");
  const [eta, setEta] = useState(8);
  const statusMap = ["enroute","enroute","in_progress","done"];
  const [step, setStep] = useState(0);

  // Charger le statut réel depuis Supabase si missionId disponible
  useEffect(()=>{
    if(!missionId) return;
    let mounted = true;
    supabase.from("missions").select("status").eq("id",missionId).single().then(({data})=>{
      if(!mounted || !data) return;
      if(data.status==="in_progress"){ setStep(2); setTimelineStatus("in_progress"); setEta(0); }
      else if(data.status==="completed"){ setStep(3); setTimelineStatus("done"); setEta(0); }
    });
    return ()=>{ mounted=false; };
  },[missionId]);

  // Simulation visuelle (progress auto toutes les 4s)
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

        {/* Codes de présence — communiquer au prestataire sur place */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:16 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:14 }}>🔐 Codes de présence</div>
          <p style={{ color:C.textSub, fontSize:12, margin:"0 0 14px", lineHeight:1.6 }}>Communiquez ces codes au prestataire uniquement lorsqu'il est physiquement sur place.</p>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, background:`${C.success}12`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px", textAlign:"center" }}>
              <div style={{ color:C.textSub, fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Arrivée</div>
              <div style={{ fontSize:28, fontWeight:900, color:C.success, letterSpacing:6, fontFamily:"monospace" }}>{genMissionCode(p.id,"in")}</div>
            </div>
            <div style={{ flex:1, background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}44`, borderRadius:r, padding:"14px", textAlign:"center" }}>
              <div style={{ color:C.textSub, fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Départ</div>
              <div style={{ fontSize:28, fontWeight:900, color:C.accentGold, letterSpacing:6, fontFamily:"monospace" }}>{genMissionCode(p.id,"out")}</div>
            </div>
          </div>
          <div style={{ marginTop:10, background:"rgba(255,165,0,0.08)", border:"1px solid rgba(255,165,0,0.25)", borderRadius:8, padding:"8px 12px", fontSize:11, color:"#FFA500" }}>
            ⚠️ Ces codes changent chaque jour. Ne les partagez qu'en présence du prestataire.
          </div>
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
function ValidationScreen({ provider, role, missionId, onNavigate }) {
  const p = provider;
  if (!p) return null;
  const [clientValidated,setClientValidated]=useState(false);
  const [prestaValidated,setPrestaValidated]=useState(false);
  const [clientRating,setClientRating]=useState(0);
  const [prestaRating,setPrestaRating]=useState(0);
  const [clientComment,setClientComment]=useState("");
  const [prestaComment,setPrestaComment]=useState("");
  const [hoursActual,setHoursActual]=useState(8);
  const [dispute,setDispute]=useState(false);
  const [disputeMsg,setDisputeMsg]=useState("");
  const [disputeSending,setDisputeSending]=useState(false);
  const [disputeDone,setDisputeDone]=useState(false);
  const [paid,setPaid]=useState(false);

  const bothValidated = clientValidated && prestaValidated;
  const totalClientPrice = (p.rateNum * hoursActual).toFixed(0);
  const totalNetPresta   = (p.tarifNet * hoursActual).toFixed(0);

  const persistValidation = async (side, rating, comment) => {
    if (!missionId) return;
    const patch = side === "client"
      ? { validation_client: true, client_rating: rating, client_comment: comment }
      : { validation_prestataire: true, presta_rating: rating, presta_comment: comment };
    await supabase.from("missions").update(patch).eq("id", missionId);
  };

  useEffect(()=>{
    if(!bothValidated || paid) return;
    let mounted = true;
    const finalize = async () => {
      if (missionId) {
        await supabase.from("missions").update({ status:"completed" }).eq("id", missionId);
        const { data:{ user } } = await supabase.auth.getUser();
        if (user && mounted) {
          const montant = Number(totalClientPrice);
          const { data:prof } = await supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id",user.id).single();
          const currentBalance = prof?.cashback_balance || 0;
          const currentMonth   = prof?.missions_completed_month || 0;
          const cashback = calcCashback(montant, currentMonth);
          await supabase.from("profiles").update({
            cashback_balance: Math.round((currentBalance + cashback)*100)/100,
            missions_completed_month: currentMonth + 1,
          }).eq("id", user.id);
          await supabase.from("notifications").insert({
            user_id: user.id, type:"payment",
            title:"Paiement libéré", message:`Mission validée — ${totalNetPresta} € versés à ${p.name}.`,
          });
        }
      }
      if (mounted) setPaid(true);
    };
    const t = setTimeout(finalize, 1500);
    return ()=>{ mounted=false; clearTimeout(t); };
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
              <Btn variant="success" disabled={clientRating===0} onClick={()=>{ persistValidation("client",clientRating,clientComment); setClientValidated(true); }} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Valider</Btn>
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
              <Btn variant="success" disabled={prestaRating===0} onClick={()=>{ persistValidation("presta",prestaRating,prestaComment); setPrestaValidated(true); }} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Confirmer</Btn>
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
            {disputeDone ? (
              <div style={{ textAlign:"center", padding:"8px 0" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>✅</div>
                <div style={{ fontWeight:800, color:C.success, fontSize:15, marginBottom:6 }}>Litige transmis</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>Notre équipe de médiation vous contactera sous 24h ouvrées.</div>
              </div>
            ) : <>
              <div style={{ fontWeight:800, color:C.danger, fontSize:14, marginBottom:8 }}>⚠️ Signalement de litige</div>
              <textarea
                value={disputeMsg}
                onChange={e=>setDisputeMsg(e.target.value)}
                placeholder="Décrivez le problème rencontré…"
                style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`2px solid ${C.accent}44`, fontSize:13, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", marginBottom:12, background:"rgba(255,255,255,0.04)", color:C.text }}
              />
              <Btn full variant="danger" disabled={!disputeMsg.trim() || disputeSending}
                onClick={async () => {
                  if (!disputeMsg.trim()) return;
                  setDisputeSending(true);
                  const { data:authData } = await supabase.auth.getUser();
                  const user = authData?.user;
                  const refNum = "LIT-" + new Date().getFullYear() + "-" + Math.floor(Math.random()*9000+1000);
                  await supabase.from("support_tickets").insert({
                    subject: `Litige mission — ${refNum}`,
                    message: `Mission avec ${p.name}${missionId ? ` (ID: ${missionId})` : ""}.\n\n${disputeMsg.trim()}`,
                    user_id: user?.id || null,
                    user_email: user?.email || null,
                    user_name: user?.user_metadata?.prenom || null,
                    status: "open",
                  });
                  try {
                    await fetch("/api/support", {
                      method:"POST", headers:{"Content-Type":"application/json"},
                      body: JSON.stringify({ subject:`Litige ${refNum} — ${p.name}`, message: disputeMsg.trim(), userEmail: user?.email, userName: user?.user_metadata?.prenom }),
                    });
                  } catch(_) {}
                  setDisputeSending(false);
                  setDisputeDone(true);
                }}
                style={{ fontSize:13, padding:"12px" }}
              >
                {disputeSending ? "Envoi…" : "📞 Contacter la médiation ALANE"}
              </Btn>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MESSAGERIE ────────────────────────────────────────────────────

function ChatScreen({ provider, onBack, chatClientId }) {
  const p = provider || PROVIDERS[0];
  const [msg, setMsg] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [senderTag, setSenderTag] = useState("client");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const pollRef = useRef(null);

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("fr", { hour:"2-digit", minute:"2-digit" });

  // convKey : identique des deux côtés — basé sur providerId + clientId
  const buildKey = (uid) => {
    const providerId = chatClientId ? uid : p.id; // si chatClientId fourni → user courant est le prestataire
    const clientId   = chatClientId ? chatClientId : uid;
    return `prov${providerId}-user${clientId}`;
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id || null;
      setUserId(uid);
      setSenderTag(chatClientId ? "prestataire" : "client");
    });
  }, [chatClientId]);

  const loadMsgs = async (uid) => {
    const key = buildKey(uid);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_key", key)
      .order("created_at", { ascending: true });
    if (!error) setMsgs(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    loadMsgs(userId);
    pollRef.current = setInterval(() => loadMsgs(userId), 4000);
    return () => clearInterval(pollRef.current);
  }, [userId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async () => {
    if (!msg.trim() || sending || !userId) return;
    const content = msg.trim();
    const key = buildKey(userId);
    setMsg("");
    setSending(true);
    const optimistic = { id:`opt-${Date.now()}`, sender_tag:senderTag, sender_id:userId, conversation_key:key, content, created_at:new Date().toISOString() };
    setMsgs(m => [...m, optimistic]);
    try {
      await supabase.from("messages").insert({ conversation_key:key, sender_id:userId, sender_tag:senderTag, content });
    } catch (_) {}
    setSending(false);
  };

  const isClient = (m) => m.sender_tag === "client" || m.from === "client";
  // "mine" = le message vient de l'utilisateur courant
  const isMine = (m) => m.sender_id === userId || (!m.sender_id && isClient(m) && senderTag === "client");

  return (
    <div style={{ minHeight:"100%", background:C.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 18px", borderRadius:"0 0 22px 22px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ width:44, height:44, borderRadius:r, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
          <div>
            <div style={{ color:C.white, fontWeight:700, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.success, fontSize:12, fontWeight:600 }}>● En ligne</div>
          </div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 18px", minHeight:200 }}>
        {loading && <div style={{ textAlign:"center", color:C.textMuted, fontSize:13, paddingTop:40 }}>Chargement…</div>}
        {!loading && msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 20px" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>💬</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Démarrez la conversation</div>
            <div style={{ color:C.textMuted, fontSize:12 }}>Envoyez un message à {p.name}</div>
          </div>
        )}
        {msgs.map((m, i) => {
          const mine = isMine(m);
          return (
            <div key={m.id || i} style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", marginBottom:12 }}>
              {!mine && (
                <div style={{ width:28, height:28, borderRadius:9, background:`${p.color}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginRight:8, flexShrink:0 }}>{p.avatar||"👤"}</div>
              )}
              <div style={{ maxWidth:"75%" }}>
                <div style={{ background:mine?`linear-gradient(135deg,${C.violet},${C.indigo})`:"#1a2d4a", color:C.white, borderRadius:mine?"18px 18px 4px 18px":"18px 18px 18px 4px", padding:"10px 14px", fontSize:14 }}>
                  {m.content || m.text}
                </div>
                <div style={{ fontSize:10, color:C.textSub, marginTop:3, textAlign:mine?"right":"left" }}>
                  {fmtTime(m.created_at || new Date().toISOString())}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div style={{ padding:"12px 18px 24px", background:"#0D1B3E", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <input
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Votre message…"
            style={{ flex:1, padding:"12px 16px", borderRadius:24, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", background:"#112240", color:C.text }}
          />
          <button onClick={send} disabled={sending || !msg.trim()} style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, border:"none", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, opacity:(!msg.trim()||sending)?0.5:1 }}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────

// ── FAVORIS ───────────────────────────────────────────────────────
function FavoritesScreen({ onNavigate, onBack }) {
  const { providers, loading } = useProviders();
  const [favIds, setFavIds] = useState([]);
  const [userId, setUserId] = useState(null);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid=data?.user?.id;
      if(!uid) return;
      setUserId(uid);
      setFavIds(JSON.parse(localStorage.getItem(`alane_favs_${uid}`)||"[]"));
    });
  },[]);
  const removeFav=(pid)=>{
    if(!userId) return;
    const key=`alane_favs_${userId}`;
    const next=favIds.filter(id=>id!==pid);
    localStorage.setItem(key,JSON.stringify(next));
    setFavIds(next);
  };
  const favProviders=providers.filter(p=>favIds.includes(p.id));
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:0 }}>❤️ Mes favoris</h2>
        {favProviders.length>0 && <p style={{ color:"rgba(255,255,255,0.6)", margin:"6px 0 0", fontSize:13 }}>{favProviders.length} prestataire{favProviders.length>1?"s":""} sauvegardé{favProviders.length>1?"s":""}</p>}
      </div>
      <div style={{ padding:"18px" }}>
        {loading ? (
          <div style={{ textAlign:"center", color:C.textMuted, padding:40, fontSize:13 }}>Chargement…</div>
        ) : favProviders.length===0 ? (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"36px 20px", textAlign:"center" }}>
            <div style={{ fontSize:44, marginBottom:14 }}>❤️</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:15, marginBottom:8 }}>Aucun favori pour l'instant</div>
            <div style={{ color:C.textMuted, fontSize:13, lineHeight:1.6 }}>Les prestataires que vous mettez en favoris apparaîtront ici.</div>
          </div>
        ) : favProviders.map(p=>(
          <div key={p.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:16, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:12 }}>
            <div onClick={()=>onNavigate("profile",p)} style={{ width:46, height:46, borderRadius:13, background:`${p.color}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, cursor:"pointer", flexShrink:0 }}>{p.avatar}</div>
            <div onClick={()=>onNavigate("profile",p)} style={{ flex:1, cursor:"pointer" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle||p.role} · {p.hourlyRate}</div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:p.available?C.success:"#666" }} />
                <span style={{ fontSize:11, color:p.available?C.success:C.textMuted }}>{p.available?"Disponible":"Indisponible"}</span>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end" }}>
              <Btn onClick={()=>onNavigate("profile",p)} style={{ padding:"7px 12px", fontSize:12 }}>Voir profil</Btn>
              <button onClick={()=>removeFav(p.id)} style={{ background:"transparent", border:"none", color:"#E74C3C", fontSize:18, cursor:"pointer", padding:0, lineHeight:1 }}>❤️</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────
function FAQScreen({ onBack, role }) {
  const [open, setOpen] = useState(null);
  const faqs = role === "prestataire" ? [
    { q:"Comment fonctionne ALANE ?", a:"ALANE vous met en relation avec des clients qui ont besoin de prestataires dans votre secteur. Vous recevez des propositions de missions correspondant à votre profil et vous choisissez d'accepter ou non." },
    { q:"Comment recevoir ma rémunération ?", a:"Votre rémunération est versée directement sur votre IBAN après validation de la mission par le client. Le délai habituel est de 3 à 5 jours ouvrés." },
    { q:"Quels documents dois-je fournir ?", a:"Pour être validé sur ALANE vous devez fournir : un KBIS ou extrait D1 (auto-entrepreneur), une attestation URSSAF à jour, une RC Professionnelle, et un RIB." },
    { q:"Comment changer ou upgrader mon abonnement ?", a:"Rendez-vous dans l'onglet Abonnement de votre espace prestataire. Vous pouvez changer de plan à tout moment, le changement est immédiat." },
    { q:"Que se passe-t-il si je refuse une mission ?", a:"Aucun problème, vous êtes libre de refuser. ALANE proposera la mission à un autre prestataire disponible dans votre secteur. Trop de refus répétés peuvent cependant affecter votre visibilité." },
    { q:"Comment fonctionne le parrainage ?", a:"Partagez votre code de parrainage à d'autres prestataires. Dès que 3 de vos filleuls souscrivent un abonnement Premium, vous recevez 1 mois Premium offert automatiquement." },
    { q:"Comment contacter le support ?", a:"Via la rubrique Support dans les réglages. Notre équipe répond sous 24h ouvrées." },
  ] : [
    { q:"Comment fonctionne ALANE ?", a:"ALANE vous permet de trouver et réserver des prestataires qualifiés dans votre secteur, vérifiés et assurés. Vous choisissez le profil, la date et l'horaire — ALANE s'occupe du reste." },
    { q:"Comment réserver un prestataire ?", a:"Parcourez les profils disponibles, sélectionnez celui qui correspond à vos besoins, choisissez le créneau et confirmez la réservation. Vous recevez une confirmation immédiate." },
    { q:"Le prix affiché est-il le prix final ?", a:"Oui. ALANE applique un tarif transparent : le prix affiché est le prix réel, sans frais cachés ni commission supplémentaire." },
    { q:"Que faire si le prestataire ne se présente pas ?", a:"Contactez immédiatement le support ALANE. Nous vous trouvons un remplaçant dans les meilleurs délais et vous n'êtes pas facturé pour la mission annulée." },
    { q:"Comment annuler une réservation ?", a:"Vous pouvez annuler jusqu'à 24h avant le début de la mission sans frais. En dessous de ce délai, des frais d'annulation peuvent s'appliquer selon les CGU." },
    { q:"Comment payer ?", a:"Le paiement s'effectue par carte bancaire sécurisée via Stripe au moment de la confirmation de réservation. Votre carte n'est débitée qu'après validation de la mission." },
    { q:"Comment contacter le support ?", a:"Via la rubrique Support dans les réglages. Notre équipe répond sous 24h ouvrées." },
  ];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>📖 FAQ</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Questions fréquentes</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {faqs.map((f,i) => (
          <div key={i} onClick={()=>setOpen(open===i?null:i)} style={{ background:"#0D1B3E", borderRadius:r, marginBottom:9, border:`1px solid ${open===i?C.violet+"66":C.border}`, overflow:"hidden", cursor:"pointer", transition:"border-color 0.2s" }}>
            <div style={{ padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
              <span style={{ fontWeight:600, color:open===i?C.violet:C.text, fontSize:13, flex:1, lineHeight:1.4 }}>{f.q}</span>
              <span style={{ color:C.textMuted, fontSize:16, flexShrink:0, transform:open===i?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
            </div>
            {open===i && (
              <div style={{ padding:"0 16px 16px", color:C.textSub, fontSize:13, lineHeight:1.7, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
                {f.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PARRAINAGE ────────────────────────────────────────────────────
function ReferralScreen({ onBack }) {
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("ALANE-…");

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid = data?.user?.id;
      if(uid) setCode("ALANE-" + uid.slice(0,6).toUpperCase());
    });
  },[]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(()=>{
      setCopied(true);
      setTimeout(()=>setCopied(false), 2000);
    });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accentGold},#e67e22)`, padding:"48px 22px 36px", borderRadius:"0 0 28px 28px", textAlign:"center" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:20, display:"block" }}>← Retour</button>
        <div style={{ fontSize:52, marginBottom:10 }}>🎁</div>
        <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 8px", fontFamily:font.display }}>Parrainez & gagnez</h2>
        <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, margin:0 }}>1 mois Premium offert pour 3 filleuls abonnés</p>
      </div>
      <div style={{ padding:"24px 18px" }}>
        {/* Récompense */}
        <div style={{ background:`linear-gradient(135deg,${C.violet}22,${C.accentGold}15)`, border:`1px solid ${C.accentGold}55`, borderRadius:18, padding:"18px 16px", marginBottom:16, textAlign:"center" }}>
          <div style={{ fontSize:32, marginBottom:6 }}>👑</div>
          <div style={{ color:C.text, fontWeight:800, fontSize:15, marginBottom:4 }}>1 mois Premium offert</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>Dès que 3 de vos filleuls souscrivent un abonnement Premium, vous recevez 1 mois Premium gratuit.</div>
        </div>
        {/* Code */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
          <p style={{ color:C.textSub, fontSize:13, margin:"0 0 12px" }}>Votre code de parrainage</p>
          <div style={{ background:`${C.accentGold}15`, border:`2px dashed ${C.accentGold}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <div style={{ fontSize:24, fontWeight:800, color:C.text, letterSpacing:3 }}>{code}</div>
          </div>
          <Btn full variant="gold" onClick={handleCopy} style={{ fontSize:14 }}>
            {copied ? "✓ Copié !" : "📋 Copier le code"}
          </Btn>
        </div>
        <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}33`, borderRadius:r, padding:"12px 14px", marginBottom:16, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          💡 Votre filleul renseigne votre code à l’inscription. Le mois offert est crédité dès que le 3ème filleul passe en Premium.
        </div>
        {[
          {i:"🔗", t:"Partagez votre code", s:"Via SMS, email ou réseaux sociaux"},
          {i:"✅", t:"3 filleuls passent Premium", s:"Ils utilisent votre code à l’inscription"},
          {i:"👑", t:"1 mois Premium offert", s:"Crédité automatiquement sur votre compte"},
        ].map((s,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:9, display:"flex", gap:12, alignItems:"center" }}>
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
  const TOTAL=8;
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
  const recapStep=8;

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
        await supabase.from("abonnements").upsert({ prestataire_id:user.id, plan:abonnement });
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
    if(step===7)return true;
    return true;
  };
  const TITLES=["Informations personnelles","Adresse & zone","Statut auto-entrepreneur","Documents administratifs","Métiers & compétences","Disponibilités","Votre abonnement","Récapitulatif"];
  const SUBS=["Vos coordonnées","Résidence et intervention","Informations légales","Obligatoires pour valider","Vos savoir-faire","Vos créneaux","Choisissez votre plan","Vérifiez avant envoi"];

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
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}55`, borderRadius:r, padding:"14px", marginBottom:18, fontSize:13, lineHeight:1.5 }}>⚠️ <strong>Auto-entrepreneur obligatoire</strong><br/><span style={{ color:C.textSub }}>ALANE travaille exclusivement avec des AE. Vos infos seront vérifiées.</span></div>
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
                ℹ️ ALANE ne perçoit aucune commission sur la création de votre entreprise. Revenez avec votre SIRET pour finaliser votre inscription.
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
                    Le tarif client inclut les frais de service ALANE
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
        {step===7 && <>
          <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:18 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>⚡ Choisissez votre plan ALANE</div>
            <div style={{ color:C.textSub, fontSize:12 }}>Tarif transparent · prix affiché = prix réel. Changez de plan à tout moment.</div>
          </div>
          <div style={{ background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:r, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.textSub }}>
            💡 Vous pourrez changer de plan à tout moment depuis votre espace.
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
            ...[{title:"⚡ Abonnement",items:[(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)||ABONNEMENTS_PRESTA[0]).label+" — "+(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price===0?"Gratuit":(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price)+" €/mois")]}],
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
              <span style={{ fontSize:13, color:C.textSub, lineHeight:1.5 }}>J'accepte les <strong style={{ color:C.violet }}>CGU</strong> et la <strong style={{ color:C.violet }}>Politique de confidentialité</strong> de ALANE</span>
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

// ── PRESTA PROFIL TAB ─────────────────────────────────────────────
function PrestaProfilTab({ onNavigate }) {
  const [meta, setMeta] = useState(null);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{ if(data?.user) setMeta(data.user.user_metadata||{}); });
  },[]);

  const secteurInfo = meta?.secteur ? SECTORS.find(s=>s.id===meta.secteur) : null;
  const color = secteurInfo?.color || C.accentGold;

  return (
    <div>
      {/* Carte profil métier */}
      {meta && (meta.secteur || meta.metier || meta.tarif_net) && (
        <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:12, border:`1px solid ${color}33` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mon profil professionnel</div>
            <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:`${color}20`, border:`1px solid ${color}44`, borderRadius:8, padding:"5px 12px", color:color, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✏️ Modifier</button>
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
            {secteurInfo && <Badge color={color} small>{secteurInfo.icon} {secteurInfo.label}</Badge>}
            {meta.metier && <Badge color={C.violet} small>💼 {meta.metier}</Badge>}
            {meta.niveau && <Badge color={C.textSub} small>{meta.niveau==="Débutant"?"🌱":meta.niveau==="Confirmé"?"💪":"🏆"} {meta.niveau}</Badge>}
            {meta.experience_ans!=null && <Badge color={C.textSub} small>🕐 {meta.experience_ans} an{meta.experience_ans>1?"s":""}</Badge>}
          </div>
          {meta.tarif_net && (
            <div style={{ background:`${color}15`, borderRadius:10, padding:"10px 12px", marginBottom:meta.langues?.length?10:0, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:C.textSub, fontSize:12 }}>Tarif net</span>
              <span style={{ color:color, fontWeight:800, fontSize:15 }}>{Number(meta.tarif_net).toFixed(2)} €/h</span>
            </div>
          )}
          {meta.langues?.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {meta.langues.map(l=><span key={l} style={{ background:"rgba(255,255,255,0.06)", borderRadius:6, padding:"3px 8px", color:C.textSub, fontSize:11 }}>🌐 {l}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Disponibilités */}
      {meta && (meta.dispon_jours?.length || meta.dispon_creneaux?.length) && (
        <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>📅 Disponibilités</div>
            <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:"transparent", border:"none", color:C.violet, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Modifier</button>
          </div>
          {meta.dispon_jours?.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
              {meta.dispon_jours.map(j=><span key={j} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:6, padding:"3px 9px", color:C.violet, fontSize:11, fontWeight:600 }}>{j.slice(0,3)}</span>)}
            </div>
          )}
          {meta.dispon_creneaux?.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {meta.dispon_creneaux.map(c=><span key={c} style={{ background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"3px 8px", color:C.textSub, fontSize:11 }}>{c.split(" ")[0]}</span>)}
            </div>
          )}
          {meta.dispo_immediat && <div style={{ color:C.success, fontSize:11, fontWeight:600, marginTop:8 }}>⚡ Disponible immédiatement</div>}
        </div>
      )}

      {/* Si aucune donnée d'inscription → incitation à compléter */}
      {meta && !meta.secteur && (
        <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}35`, borderRadius:r, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontWeight:700, color:C.accentGold, fontSize:13, marginBottom:6 }}>⚠️ Profil incomplet</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:10 }}>Complétez votre profil pour apparaître dans les résultats et recevoir des missions.</div>
          <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:C.accentGold, border:"none", borderRadius:10, padding:"9px 16px", color:"#000", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Compléter mon profil →</button>
        </div>
      )}

      {/* Liens fixes */}
      {[
        {icon:"📂",label:"Mes documents",sub:"Uploader & renouveler mes docs", action:()=>onNavigate("doc_upload")},
        {icon:"👤",label:"Informations personnelles",sub:"Nom, email, téléphone", action:()=>onNavigate("settings")},
        {icon:"⚡",label:"Mon abonnement",sub:"100 premiers → 10 missions/mois gratuit · Premium 29€ · Elite 59€",action:()=>onNavigate("abonnement_presta")},
        {icon:"🔔",label:"Notifications",sub:"Gérer mes alertes", action:()=>onNavigate("notifications")},
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
    </div>
  );
}

// ── PRESTA PROFILE EDIT ────────────────────────────────────────────
function PrestaProfileEditScreen({ onBack }) {
  const [meta, setMeta] = useState(null);
  const [dispos, setDispos] = useState({});
  const [dispoImmediat, setDispoImmediat] = useState(true);
  const [tarifNet, setTarifNet] = useState(13);
  const [langues, setLangues] = useState(["Français"]);
  const [competences, setCompetences] = useState([]);
  const [statutPro, setStatutPro] = useState("auto-entrepreneur");
  const [rayon, setRayon] = useState(20);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [telephone, setTelephone] = useState("");
  const [iban, setIban]           = useState("");

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const m = data?.user?.user_metadata || {};
      setMeta(m);
      // Charge le nouvel objet par jour, ou reconstruit depuis l'ancien format plat
      if (m.dispon_jours_creneaux && Object.keys(m.dispon_jours_creneaux).length > 0) {
        setDispos(m.dispon_jours_creneaux);
      } else if (m.dispon_jours?.length) {
        const rebuilt = {};
        (m.dispon_jours || []).forEach(j => { rebuilt[j] = m.dispon_creneaux || []; });
        setDispos(rebuilt);
      }
      setDispoImmediat(m.dispo_immediat !== false);
      setTarifNet(m.tarif_net || 13);
      setLangues(m.langues?.length ? m.langues : ["Français"]);
      setCompetences(m.competences || []);
      setStatutPro(m.statut_pro || "auto-entrepreneur");
      setRayon(m.zone_km || 20);
      setTelephone(m.telephone||"");
      setIban(m.rib||"");
    });
  },[]);

  const toggle = (arr, setArr, item) =>
    setArr(prev => prev.includes(item) ? prev.filter(x=>x!==item) : [...prev, item]);

  const handleSave = async () => {
    setSaving(true); setSaveError(false);
    const { error } = await supabase.auth.updateUser({ data: {
      dispon_jours: JOURS.filter(j => (dispos[j]||[]).length > 0),
      dispon_jours_creneaux: dispos,
      dispo_immediat: dispoImmediat,
      tarif_net: Number(tarifNet), langues, competences, statut_pro: statutPro, zone_km: rayon,
      telephone, rib: iban,
    }});
    setSaving(false);
    if (error) { setSaveError(true); setTimeout(()=>setSaveError(false), 4000); return; }
    setSaved(true);
    setTimeout(()=>{ setSaved(false); onBack(); }, 1200);
  };

  const secteurInfo = meta?.secteur ? SECTORS.find(s=>s.id===meta?.secteur) : null;
  const color = secteurInfo?.color || C.accentGold;
  const tarifInfo = meta?.secteur && meta?.metier ? METIERS_TARIFS[meta.secteur]?.[meta.metier] : null;
  const sliderMin = 1;
  const sliderMax = 100;
  const compListe = COMPETENCES_PAR_SECTEUR[meta?.secteur] || [];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,${color}55,${color}22)`, padding:"52px 22px 22px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:"#fff", cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:"#fff", fontSize:20, fontWeight:700, margin:0, fontFamily:font.display }}>✏️ Modifier mon profil</h2>
        {meta?.metier && <div style={{ color:"rgba(255,255,255,0.7)", fontSize:13, marginTop:4 }}>{secteurInfo?.label} · {meta.metier}</div>}
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Tarif */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:12, textTransform:"uppercase", letterSpacing:0.8 }}>
            Tarif horaire net : <span style={{ color, fontWeight:800, fontSize:15 }}>{Number(tarifNet).toFixed(2)} €/h</span>
          </label>
          <input type="range" min={sliderMin} max={sliderMax} step={0.5} value={tarifNet} onChange={e=>setTarifNet(Number(e.target.value))} style={{ width:"100%", accentColor:color, marginBottom:6 }} />
          <div style={{ display:"flex", justifyContent:"space-between", color:C.textMuted, fontSize:11 }}><span>{sliderMin} €</span><span>{sliderMax} €</span></div>
          {tarifInfo && (
            <div style={{ background: tarifNet < tarifInfo.min ? "rgba(242,94,94,0.08)" : tarifNet > tarifInfo.max ? "rgba(240,180,41,0.08)" : "rgba(255,255,255,0.04)", border:`1px solid ${tarifNet < tarifInfo.min ? "#F25E5E44" : tarifNet > tarifInfo.max ? `${C.accentGold}44` : C.border}`, borderRadius:8, padding:"6px 12px", marginTop:8, fontSize:11, color:C.textSub }}>
              {tarifNet < tarifInfo.min && <span style={{ color:"#F25E5E", fontWeight:700 }}>⚠️ En dessous du marché · </span>}
              {tarifNet > tarifInfo.max && <span style={{ color:C.accentGold, fontWeight:700 }}>📈 Au-dessus du marché · </span>}
              📊 Marché : <strong style={{ color:C.text }}>{tarifInfo.min} – {tarifInfo.max} €/h</strong>
            </div>
          )}
        </div>

        {/* Disponibilités par jour */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>📅 Disponibilités</div>
          <div style={{ color:C.textSub, fontSize:12, marginBottom:14 }}>Sélectionnez vos créneaux jour par jour</div>
          {JOURS.map(jour => {
            const sel = dispos[jour] || [];
            const hasSel = sel.length > 0;
            return (
              <div key={jour} style={{ marginBottom:8, borderRadius:10, border:`2px solid ${hasSel?color:C.border}`, overflow:"hidden", transition:"border-color 0.2s" }}>
                <div style={{ padding:"9px 13px", background:hasSel?`${color}10`:"transparent", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, color:hasSel?color:C.text, fontSize:13 }}>{jour}</span>
                  {hasSel
                    ? <span style={{ fontSize:11, color:color, fontWeight:600 }}>{sel.map(c=>c.split(" ")[0]).join(" · ")}</span>
                    : <span style={{ color:C.textSub, fontSize:11 }}>Non disponible</span>}
                </div>
                <div style={{ padding:"7px 13px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}`, background:"rgba(0,0,0,0.1)" }}>
                  {PLAGES.map(plage => {
                    const active = sel.includes(plage);
                    return (
                      <button key={plage} onClick={()=>setDispos(prev=>{ const cur=prev[jour]||[]; return {...prev,[jour]:active?cur.filter(x=>x!==plage):[...cur,plage]}; })}
                        style={{ padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:active?700:500, background:active?color:"rgba(255,255,255,0.07)", color:active?C.white:C.textSub, transition:"all 0.15s" }}>
                        {plage.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ height:8 }} />
          <div onClick={()=>setDispoImmediat(!dispoImmediat)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
            <span style={{ color:C.text, fontSize:13 }}>Disponible immédiatement</span>
            <div style={{ width:40, height:22, borderRadius:11, background:dispoImmediat?color:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s" }}>
              <div style={{ position:"absolute", top:2, left:dispoImmediat?20:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
            </div>
          </div>
        </div>

        {/* Langues */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>🌐 Langues parlées</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {LANGUES_LIST.map(l=>(
              <button key={l} onClick={()=>{ if(l==="Français") return; toggle(langues,setLangues,l); }} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${langues.includes(l)?color:C.border}`, background:langues.includes(l)?`${color}25`:"transparent", color:langues.includes(l)?color:C.textSub, fontSize:12, fontWeight:langues.includes(l)?700:400, cursor:l==="Français"?"default":"pointer", fontFamily:"inherit", opacity:l==="Français"?0.6:1 }}>{l}{l==="Français"?" ✓":""}</button>
            ))}
          </div>
        </div>

        {/* Compétences */}
        {compListe.length > 0 && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>⚡ Compétences clés</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {compListe.map(c=>(
                <button key={c} onClick={()=>toggle(competences,setCompetences,c)} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${competences.includes(c)?color:C.border}`, background:competences.includes(c)?`${color}25`:"transparent", color:competences.includes(c)?color:C.textSub, fontSize:12, fontWeight:competences.includes(c)?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{c}</button>
              ))}
            </div>
          </div>
        )}

        {/* Rayon géographique */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>📍 Rayon d'intervention</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
            {["5","10","20","30","50","100"].map(km=>(
              <button key={km} onClick={()=>setRayon(parseInt(km))} style={{ padding:"9px 16px", borderRadius:20, border:"none", cursor:"pointer", background:rayon===parseInt(km)?color:C.grayLight, color:rayon===parseInt(km)?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{km} km</button>
            ))}
          </div>
          <p style={{ color:color, fontSize:12, fontWeight:700, margin:0 }}>Zone : {rayon} km autour de chez vous</p>
        </div>

        {/* Statut pro */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>🧾 Statut professionnel</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[
              { id:"auto-entrepreneur", label:"Auto-entrepreneur / Micro-entreprise", icon:"🧾" },
            ].map(s=>(
              <button key={s.id} onClick={()=>setStatutPro(s.id)} style={{ padding:"12px 14px", borderRadius:r, border:`2px solid ${statutPro===s.id?color:C.border}`, background:statutPro===s.id?`${color}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:10, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:16 }}>{s.icon}</span>
                <span style={{ color:statutPro===s.id?color:C.text, fontWeight:statutPro===s.id?700:500, fontSize:13 }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Coordonnées */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>📞 Coordonnées & paiement</div>
          <Input label="Téléphone" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(e.target.value)} />
          <Input label="IBAN" placeholder="FR76 3000 6000 0112 3456 7890 189" icon="💳" value={iban} onChange={e=>setIban(e.target.value)} />
        </div>

        {saveError && <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:12, fontSize:13, color:"#F25E5E", textAlign:"center" }}>❌ Erreur lors de l'enregistrement. Vérifiez votre connexion et réessayez.</div>}
        <Btn full onClick={handleSave} disabled={saving} style={{ background:saveError?C.accent:color, boxShadow:`0 8px 24px ${color}44`, padding:"16px", fontSize:15 }}>
          {saving ? "Enregistrement…" : saved ? "✅ Sauvegardé !" : "Enregistrer les modifications"}
        </Btn>
      </div>
    </div>
  );
}

// ── PRESTA POINTAGE (check-in / check-out) ────────────────────────
function PrestaPointageScreen({ provider, type, onSuccess, onBack }) {
  const p = provider || PROVIDERS[0];
  const expectedCode = genMissionCode(p.id, type);
  const isIn = type === "in";

  const [gpsStatus, setGpsStatus] = useState("loading"); // loading | ok | warning | error
  const [gpsDistance, setGpsDistance] = useState(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus("error"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const missionCoords = cpToCoords(p.code_postal || "75");
        if (missionCoords) {
          const dist = haversineKm(pos.coords.latitude, pos.coords.longitude, missionCoords[0], missionCoords[1]);
          setGpsDistance(dist);
          setGpsStatus(dist <= 0.5 ? "ok" : "warning");
        } else {
          setGpsStatus("ok");
        }
      },
      () => setGpsStatus("error"),
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  const handleValidate = () => {
    if (code.trim() !== expectedCode) {
      setCodeError("Code incorrect. Vérifiez avec le client.");
      return;
    }
    setDone(true);
    const key = `alane_pointage_${p.id}_${new Date().toISOString().slice(0,10)}`;
    localStorage.setItem(key, isIn ? "checkin" : "checkout");
    setTimeout(() => onSuccess && onSuccess(), 2000);
  };

  if (done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:16 }}>{isIn ? "✅" : "🏁"}</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>{isIn ? "Arrivée confirmée !" : "Départ confirmé !"}</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto" }}>
        {isIn ? "Votre présence est enregistrée. Bonne mission !" : "Mission terminée. En attente de validation."}
      </p>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>{isIn ? "📍 Pointer mon arrivée" : "🏁 Pointer mon départ"}</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{p.name} · Cariste CACES 1 · Entrepôt XYZ</p>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Étape 1 — GPS */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${gpsStatus==="ok"?C.success:gpsStatus==="warning"?"#FFA500":C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:44, height:44, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
              background: gpsStatus==="ok" ? `${C.success}22` : gpsStatus==="warning" ? "rgba(255,165,0,0.15)" : "rgba(255,255,255,0.05)" }}>
              {gpsStatus==="loading" ? "📡" : gpsStatus==="ok" ? "✅" : gpsStatus==="warning" ? "⚠️" : "❌"}
            </div>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Vérification GPS</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>
                {gpsStatus==="loading" && "Localisation en cours…"}
                {gpsStatus==="ok" && `Vous êtes sur place (${gpsDistance !== null ? gpsDistance+" km" : "< 500m"} du lieu de mission)`}
                {gpsStatus==="warning" && `Vous semblez éloigné du lieu (${gpsDistance} km). Vérifiez votre position.`}
                {gpsStatus==="error" && "GPS indisponible. Continuez avec le code client."}
              </div>
            </div>
          </div>
        </div>

        {/* Étape 2 — Code client */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>🔢 Code client</div>
          <p style={{ color:C.textSub, fontSize:12, margin:"0 0 16px", lineHeight:1.6 }}>
            Demandez au client le code {isIn ? "d'arrivée" : "de départ"} affiché dans son application.
          </p>
          <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:16 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:56, height:64, borderRadius:r, border:`2px solid ${code[i] ? C.violet : C.border}`, background: code[i] ? `${C.violet}18` : "rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:900, color:C.text, fontFamily:"monospace" }}>
                {code[i] || "—"}
              </div>
            ))}
          </div>
          {/* Pavé numérique */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, maxWidth:240, margin:"0 auto" }}>
            {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i) => (
              <button key={i} disabled={k===""} onClick={() => {
                if (k === "⌫") { setCode(c => c.slice(0,-1)); setCodeError(""); }
                else if (code.length < 4) { setCode(c => c + k); setCodeError(""); }
              }} style={{ padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, background: k===""?"transparent":"#162547", color:C.text, fontSize:18, fontWeight:700, cursor:k===""?"default":"pointer", fontFamily:"monospace", opacity:k===""?0:1 }}>
                {k}
              </button>
            ))}
          </div>
          {codeError && <p style={{ color:C.accent, fontSize:12, textAlign:"center", marginTop:10 }}>{codeError}</p>}
        </div>

        <Btn full disabled={code.length < 4 || gpsStatus==="loading"}
          onClick={handleValidate}
          style={{ fontSize:15, padding:"16px", background: isIn ? C.success : C.accentGold, boxShadow:`0 8px 24px ${isIn?C.success:C.accentGold}44` }}>
          {isIn ? "✅ Confirmer mon arrivée" : "🏁 Confirmer mon départ"}
        </Btn>
        {gpsStatus === "warning" && (
          <p style={{ color:"#FFA500", fontSize:11, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
            ⚠️ Votre position GPS est éloignée. L'alerte sera enregistrée.
          </p>
        )}
      </div>
    </div>
  );
}

// ── PRESTA ONBOARDING CHECKLIST ───────────────────────────────────
function PrestaOnboardingChecklist({ onNavigate }) {
  const [meta, setMeta] = useState(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("alane_presta_checklist_dismissed") === "1");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeta(data?.user?.user_metadata || {}));
  }, []);

  if (dismissed || !meta) return null;

  const items = [
    { id:"secteur",  label:"Secteur d'activité choisi",   done:!!meta.secteur,               action:"presta_profile_edit" },
    { id:"metier",   label:"Métier renseigné",             done:!!meta.metier,                 action:"presta_profile_edit" },
    { id:"dispos",   label:"Disponibilités configurées",   done:!!(meta.dispon_jours?.length), action:"presta_profile_edit" },
    { id:"tarif",    label:"Tarif horaire défini",         done:!!meta.tarif_net,              action:"presta_profile_edit" },
    { id:"rib",      label:"IBAN renseigné",               done:!!meta.rib,                    action:"settings"            },
  ];

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div style={{ background:"linear-gradient(135deg,#0D1B3E,#162547)", border:`1px solid ${C.violet}44`, borderRadius:16, padding:"16px", marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>🚀 Premiers pas</div>
          <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{doneCount}/{items.length} étapes complétées</div>
        </div>
        <button onClick={() => { localStorage.setItem("alane_presta_checklist_dismissed","1"); setDismissed(true); }} style={{ background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:20, lineHeight:1, padding:"0 0 0 8px" }}>×</button>
      </div>
      <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:99, height:6, marginBottom:14, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${C.violet},${C.violetLight})`, borderRadius:99, transition:"width 0.5s" }} />
      </div>
      {items.map((item, idx) => (
        <div key={item.id}
          onClick={() => !item.done && onNavigate(item.action)}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom: idx < items.length-1 ? `1px solid rgba(255,255,255,0.05)` : "none", cursor:item.done?"default":"pointer" }}>
          <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800,
            background: item.done ? `${C.success}22` : `${C.violet}22`,
            border: `1.5px solid ${item.done ? C.success : C.violet}66`,
            color: item.done ? C.success : C.violet }}>
            {item.done ? "✓" : "→"}
          </div>
          <span style={{ flex:1, fontSize:13, color:item.done?C.textSub:C.text, fontWeight:item.done?400:600, textDecoration:item.done?"line-through":"none" }}>{item.label}</span>
          {!item.done && <span style={{ color:C.violet, fontSize:11, fontWeight:700, flexShrink:0 }}>Compléter →</span>}
        </div>
      ))}
    </div>
  );
}

// ── UPGRADE NUDGE ─────────────────────────────────────────────────
function UpgradeNudge({ onNavigate }) {
  const [plan,setPlan]=useState(null);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      setPlan(data?.user?.user_metadata?.plan_abonnement||"free");
    });
  },[]);
  if(plan === null) return null;
  if(plan !== "free") return null;
  return (
    <div onClick={()=>onNavigate("abonnement_presta")} style={{ background:`linear-gradient(135deg,${C.violet}20,${C.accentGold}15)`, border:`1px solid ${C.violet}44`, borderRadius:r, padding:"13px 16px", marginBottom:14, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>⚡ Passez Premium</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Missions illimitées · Badge vérifié · Urgences</div>
      </div>
      <span style={{ color:C.violet, fontWeight:700, fontSize:13 }}>29€/mois ›</span>
    </div>
  );
}

// ── PRESTA MISSIONS FEED ─────────────────────────────────────────
function PMissionsTab({ onNavigate }) {
  const [tab, setTab]             = useState("disponibles");
  const [missions, setMissions]   = useState([]);
  const [candidatures, setCandidatures] = useState([]);
  const [pendingMissions, setPendingMissions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [userId, setUserId]       = useState(null);
  const [userName, setUserName]   = useState("");
  const [userMeta, setUserMeta]   = useState({});
  const [applying, setApplying]   = useState(null);
  const [applied, setApplied]     = useState(new Set());
  const [message, setMessage]     = useState("");
  const [showMsg, setShowMsg]     = useState(null);
  const [actioning, setActioning] = useState(null);

  const loadPending = async (uid) => {
    const { data } = await supabase.from("missions")
      .select("id,sector,metier,date,hours,tarif_horaire,acceptance_deadline,client_id,titre")
      .eq("prestataire_id", uid).eq("status", "pending_acceptance");
    setPendingMissions(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if (!u) return;
      setUserId(u.id);
      const meta = u.user_metadata || {};
      setUserMeta(meta);
      setUserName([meta.prenom, meta.nom].filter(Boolean).join(" ") || "");
      const sector = meta.secteur || meta.sector || null;
      const [r1, r2] = await Promise.all([
        fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ action:"list_open", sector }) }),
        fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ action:"mes_candidatures", prestataire_id: u.id }) }),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      setMissions(Array.isArray(d1) ? d1 : []);
      const cands = Array.isArray(d2) ? d2 : [];
      setCandidatures(cands);
      setApplied(new Set(cands.map(c => c.mission_id)));
      await loadPending(u.id);
      setLoading(false);
    });
  }, []);

  const handleAccept = async (m) => {
    setActioning(m.id + "_acc");
    await supabase.from("missions").update({ status: "assigned" }).eq("id", m.id);
    if (m.client_id) {
      await supabase.from("notifications").insert({
        user_id: m.client_id, type: "mission_accepted",
        title: "Mission acceptée ! 🎉",
        message: `${userName || "Votre prestataire"} a accepté votre demande de mission.`,
      });
    }
    setPendingMissions(prev => prev.filter(x => x.id !== m.id));
    setActioning(null);
  };

  const handleRefuse = async (m) => {
    setActioning(m.id + "_ref");
    await supabase.from("missions").update({ status: "refused" }).eq("id", m.id);
    if (m.client_id) {
      await supabase.from("notifications").insert({
        user_id: m.client_id, type: "mission_refused",
        title: "Mission refusée",
        message: `${userName || "Le prestataire"} a décliné votre demande. Choisissez un autre prestataire.`,
      });
    }
    setPendingMissions(prev => prev.filter(x => x.id !== m.id));
    setActioning(null);
  };

  const formatDeadline = (deadline) => {
    if (!deadline) return null;
    const secs = Math.floor((new Date(deadline).getTime() - Date.now()) / 1000);
    if (secs <= 0) return "Délai dépassé";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2,"0")}min restant`;
    return `${String(m).padStart(2,"0")}min restant`;
  };

  const handleApply = async (missionId) => {
    if (!userId) return;
    setApplying(missionId);
    const res = await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", mission_id: missionId, prestataire_id: userId, message: message.trim() || null }),
    });
    const data = await res.json();
    if (data.success) {
      setApplied(prev => new Set([...prev, missionId]));
      setShowMsg(null);
      setMessage("");
    }
    setApplying(null);
  };

  const metier = userMeta.metier || userMeta.job_title || null;
  const matched = missions.filter(m => !metier || !m.metier || m.metier === metier);

  const candStatusLabel = { pending:"En attente", accepted:"Acceptée ✅", rejected:"Refusée ❌" };
  const candStatusColor = { pending:C.accentGold, accepted:C.success, rejected:"#F25E5E" };
  const missionStatusLabel = { open:"Ouverte", assigned:"Assignée", completed:"Terminée", closed:"Fermée" };

  if (loading) return <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>;

  return (
    <div>
      {/* Missions en attente de confirmation */}
      {pendingMissions.length > 0 && (
        <div style={{ marginBottom:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:C.accent, boxShadow:`0 0 8px ${C.accent}`, animation:"pulse 1.5s ease-in-out infinite" }} />
            <p style={{ fontWeight:800, color:C.accent, fontSize:13, margin:0 }}>🔔 En attente de votre réponse ({pendingMissions.length})</p>
          </div>
          {pendingMissions.map(m => {
            const sector = SECTORS.find(s => s.id === m.sector);
            const deadlineLabel = formatDeadline(m.acceptance_deadline);
            const expired = deadlineLabel === "Délai dépassé";
            const isAct = actioning === m.id+"_acc" || actioning === m.id+"_ref";
            return (
              <div key={m.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, border:`2px solid ${expired ? C.textMuted : C.accent}55` }}>
                <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:10 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.titre || m.metier || sector?.label || "Mission"}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>📅 {m.date} · {m.hours}h</div>
                    {m.tarif_horaire > 0 && <div style={{ color:C.success, fontSize:12, fontWeight:700 }}>💶 {Number(m.tarif_horaire).toFixed(2).replace(".",",")} € HT/h</div>}
                  </div>
                  {deadlineLabel && (
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <span style={{ fontSize:11, color:expired?C.textMuted:C.accentGold, fontWeight:700 }}>⏱ {deadlineLabel}</span>
                    </div>
                  )}
                </div>
                {expired ? (
                  <div style={{ padding:"9px", borderRadius:10, background:"rgba(255,255,255,0.04)", color:C.textMuted, fontSize:12, textAlign:"center" }}>Délai dépassé — cette mission a été annulée automatiquement</div>
                ) : (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>handleRefuse(m)} disabled={isAct} style={{ flex:1, padding:"11px", border:`1px solid ${C.accent}44`, borderRadius:10, background:C.accent+"10", color:C.accent, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                      {actioning===m.id+"_ref" ? "…" : "✗ Refuser"}
                    </button>
                    <button onClick={()=>handleAccept(m)} disabled={isAct} style={{ flex:2, padding:"11px", border:"none", borderRadius:10, background:C.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                      {actioning===m.id+"_acc" ? "…" : "✅ Accepter la mission"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Onglets */}
      <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
        {[{id:"disponibles",l:"Missions disponibles"},{id:"candidatures",l:`Mes candidatures${candidatures.length>0?` (${candidatures.length})`:""}`}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"9px 6px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit" }}>{t.l}</button>
        ))}
      </div>

      {/* Missions disponibles */}
      {tab === "disponibles" && (
        matched.length === 0 ? (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 16px", textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>📭</div>
            <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:6 }}>Aucune mission disponible</div>
            <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vous serez notifié dès qu'une mission correspond à votre profil.</div>
          </div>
        ) : matched.map(m => {
          const sector = SECTORS.find(s => s.id === m.sector);
          const isApplied = applied.has(m.id);
          return (
            <div key={m.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, border:`1px solid ${C.border}` }}>
              <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:10 }}>
                <div style={{ width:44, height:44, borderRadius:12, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.metier || sector?.label || "Mission"}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>📅 {m.date} · {m.hours}h</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>📍 {m.ville}{m.adresse ? `, ${m.adresse}` : ""}</div>
                  {m.description && <div style={{ color:C.textMuted, fontSize:12, marginTop:4, fontStyle:"italic" }}>"{m.description}"</div>}
                </div>
              </div>
              {showMsg === m.id && !isApplied && (
                <div style={{ marginBottom:10 }}>
                  <textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Message de candidature (optionnel)…"
                    style={{ width:"100%", minHeight:60, background:"rgba(255,255,255,0.05)", border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", color:C.text, fontSize:12, fontFamily:"inherit", resize:"none", boxSizing:"border-box" }} />
                </div>
              )}
              <div style={{ display:"flex", gap:8 }}>
                {!isApplied && showMsg !== m.id && (
                  <button onClick={()=>setShowMsg(m.id)} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:`${C.violet}22`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    ✉️ Postuler
                  </button>
                )}
                {showMsg === m.id && !isApplied && (
                  <>
                    <button onClick={()=>{ setShowMsg(null); setMessage(""); }} style={{ flex:1, padding:"9px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
                    <button onClick={()=>handleApply(m.id)} disabled={applying===m.id} style={{ flex:2, padding:"9px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      {applying===m.id ? "…" : "Envoyer ma candidature"}
                    </button>
                  </>
                )}
                {isApplied && (
                  <div style={{ flex:1, padding:"9px", borderRadius:10, background:`${C.success}15`, color:C.success, fontWeight:700, fontSize:12, textAlign:"center" }}>✅ Candidature envoyée</div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Mes candidatures */}
      {tab === "candidatures" && (
        candidatures.length === 0 ? (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 16px", textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>📝</div>
            <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:6 }}>Aucune candidature</div>
            <div style={{ color:C.textMuted, fontSize:12 }}>Vos candidatures apparaîtront ici.</div>
          </div>
        ) : candidatures.map(c => {
          const m = c.mission;
          const sector = SECTORS.find(s => s.id === m?.sector);
          return (
            <div key={c.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, border:`1px solid ${candStatusColor[c.status]||C.border}30` }}>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ width:44, height:44, borderRadius:12, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m?.metier || sector?.label || "Mission"}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>📅 {m?.date} · {m?.hours}h</div>
                  {m?.tarif_horaire > 0 && <div style={{ color:C.textSub, fontSize:12 }}>💶 {Number(m.tarif_horaire).toFixed(2).replace(".",",")} € HT/h</div>}
                  <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>Mission : <span style={{ color:C.textSub }}>{missionStatusLabel[m?.status]||m?.status}</span></div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <span style={{ color:candStatusColor[c.status]||C.textMuted, fontWeight:700, fontSize:12 }}>{candStatusLabel[c.status]||c.status}</span>
                  <div style={{ color:C.textMuted, fontSize:10, marginTop:2 }}>{new Date(c.created_at).toLocaleDateString("fr-FR")}</div>
                </div>
              </div>
              {c.message && <div style={{ color:C.textMuted, fontSize:12, marginTop:8, fontStyle:"italic", borderTop:`1px solid ${C.border}`, paddingTop:8 }}>"{c.message}"</div>}
              {c.status === "accepted" && m?.status === "assigned" && (
                <div style={{ marginTop:10, background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ color:C.success, fontWeight:700, fontSize:13 }}>🎉 Vous avez été sélectionné !</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Préparez-vous pour la mission le {m?.date}.</div>
                  {m?.client_id && (
                    <button onClick={()=>onNavigate("chat",{ id:userId, avatar:"👤", color:C.violet, name:"Client", clientId:m.client_id })}
                      style={{ marginTop:8, width:"100%", padding:"8px", borderRadius:10, border:`1px solid ${C.violet}44`, background:`${C.violet}15`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      💬 Contacter le client
                    </button>
                  )}
                </div>
              )}
              {c.status === "accepted" && m?.status === "completed" && (
                <div style={{ marginTop:10, background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}30`, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ color:C.accentGold, fontWeight:700, fontSize:13 }}>✅ Mission terminée</div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── PRESTA TOUR ───────────────────────────────────────────────────
const PRESTA_TOUR_STEPS = [
  {
    icon:"👷",
    title:"Bienvenue sur ALANE !",
    desc:"ALANE vous connecte directement avec des clients qui ont besoin de vos compétences. Voici comment ça fonctionne.",
    color:"#7C6FE0",
  },
  {
    icon:"📋",
    title:"1. Complétez votre profil",
    desc:"Renseignez votre secteur, votre métier, vos disponibilités et votre IBAN. Un profil complet vous rend visible et rassure les clients.",
    color:"#4FC3F7",
  },
  {
    icon:"🔔",
    title:"2. Recevez des demandes",
    desc:"Un client vous choisit directement et vous envoie une demande de mission. Vous recevez une notification immédiate sur votre téléphone.",
    color:"#F0B429",
  },
  {
    icon:"⏱️",
    title:"3. Acceptez ou refusez",
    desc:"Vous avez 1 heure (mission du jour) ou 4 heures (autre jour) pour répondre. Sans réponse, la mission est automatiquement annulée.",
    color:"#F06292",
  },
  {
    icon:"💶",
    title:"4. Réalisez & soyez payé",
    desc:"Effectuez la mission, le client la valide, et vous êtes payé directement sur votre IBAN sous 3 à 5 jours ouvrés.",
    color:"#81C784",
  },
];

function PrestaTour({ onDone }) {
  const [step, setStep] = useState(0);
  const s = PRESTA_TOUR_STEPS[step];
  const isLast = step === PRESTA_TOUR_STEPS.length - 1;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(5,14,32,0.92)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 28px" }}>
      <div style={{ width:"100%", maxWidth:360, background:"#0D1B3E", borderRadius:24, overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", gap:6, justifyContent:"center", padding:"18px 0 0" }}>
          {PRESTA_TOUR_STEPS.map((_,i) => (
            <div key={i} style={{ width:i===step?22:7, height:7, borderRadius:4, background:i===step?s.color:"rgba(255,255,255,0.15)", transition:"all 0.3s" }} />
          ))}
        </div>
        <div style={{ textAlign:"center", padding:"24px 28px 0" }}>
          <div style={{ width:84, height:84, borderRadius:"50%", background:s.color+"20", border:`2px solid ${s.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>{s.icon}</div>
          <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 12px", fontFamily:font.display, lineHeight:1.2 }}>{s.title}</h2>
          <p style={{ color:"rgba(255,255,255,0.65)", fontSize:14, lineHeight:1.7, margin:0 }}>{s.desc}</p>
        </div>
        <div style={{ padding:"24px 28px 28px", display:"flex", gap:10 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"13px", border:"1px solid rgba(255,255,255,0.15)", borderRadius:14, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>← Précédent</button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(s=>s+1); }} style={{ flex:2, padding:"13px", border:"none", borderRadius:14, background:s.color, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            {isLast ? "C'est parti ! 🚀" : "Suivant →"}
          </button>
        </div>
        {!isLast && (
          <button onClick={onDone} style={{ display:"block", width:"100%", padding:"0 0 18px", background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Passer</button>
        )}
      </div>
    </div>
  );
}

// ── PRESTA DASHBOARD ──────────────────────────────────────────────
function PrestaDashboard({ onNavigate, activeScreen }) {
  const [tab,setTab]=useState("missions");
  const [userRib,setUserRib]=useState(null);
  const [ribMissionError,setRibMissionError]=useState(false);
  const [spotsLeft,setSpotsLeft]=useState(null);
  const [planActuel,setPlanActuel]=useState("free");
  const [userName,setUserName]=useState("");
  const [userStatus,setUserStatus]=useState(null);
  const [dispoRapide,setDispoRapide]=useState(true);
  const [showTour,setShowTour]=useState(false);
  const [statsData,setStatsData]=useState({missions:0,revenuMois:0,note:null,taux:null});
  const [completedMissions,setCompletedMissions]=useState([]);
  useEffect(()=>{
    if(activeScreen==="p_dashboard") setTab("profil");
    else if(activeScreen==="p_missions"||activeScreen==="p_home") setTab("missions");
  },[activeScreen]);
  useEffect(()=>{
    supabase.auth.getUser().then(async ({data})=>{
      const u=data?.user; if(!u) return;
      setUserRib(u.user_metadata?.rib||null);
      setPlanActuel(u.user_metadata?.plan_abonnement||"free");
      setDispoRapide(u.user_metadata?.dispo_immediat !== false);
      setUserName([u.user_metadata?.prenom,u.user_metadata?.nom].filter(Boolean).join(" ")||"Mon espace");
      const tourKey=`alane_presta_tour_done_${u.id}`;
      if(!localStorage.getItem(tourKey)) setShowTour(true);
      const [{data:prof},{data:mData},{data:rData}]=await Promise.all([
        supabase.from("profiles").select("status").eq("id",u.id).single(),
        supabase.from("missions").select("id,montant_total,tarif_horaire,nb_heures,date,sector,metier,titre,status").eq("prestataire_id",u.id).in("status",["assigned","completed","refused"]),
        supabase.from("ratings").select("rating").eq("reviewee_provider_id",u.id),
      ]);
      if(prof) setUserStatus(prof.status);
      const getAmt=m=>Number(m.montant_total||(m.tarif_horaire&&m.nb_heures?Number(m.tarif_horaire)*Number(m.nb_heures):0));
      const allM=Array.isArray(mData)?mData:[];
      const done=allM.filter(m=>m.status==="completed");
      const refused=allM.filter(m=>m.status==="refused");
      const som=new Date(new Date().getFullYear(),new Date().getMonth(),1);
      const doneMois=done.filter(m=>m.date&&new Date(m.date)>=som);
      const revenuMois=doneMois.reduce((s,m)=>s+getAmt(m),0);
      const rList=(Array.isArray(rData)?rData:[]).map(r=>r.rating).filter(Boolean);
      const avgNote=rList.length?(rList.reduce((a,b)=>a+b,0)/rList.length):null;
      const totalR=done.length+refused.length;
      const taux=totalR>0?Math.round((done.length/totalR)*100):null;
      setStatsData({missions:done.length,revenuMois:Math.round(revenuMois*100)/100,note:avgNote?avgNote.toFixed(1):null,taux:taux!==null?taux+"%":null});
      setCompletedMissions(done);
    });
    supabase.from("profiles").select("id",{count:"exact",head:true}).eq("role","prestataire").eq("status","approved")
      .then(({count})=>{ if(count!=null) setSpotsLeft(Math.max(0,100-count)); });
  },[]);

  const dismissTour = async () => {
    setShowTour(false);
    const {data} = await supabase.auth.getUser();
    const u = data?.user;
    if(u) localStorage.setItem(`alane_presta_tour_done_${u.id}`,"1");
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {showTour && <PrestaTour onDone={dismissTour} />}
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 28px", borderRadius:"0 0 26px 26px" }}>
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:18 }}>
          <div style={{ width:58, height:58, borderRadius:18, background:`${C.accent}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, border:"2px solid rgba(255,255,255,0.2)" }}>👨‍💼</div>
          <div style={{ flex:1 }}>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:11, margin:0 }}>Espace prestataire</p>
            <h2 style={{ color:C.white, fontSize:18, fontWeight:800, margin:"2px 0 5px" }}>{userName||"Mon espace"}</h2>
            <div style={{ display:"flex", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:userStatus==="approved"?C.success:userStatus==="rejected"?C.accent:C.accentGold }} />
              <span style={{ color:userStatus==="approved"?C.success:userStatus==="rejected"?C.accent:C.accentGold, fontSize:11, fontWeight:700 }}>{userStatus==="approved"?"Compte validé":userStatus==="rejected"?"Compte refusé":"En attente de validation"}</span>
            </div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          {[{l:"Missions",v:String(statsData.missions),i:"✅"},{l:"Ce mois",v:statsData.revenuMois>0?statsData.revenuMois+"€":"—",i:"💶"},{l:"Note",v:statsData.note?statsData.note+"★":"—",i:"⭐"},{l:"Taux",v:statsData.taux||"—",i:"📈"}].map(s=>(
            <div key={s.l} style={{ background:"rgba(255,255,255,0.1)", borderRadius:12, padding:"10px 6px", textAlign:"center" }}>
              <div style={{ fontSize:16 }}>{s.i}</div><div style={{ color:C.white, fontWeight:800, fontSize:12 }}>{s.v}</div><div style={{ color:"rgba(255,255,255,0.45)", fontSize:9 }}>{s.l}</div>
            </div>
          ))}
        </div>
        {/* Toggle disponibilité rapide */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.07)", borderRadius:12, padding:"10px 14px", marginTop:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:dispoRapide?C.success:"rgba(255,255,255,0.3)" }} />
            <span style={{ color:C.text, fontSize:12, fontWeight:600 }}>
              {dispoRapide ? "Disponible maintenant" : "Non disponible"}
            </span>
          </div>
          <button onClick={()=>{ const v=!dispoRapide; setDispoRapide(v); supabase.auth.updateUser({data:{dispo_immediat:v}}); }}
            style={{ width:44, height:24, borderRadius:12, border:"none", cursor:"pointer", position:"relative",
              background:dispoRapide?C.success:"rgba(255,255,255,0.15)", transition:"background 0.2s" }}>
            <div style={{ position:"absolute", top:3, left:dispoRapide?21:3, width:18, height:18, borderRadius:"50%",
              background:C.white, transition:"left 0.2s" }} />
          </button>
        </div>
        {(() => {
          const plan = ABONNEMENTS_PRESTA.find(p=>p.id===planActuel)||ABONNEMENTS_PRESTA[0];
          return (
            <div onClick={()=>onNavigate("abonnement_presta")} style={{ marginTop:10, display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.07)", borderRadius:12, padding:"8px 14px", cursor:"pointer" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:14 }}>{plan.icon}</span>
                <span style={{ color:plan.color, fontWeight:700, fontSize:12 }}>Plan {plan.label}</span>
                {plan.id==="free" && <span style={{ color:C.textMuted, fontSize:11 }}>· Upgrader →</span>}
              </div>
              <span style={{ color:C.textSub, fontSize:11 }}>Gérer ›</span>
            </div>
          );
        })()}
      </div>
      <div style={{ padding:"18px 18px 0" }}>
        {isLaunchPhase() && <LaunchBadge context="presta" spotsLeft={spotsLeft} />}
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:18 }}>
          {[{id:"missions",l:"Missions"},{id:"profil",l:"Profil"},{id:"docs",l:"Docs"},{id:"revenus",l:"Revenus"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"9px 4px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit", boxShadow:tab===t.id?"0 2px 8px rgba(0,0,0,0.1)":"none" }}>{t.l}</button>
          ))}
        </div>
        {tab==="missions" && <>
          <PrestaOnboardingChecklist onNavigate={onNavigate} />
          <UpgradeNudge onNavigate={onNavigate} />
          {(planActuel==="premium"||planActuel==="elite") && (
            <div style={{ background:`linear-gradient(135deg,${C.accent}15,${C.accentGold}10)`, border:`1px solid ${C.accent}44`, borderRadius:12, padding:"11px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:16 }}>⚡</span>
              <div>
                <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>Missions urgentes activées</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Vous êtes prioritaire sur les missions urgentes de votre secteur.</div>
              </div>
            </div>
          )}
          {ribMissionError && (
            <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:13, color:"#F25E5E", lineHeight:1.6 }}>
              🏦 <strong>IBAN / RIB manquant</strong><br/>Ajoutez votre IBAN dans vos réglages avant d'accepter une mission.
            </div>
          )}
          <p style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>🔔 Missions disponibles</p>
          <PMissionsTab onNavigate={onNavigate} />
        </>}
        {tab==="profil" && <PrestaProfilTab onNavigate={onNavigate} />}
        {tab==="docs" && <>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"11px 14px", marginBottom:14, fontSize:12 }}>⚠️ Certains documents doivent être renouvelés annuellement (attestation URSSAF, RC Pro).</div>
          {DOCS_REQUIS.map((doc,i)=>(
            <DocRowItem key={i} doc={doc} isValid={i<4} />
          ))}
        </>}
        {tab==="revenus" && (()=>{
          const getAmt=m=>Number(m.montant_total||(m.tarif_horaire&&m.nb_heures?Number(m.tarif_horaire)*Number(m.nb_heures):0));
          const total=completedMissions.reduce((s,m)=>s+getAmt(m),0);
          return <>
            {completedMissions.length===0 ? (
              <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:18, padding:"28px 16px", textAlign:"center", marginBottom:16 }}>
                <div style={{ fontSize:36, marginBottom:10 }}>💶</div>
                <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:6 }}>Aucun revenu pour le moment</div>
                <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vos revenus apparaîtront ici une fois vos premières missions complétées.</div>
              </div>
            ) : <>
              <div style={{ background:`linear-gradient(135deg,${C.success}22,${C.success}10)`, border:`1px solid ${C.success}44`, borderRadius:16, padding:"16px 18px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ color:C.textSub, fontSize:11, marginBottom:2 }}>Total gagné</div>
                  <div style={{ color:C.success, fontWeight:800, fontSize:22 }}>{total.toFixed(2).replace(".",",")} €</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:C.textSub, fontSize:11, marginBottom:2 }}>Missions</div>
                  <div style={{ color:C.text, fontWeight:800, fontSize:18 }}>{completedMissions.length}</div>
                </div>
              </div>
              {completedMissions.map(m=>{
                const sector=SECTORS.find(s=>s.id===m.sector);
                const amt=getAmt(m);
                return (
                  <div key={m.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:14, padding:"13px 14px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:11, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.titre||m.metier||sector?.label||"Mission"}</div>
                      <div style={{ color:C.textSub, fontSize:11 }}>📅 {m.date}{m.nb_heures?` · ${m.nb_heures}h`:""}</div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ color:C.success, fontWeight:800, fontSize:14 }}>{amt>0?amt.toFixed(2).replace(".",",")+" €":"—"}</div>
                      <div style={{ color:C.textMuted, fontSize:10 }}>Versé</div>
                    </div>
                  </div>
                );
              })}
            </>}
            <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"10px 14px", fontSize:12, color:C.text }}>
              💡 Ces montants correspondent à votre taux horaire net encaissé à chaque mission.
            </div>
          </>;
        })()}
      </div>
    </div>
  );
}

// ── NAV BARS ──────────────────────────────────────────────────────
function ClientNav({ active, onNavigate, unreadCount }) {
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
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {t.id==="search_filters" && unreadCount > 0 && (
                <div style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{unreadCount > 9 ? "9+" : unreadCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.violet:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.violet, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

function PrestaNav({ active, onNavigate, unreadCount }) {
  const tabs = [
    {id:"p_home",          icon:"🏠", label:"Accueil"   },
    {id:"p_missions",      icon:"📋", label:"Missions"  },
    {id:"abonnement_presta",icon:"⚡", label:"Abonnement"},
    {id:"p_dashboard",     icon:"👤", label:"Profil"    },
    {id:"settings",        icon:"⚙️", label:"Réglages"  },
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
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {t.id==="p_missions" && unreadCount > 0 && (
                <div style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{unreadCount > 9 ? "9+" : unreadCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.accent:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.accent, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

function CalendarScreen() {
  const DAYS_HEADER = ["L","M","M","J","V","S","D"];
  const DAYS_FULL   = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
  // dow: 0=Lundi … 6=Dimanche pour correspondre à JOURS
  const JOURS_TO_DOW = { "Lundi":0, "Mardi":1, "Mercredi":2, "Jeudi":3, "Vendredi":4, "Samedi":5, "Dimanche":6 };

  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [meta, setMeta]           = useState(null);
  const [missions, setMissions]   = useState([]);
  const [selected, setSelected]   = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if (!u) return;
      setMeta(u.user_metadata || {});
      // Charger les missions depuis la DB
      const { data: m } = await supabase
        .from("missions")
        .select("id,titre,client_nom,date_debut,date_fin,status,montant_total")
        .eq("prestataire_id", u.id)
        .in("status", ["assigned","open","completed"])
        .order("date_debut", { ascending: true });
      if (m) setMissions(m);
    });
  }, []);

  const prevMonth = () => {
    if(viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1); }
    else setViewMonth(m=>m-1);
  };
  const nextMonth = () => {
    if(viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1); }
    else setViewMonth(m=>m+1);
  };

  // Construire la grille du mois
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth+1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Lundi
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i+7));

  // Jours disponibles selon profil (par day-of-week)
  const availDow = new Set(
    (meta?.dispon_jours || []).map(j => JOURS_TO_DOW[j]).filter(x => x !== undefined)
  );

  // Missions sur ce mois
  const missionsByDay = {};
  missions.forEach(m => {
    if (!m.date_debut) return;
    const d = new Date(m.date_debut);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      if (!missionsByDay[day]) missionsByDay[day] = [];
      missionsByDay[day].push(m);
    }
  });

  const isToday = (d) => d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
  const dow = (d) => (new Date(viewYear, viewMonth, d).getDay() + 6) % 7;

  const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const moisLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  // Missions du mois sélectionné à afficher
  const moisMissions = missions.filter(m => {
    if (!m.date_debut) return false;
    const d = new Date(m.date_debut);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  const selectedMissions = selected ? (missionsByDay[selected] || []) : [];

  const statusColor = { assigned:C.violet, open:C.accentGold, completed:C.success };
  const statusLabel = { assigned:"Confirmée", open:"En attente", completed:"Terminée" };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>Planning</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Vos disponibilités et missions</p>
      </div>

      <div style={{ padding:"18px 18px 0" }}>
        {/* Légende disponibilités */}
        {meta && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:12, padding:"10px 14px", marginBottom:14, display:"flex", gap:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:3, background:`${C.violet}60` }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Disponible</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:3, background:C.violet }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Mission</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:C.accentGold }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Aujourd'hui</span>
            </div>
            {availDow.size === 0 && (
              <span style={{ color:C.accent, fontSize:11 }}>⚠️ Configurez vos disponibilités dans votre profil</span>
            )}
          </div>
        )}

        {/* Calendrier */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"18px", marginBottom:16, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <button onClick={prevMonth} style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", color:C.text, fontSize:16 }}>‹</button>
            <span style={{ fontWeight:800, color:C.text, fontSize:15 }}>{moisLabel}</span>
            <button onClick={nextMonth} style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", color:C.text, fontSize:16 }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, textAlign:"center", marginBottom:8 }}>
            {DAYS_HEADER.map((d,i)=><div key={i} style={{ color:C.textMuted, fontSize:11, fontWeight:700, paddingBottom:4 }}>{d}</div>)}
          </div>
          {weeks.map((week,wi)=>(
            <div key={wi} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
              {week.map((day,di)=>{
                if (!day) return <div key={di} />;
                const hasMission = !!missionsByDay[day];
                const isAvail = availDow.has(dow(day));
                const isTod = isToday(day);
                const isSel = selected === day;
                let bg = "transparent";
                if (hasMission) bg = C.violet;
                else if (isTod) bg = C.accentGold;
                else if (isAvail) bg = `${C.violet}28`;
                return (
                  <div key={di} onClick={()=>setSelected(isSel ? null : day)}
                    style={{ aspectRatio:"1", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:isTod||hasMission?800:500,
                      background: isSel ? `${C.violet}88` : bg,
                      color: hasMission||isTod ? C.white : isAvail ? C.violet : C.textSub,
                      cursor:"pointer", border: isSel ? `2px solid ${C.violet}` : "2px solid transparent",
                      position:"relative" }}>
                    {day}
                    {hasMission && <div style={{ position:"absolute", bottom:2, right:2, width:4, height:4, borderRadius:"50%", background:C.accentGold }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Détail jour sélectionné */}
        {selected && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.violet}44`, borderRadius:14, padding:"14px", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>
              {DAYS_FULL[dow(selected)]} {selected} {MONTH_NAMES[viewMonth]}
            </div>
            {selectedMissions.length > 0 ? selectedMissions.map((m,i) => (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderTop:i>0?`1px solid ${C.border}`:"none" }}>
                <div style={{ width:4, height:36, borderRadius:2, background:statusColor[m.status]||C.violet, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, color:C.text, fontSize:12 }}>{m.titre || "Mission"}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{m.client_nom || "Client"}</div>
                </div>
                <Badge color={statusColor[m.status]||C.violet} small>{statusLabel[m.status]||m.status}</Badge>
              </div>
            )) : (
              <div style={{ color:C.textMuted, fontSize:12 }}>
                {availDow.has(dow(selected)) ? "✅ Disponible — aucune mission prévue" : "❌ Non disponible selon vos préférences"}
              </div>
            )}
          </div>
        )}

        {/* Missions du mois */}
        {moisMissions.length > 0 ? (
          <>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>Missions de {MONTH_NAMES[viewMonth]}</div>
            {moisMissions.map((m,i) => {
              const d = new Date(m.date_debut);
              const label = `${DAYS_FULL[(d.getDay()+6)%7]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
              return (
                <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:4, height:44, borderRadius:2, background:statusColor[m.status]||C.violet, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.titre || "Mission"}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{m.client_nom || "Client"}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{label}</div>
                    <Badge color={statusColor[m.status]||C.violet} small>{statusLabel[m.status]||m.status}</Badge>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:14, padding:"28px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>📅</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Aucune mission ce mois</div>
            <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vos missions confirmées apparaîtront ici une fois planifiées.</div>
          </div>
        )}
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
    let mounted = true;
    const t1 = setTimeout(() => { if(mounted){ setProcessing(false); setDone(true); } }, 2200);
    const t2 = setTimeout(async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if(!mounted) return;
        const clientEmail = userData?.user?.email || null;
        const clientName  = userData?.user?.user_metadata?.prenom || userData?.user?.user_metadata?.nom || null;
        const mainProvider = providers[0] || {};
        await fetch("/api/booking-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientEmail,
            clientName,
            prestaName: mainProvider.name || null,
            job:        mainProvider.jobTitle || mainProvider.role || null,
            date:       null,
            hours:      null,
            total,
          }),
        });
      } catch (_) {}
      if(mounted) onSuccess && onSuccess();
    }, 3800);
    return () => { mounted=false; clearTimeout(t1); clearTimeout(t2); };
  }, [processing]);

  const handlePay = () => setProcessing(true);

  const formatCard = (v) => v.replace(/\D/g,"").slice(0,16).replace(/(.{4})/g,"$1 ").trim();
  const formatExp  = (v) => { const d=v.replace(/\D/g,"").slice(0,4); return d.length>2?d.slice(0,2)+"/"+d.slice(2):d; };

  if(done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, marginBottom:20 }}>✓</div>
      <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Paiement sécurisé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 24px" }}>
        <strong>{total} €</strong> placés en escrow ALANE.<br/>Libérés après validation de la mission.
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
              <div style={{ fontWeight:800, color:C.text, marginBottom:8 }}>Coordonnées bancaires ALANE</div>
              {[["IBAN","FR76 3000 4000 0100 0000 0000 123"],["BIC","BNPAFRPPXXX"],["Référence",`ALANE-${Date.now().toString().slice(-6)}`],["Montant",`${total} €`]].map(([l,v])=>(
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
function InvoiceScreen({ provider, amount, hours, missionId, onBack }) {
  const p = provider || PROVIDERS[0];
  const [invoiceNum] = useState(`ALANE-${new Date().getFullYear()}-${Math.floor(Math.random()*9000+1000)}`);
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
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
              <div style={{ fontSize:22, fontWeight:800, color:C.violet, fontFamily:font.display }}>ALANE</div>
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
            <div style={{ color:C.textSub, fontSize:11 }}>Virement effectué le {date} via ALANE Escrow</div>
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" full onClick={()=>{
            const content = [
              `FACTURE ${invoiceNum}`,
              `Émise le ${date}`,
              ``,
              `PRESTATAIRE : ${p.name} — ${p.role}`,
              `MISSION : ${hours||8}h — Tarif ${p.hourlyRate} HT`,
              `TOTAL TTC : ${ht} €`,
              `STATUT : Paiement reçu via ALANE Escrow`,
            ].join("\n");
            const blob = new Blob([content], { type:"text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href=url; a.download=`${invoiceNum}.txt`; a.click();
            URL.revokeObjectURL(url);
          }} style={{ fontSize:13, padding:"13px" }}>⬇️ Télécharger</Btn>
          <Btn full disabled={emailSending||emailSent} onClick={async()=>{
            setEmailSending(true);
            const { data:{ user } } = await supabase.auth.getUser();
            if(user?.email) {
              await fetch("/api/booking-confirm", {
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ clientEmail:user.email, clientName:user.user_metadata?.prenom||"", prestaName:p.name, job:p.role, hours:hours||8, total:ht }),
              }).catch(()=>{});
            }
            setEmailSending(false); setEmailSent(true);
          }} style={{ fontSize:13, padding:"13px" }}>
            {emailSent ? "✅ Envoyé" : emailSending ? "…" : "📧 Envoyer par email"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── GESTION DES ANNULATIONS ───────────────────────────────────────
function CancellationScreen({ provider, missionId, missionDate, onNavigate, onBack }) {
  const p = provider || PROVIDERS[0];
  const [step, setStep] = useState("policy"); // policy | confirm | replacement | done
  const [reason, setReason] = useState("");
  const [replacements, setReplacements] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  // Calcul réel du délai avant mission
  const missionTs = missionDate ? new Date(missionDate).getTime() : Date.now() + 18*3600000;
  const hoursLeft = Math.max(0, Math.floor((missionTs - Date.now()) / 3600000));
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
          ⚡ ALANE a trouvé <strong>{replacements.length} remplaçant{replacements.length>1?"s":""}</strong> disponible{replacements.length>1?"s":""} sur votre créneau
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
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:14 }}>📋 Politique d'annulation ALANE</div>
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
          <Btn variant="danger" disabled={!reason||cancelling} onClick={async()=>{
            setCancelling(true);
            if (missionId) {
              await supabase.from("missions").update({ status:"cancelled" }).eq("id", missionId).catch(()=>{});
            }
            setCancelling(false);
            setStep("replacement");
          }} style={{ flex:2, padding:"13px", fontSize:13 }}>
            {cancelling ? "…" : `Annuler ${penalty>0?`(−${penaltyAmount} €)`:""}`}
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
  const { providers: allRealProviders, loading: teamLoading } = useProviders();

  const filteredProviders = allRealProviders.filter(p =>
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

          {teamLoading ? (
            <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>
          ) : filteredProviders.length === 0 ? (
            <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"32px 20px", textAlign:"center" }}>
              <div style={{ fontSize:40, marginBottom:12 }}>👷</div>
              <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Aucun prestataire disponible</div>
              <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Des prestataires rejoignent la plateforme chaque semaine. Revenez bientôt !</div>
            </div>
          ) : filteredProviders.map(p => {
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
          <span style={{ padding:"4px 10px", fontSize:10, color:C.success, fontWeight:600 }}>✓ Validé</span>
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
          <button onClick={()=>setValidated(false)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:12, cursor:"default", fontFamily:"inherit" }}>👁️ {u.docs} doc{u.docs>1?"s":""}</button>
          {u.missing===0
            ? <button onClick={()=>{ if(window.confirm(`Valider le compte de ${u.name} ?`)) setValidated(true); }} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:C.success, color:C.white, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✓ Valider</button>
            : <button onClick={()=>setDocRequested(true)} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:docRequested?`${C.success}22`:`${C.accentGold}22`, color:docRequested?C.success:C.warning, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{docRequested?"✓ Envoyé":"⚠️ Demander docs"}</button>}
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
      {!done && <button onClick={()=>setDone(true)} style={{ padding:"7px 12px", borderRadius:10, border:"none", background:`${a.color}18`, color:a.color, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Traiter</button>}
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
          <div style={{ flex:1, padding:"8px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:11, fontFamily:"inherit" }}>💶 {l.montant} · {l.client}</div>
          <button onClick={()=>{ if(window.confirm(`Résoudre "${l.motif}" ?`)) setStatus("resolved"); }} style={{ flex:1, padding:"8px", borderRadius:10, border:"none", background:`${C.success}18`, color:C.success, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✓ Résoudre</button>
          <button onClick={()=>{ if(window.confirm(`Rembourser ${l.montant} ?`)) setStatus("refunded"); }} style={{ flex:1, padding:"8px", borderRadius:10, border:"none", background:`${C.danger}18`, color:C.danger, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>↩ Rembourser</button>
        </div>
      )}
      {status!=="pending" && <div style={{ textAlign:"center", fontSize:12, color:status==="resolved"?C.success:C.accentGold, fontWeight:700 }}>{status==="resolved"?"✅ Résolu":"↩ Remboursé"}</div>}
    </div>
  );
}

// ── BACKOFFICE ────────────────────────────────────────────────────
// Mot de passe vérifié côté serveur via /api/bo-verify-pin (variable BO_PIN dans Vercel)

// Helper centralisé pour tous les appels BO — injecte automatiquement le token signé
function boFetch(body) {
  const token = sessionStorage.getItem("bo_token") || "";
  return fetch("/api/bo-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function useBoData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    boFetch({ action: "stats" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { data, loading };
}

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
      <text x={cx} y={cy-6}  textAnchor="middle" fontSize="14" fontWeight="900" fill="#1A1F36">{sectors.reduce((a,s)=>a+s.missions,0)||""}</text>
      <text x={cx} y={cy+10} textAnchor="middle" fontSize="9"  fill="#8A93A8">missions</text>
    </svg>
  );
};

function BackofficeLogin({ onLogin, onBack }) {
  const [pwd, setPwd]           = useState("");
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState(false);
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const locked = attempts >= 5;

  const handleSubmit = () => {
    if (!pwd.trim() || checking || locked) return;
    setChecking(true);
    fetch("/api/bo-verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pwd }),
    })
      .then(r => r.json())
      .then(j => {
        setChecking(false);
        if (j.ok) { sessionStorage.setItem("bo_token", j.token || ""); onLogin(); }
        else { setError(true); setPwd(""); setAttempts(a => a + 1); }
      })
      .catch(() => { setChecking(false); setError(true); setPwd(""); setAttempts(a => a + 1); });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#1E3A7B)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, position:"relative" }}>
      <button onClick={onBack} style={{ position:"absolute", top:54, left:22, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>

      <div style={{ width:72, height:72, borderRadius:22, background:`${C.violet}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, marginBottom:20, border:`2px solid ${C.violet}66` }}>⚙️</div>
      <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 6px", fontFamily:font.display }}>Backoffice ALANE</h2>
      <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, margin:"0 0 36px" }}>Accès administrateur uniquement</p>

      {locked && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>Accès bloqué — trop de tentatives</p>}
      {!locked && error && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>Mot de passe incorrect — Réessayez</p>}
      {!locked && !error && <p style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginBottom:16 }}>{checking ? "Vérification…" : "Entrez votre mot de passe"}</p>}

      <div style={{ width:"100%", maxWidth:320, position:"relative", marginBottom:16 }}>
        <input
          type={show ? "text" : "password"}
          value={pwd}
          onChange={e => { setPwd(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          disabled={locked || checking}
          placeholder="Mot de passe administrateur"
          autoComplete="current-password"
          style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.08)", border:`2px solid ${error ? C.danger : "rgba(255,255,255,0.15)"}`, borderRadius:14, padding:"15px 48px 15px 18px", color:C.white, fontSize:16, fontFamily:"inherit", outline:"none", transition:"border-color 0.2s" }}
        />
        <button onClick={() => setShow(s => !s)} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:18, lineHeight:1 }}>
          {show ? "🙈" : "👁️"}
        </button>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!pwd.trim() || locked || checking}
        style={{ width:"100%", maxWidth:320, padding:"15px", borderRadius:14, border:"none", background: (!pwd.trim() || locked || checking) ? "rgba(124,111,224,0.3)" : C.violet, color:C.white, fontSize:16, fontWeight:800, cursor: (!pwd.trim() || locked || checking) ? "default" : "pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
        {checking ? "Vérification…" : "Accéder au backoffice →"}
      </button>
    </div>
  );
}

function BOComptes() {
  const [profiles, setProfiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("pending");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actioning, setActioning] = useState(null);
  const [expanded, setExpanded]   = useState(null);
  const [verifs, setVerifs]       = useState({});
  const [verifying, setVerifying] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // { profileId, name, email }
  const [deleteReason, setDeleteReason] = useState("");

  const handleVerify = async (p) => {
    setVerifying(p.id);
    try {
      const res = await fetch("/api/verify-docs", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ iban: p.rib||"", siret: p.kbis||"" }),
      });
      const data = await res.json();
      setVerifs(v => ({ ...v, [p.id]: data }));
    } catch(e) {
      setVerifs(v => ({ ...v, [p.id]: { error: "Erreur réseau" } }));
    }
    setVerifying(null);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await boFetch({ action:"list" });
      const data = await res.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch(e) { setProfiles([]); }
    setLoading(false);
  };

  useEffect(()=>{ load(); },[]);

  const handleAction = async (profileId, action, reason) => {
    setActioning(profileId+action);
    await boFetch({ action, profileId, reason });
    setActioning(null);
    load();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal) return;
    await handleAction(deleteModal.profileId, "delete", deleteReason.trim());
    setDeleteModal(null);
    setDeleteReason("");
  };

  const statusColor = { pending:"#FCD34D", approved:C.success, rejected:"#F25E5E" };
  const statusLabel = { pending:"En attente", approved:"Approuvé", rejected:"Refusé" };
  const filtered = profiles.filter(p =>
    (filter==="all" || p.status===filter) &&
    (roleFilter==="all" || p.role===roleFilter)
  );

  return (
    <div style={{ padding:"16px 18px" }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Validation des comptes</h3>

      {/* Filtre statut */}
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        {[["pending","⏳ En attente"],["approved","✅ Approuvés"],["rejected","❌ Refusés"],["all","Tous"]].map(([val,label])=>(
          <button key={val} onClick={()=>setFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${filter===val?C.violet:"rgba(255,255,255,0.15)"}`, background:filter===val?`${C.violet}33`:"transparent", color:filter===val?C.violet:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:filter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>

      {/* Filtre rôle */}
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["all","👥 Tous"],["client","🏢 Clients"],["prestataire","👷 Prestataires"]].map(([val,label])=>(
          <button key={val} onClick={()=>setRoleFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${roleFilter===val?"#FCD34D":"rgba(255,255,255,0.1)"}`, background:roleFilter===val?"rgba(252,211,77,0.12)":"transparent", color:roleFilter===val?"#FCD34D":"rgba(255,255,255,0.4)", fontSize:11, fontWeight:roleFilter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.4)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", padding:"32px 0", fontSize:13 }}>Aucun compte dans cette catégorie</div>
      ) : filtered.map(p => (
        <div key={p.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:C.white, fontWeight:700, fontSize:14 }}>
                {p.prenom||p.nom ? `${p.prenom||""} ${p.nom||""}`.trim() : "Nom non renseigné"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {p.email || "Email non disponible"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginTop:2 }}>
                {p.role==="prestataire"?"👷 Prestataire":"🏢 Client"} · {new Date(p.created_at).toLocaleDateString("fr-FR")}
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <div style={{ background:`${statusColor[p.status]||"#888"}22`, border:`1px solid ${statusColor[p.status]||"#888"}55`, borderRadius:8, padding:"3px 10px", color:statusColor[p.status]||"#888", fontSize:11, fontWeight:700 }}>
                {statusLabel[p.status]||p.status}
              </div>
              <button onClick={()=>setExpanded(expanded===p.id?null:p.id)} style={{ fontSize:10, color:"rgba(255,255,255,0.3)", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                {expanded===p.id?"▲ Masquer":"▼ Détails"}
              </button>
            </div>
          </div>

          {/* Détails étendus */}
          {expanded===p.id && (
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"12px", marginBottom:10, fontSize:12 }}>
              {p.telephone && <div style={{ marginBottom:6 }}><span style={{ color:"rgba(255,255,255,0.4)" }}>📱 Tél : </span><span style={{ color:C.white }}>{p.telephone}</span></div>}
              {p.rib && <div style={{ marginBottom:6 }}><span style={{ color:"rgba(255,255,255,0.4)" }}>🏦 IBAN : </span><span style={{ color:C.white, fontWeight:600, fontFamily:"monospace" }}>{p.rib}</span></div>}
              {p.type_compte && <div style={{ marginBottom:6 }}><span style={{ color:"rgba(255,255,255,0.4)" }}>👤 Type : </span><span style={{ color:C.white }}>{p.type_compte==="professionnel"?"Professionnel":"Particulier"}</span></div>}
              {p.societe_nom && <div style={{ marginBottom:6 }}><span style={{ color:"rgba(255,255,255,0.4)" }}>🏢 Société : </span><span style={{ color:C.white }}>{p.societe_nom}</span></div>}
              {p.kbis && <div style={{ marginBottom:6 }}><span style={{ color:"rgba(255,255,255,0.4)" }}>📄 KBIS/SIRET : </span><span style={{ color:C.white }}>{p.kbis}</span></div>}
              {!p.telephone && !p.rib && !p.societe_nom && !p.kbis && <div style={{ color:"rgba(255,255,255,0.3)" }}>Aucune donnée supplémentaire</div>}

              {/* Bouton vérification */}
              {(p.rib || p.kbis) && (
                <div style={{ marginTop:10 }}>
                  <button onClick={()=>handleVerify(p)} disabled={verifying===p.id} style={{ padding:"7px 14px", borderRadius:10, border:"1px solid rgba(124,111,224,0.4)", background:"rgba(124,111,224,0.1)", color:C.violet, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:verifying===p.id?0.6:1 }}>
                    {verifying===p.id ? "Vérification…" : "🔍 Vérifier les documents"}
                  </button>
                  {verifs[p.id] && (
                    <div style={{ marginTop:10, fontSize:12, lineHeight:1.8 }}>
                      {verifs[p.id].iban && (
                        <div style={{ marginBottom:4 }}>
                          <span style={{ color:verifs[p.id].iban.valid ? C.success : "#F25E5E", fontWeight:700 }}>
                            {verifs[p.id].iban.valid ? "✅" : "❌"} IBAN
                          </span>
                          {!verifs[p.id].iban.valid && <span style={{ color:"#F25E5E", marginLeft:6 }}>{verifs[p.id].iban.error}</span>}
                          {verifs[p.id].iban.valid && <span style={{ color:C.success, marginLeft:6 }}>Valide</span>}
                        </div>
                      )}
                      {verifs[p.id].siret && (
                        <div>
                          <span style={{ color:verifs[p.id].siret.valid && verifs[p.id].siret.exists !== false ? C.success : "#F25E5E", fontWeight:700 }}>
                            {verifs[p.id].siret.valid && verifs[p.id].siret.exists !== false ? "✅" : "❌"} SIRET
                          </span>
                          {verifs[p.id].siret.error && <span style={{ color:"#F25E5E", marginLeft:6 }}>{verifs[p.id].siret.error}</span>}
                          {verifs[p.id].siret.nom && <span style={{ color:C.success, marginLeft:6 }}>{verifs[p.id].siret.nom}</span>}
                          {verifs[p.id].siret.statut && <span style={{ color:verifs[p.id].siret.actif ? C.success : "#F25E5E", marginLeft:6 }}>— {verifs[p.id].siret.statut}</span>}
                          {verifs[p.id].siret.siege && <span style={{ color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({verifs[p.id].siret.siege})</span>}
                          {verifs[p.id].siret.apiError && <span style={{ color:"rgba(255,255,255,0.3)", marginLeft:6 }}>{verifs[p.id].siret.apiError}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {p.status==="pending" && <>
              <button onClick={()=>handleAction(p.id,"approve")} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:`${C.success}22`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning===p.id+"approve" ? "…" : "✅ Approuver"}
              </button>
              <button onClick={()=>handleAction(p.id,"reject")} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:"rgba(242,94,94,0.12)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning===p.id+"reject" ? "…" : "❌ Refuser"}
              </button>
            </>}
            <button onClick={()=>{ setDeleteReason(""); setDeleteModal({ profileId:p.id, name:`${p.prenom||""} ${p.nom||""}`.trim()||p.email, email:p.email }); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"transparent", color:"rgba(242,94,94,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
              {actioning===p.id+"delete" ? "…" : "🗑️"}
            </button>
          </div>
        </div>
      ))}

      {deleteModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:24, width:"100%", maxWidth:400, border:"1px solid rgba(242,94,94,0.3)" }}>
            <h3 style={{ color:"#F25E5E", fontSize:15, fontWeight:800, margin:"0 0 8px" }}>Supprimer le compte</h3>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:"0 0 16px" }}>
              Vous allez supprimer définitivement le compte de <strong style={{ color:"#fff" }}>{deleteModal.name}</strong>. Un email sera envoyé à cette personne.
            </p>
            <label style={{ color:"rgba(255,255,255,0.5)", fontSize:12, fontWeight:600, display:"block", marginBottom:6 }}>RAISON (optionnelle)</label>
            <textarea
              value={deleteReason}
              onChange={e=>setDeleteReason(e.target.value)}
              placeholder="Ex : documents non conformes, comportement inapproprié..."
              style={{ width:"100%", minHeight:80, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"10px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }}
            />
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={()=>setDeleteModal(null)} style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={handleDeleteConfirm} disabled={!!actioning} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning ? "…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BOSupport() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("open");
  const [actioning, setActioning] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await boFetch({ action:"list_tickets" });
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch { setTickets([]); }
    setLoading(false);
  };

  useEffect(()=>{ load(); },[]);

  const closeTicket = async (id) => {
    setActioning(id);
    await boFetch({ action:"close_ticket", profileId:id });
    setActioning(null);
    load();
  };

  const deleteTicket = async (id) => {
    setActioning(id + "_del");
    await boFetch({ action:"delete_ticket", profileId:id });
    setActioning(null);
    load();
  };

  const filtered = tickets.filter(t => filter==="all" || t.status===filter);

  return (
    <div style={{ padding:"16px 18px" }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Tickets support</h3>
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["open","🔴 Ouverts"],["closed","✅ Fermés"],["all","Tous"]].map(([val,label])=>(
          <button key={val} onClick={()=>setFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${filter===val?C.violet:"rgba(255,255,255,0.15)"}`, background:filter===val?`${C.violet}33`:"transparent", color:filter===val?C.violet:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:filter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.4)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", padding:"32px 0", fontSize:13 }}>Aucun ticket</div>
      ) : filtered.map(t => (
        <div key={t.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div>
              <div style={{ color:C.white, fontWeight:700, fontSize:13 }}>{t.subject}</div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11, marginTop:2 }}>{t.user_name||"Anonyme"} · {t.user_email||""}</div>
              <div style={{ color:"rgba(255,255,255,0.25)", fontSize:10, marginTop:2 }}>{new Date(t.created_at).toLocaleString("fr-FR")}</div>
            </div>
            <div style={{ background:t.status==="open"?"rgba(242,94,94,0.15)":"rgba(34,197,94,0.1)", border:`1px solid ${t.status==="open"?"rgba(242,94,94,0.4)":"rgba(34,197,94,0.3)"}`, borderRadius:8, padding:"3px 10px", color:t.status==="open"?"#F25E5E":C.success, fontSize:10, fontWeight:700 }}>
              {t.status==="open"?"Ouvert":"Fermé"}
            </div>
          </div>
          <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12, lineHeight:1.6, marginBottom:t.status==="open"?10:0, background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"10px" }}>
            {t.message}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            {t.status==="open" && (
              <button onClick={()=>closeTicket(t.id)} disabled={!!actioning} style={{ padding:"8px 16px", borderRadius:10, border:"none", background:`${C.success}22`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning===t.id?0.5:1 }}>
                {actioning===t.id?"…":"✅ Marquer résolu"}
              </button>
            )}
            <button onClick={()=>deleteTicket(t.id)} disabled={!!actioning} style={{ padding:"8px 14px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"rgba(242,94,94,0.08)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning===t.id+"_del"?0.5:1 }}>
              {actioning===t.id+"_del"?"…":"🗑 Supprimer"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BOModerationTab({ d }) {
  const [suspendEmail, setSuspendEmail]   = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending]       = useState(false);
  const [suspendResult, setSuspendResult] = useState(null);
  const [commMsg, setCommMsg]             = useState("");
  const [commSending, setCommSending]     = useState(false);
  const [commResult, setCommResult]       = useState(null);
  const [lastSync, setLastSync]           = useState(null);

  const handleSuspend = async () => {
    if(!suspendEmail.trim()) return;
    setSuspending(true); setSuspendResult(null);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      const user = (Array.isArray(users)?users:[]).find(u=>u.email===suspendEmail.trim());
      if(!user) { setSuspendResult({ ok:false, msg:"Email introuvable" }); setSuspending(false); return; }
      const r2 = await boFetch({ action:"reject", profileId: user.id });
      const j = await r2.json();
      setSuspendResult(j.success ? { ok:true, msg:`Compte ${suspendEmail} suspendu.` } : { ok:false, msg:"Erreur lors de la suspension" });
      if(j.success) { setSuspendEmail(""); setSuspendReason(""); }
    } catch(e) { setSuspendResult({ ok:false, msg:"Erreur réseau" }); }
    setSuspending(false);
  };

  const handleComm = async () => {
    if(!commMsg.trim()) return;
    setCommSending(true); setCommResult(null);
    try {
      const r = await boFetch({ action:"send_global_comm", message: commMsg });
      const j = await r.json();
      setCommResult(j.success ? { ok:true, msg:"Communication envoyée à tous les prestataires actifs." } : { ok:false, msg:"Erreur lors de l'envoi" });
      if(j.success) setCommMsg("");
    } catch { setCommResult({ ok:false, msg:"Erreur réseau" }); }
    setCommSending(false);
    setTimeout(()=>setCommResult(null), 4000);
  };

  const handleSync = () => setLastSync(new Date().toLocaleTimeString("fr-FR"));

  return (
    <>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>🚨 Alertes actives</div>
      {d.users.pending > 0 && <AlertRow a={{ icon:"📋", text:`${d.users.pending} compte(s) en attente de validation`, color:"#F39C12", urgent:true }} />}
      {d.tickets?.open > 0 && <AlertRow a={{ icon:"🎧", text:`${d.tickets.open} ticket(s) support non traités`, color:"#E74C3C", urgent:true }} />}
      {d.users.pending === 0 && !d.tickets?.open && <div style={{ color:C.textMuted, fontSize:12, textAlign:"center", padding:"12px 0" }}>✅ Aucune alerte active</div>}

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🔒 Suspendre un compte</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <input value={suspendEmail} onChange={e=>setSuspendEmail(e.target.value)} placeholder="Email du compte à suspendre"
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", marginBottom:8 }} />
        <input value={suspendReason} onChange={e=>setSuspendReason(e.target.value)} placeholder="Raison (optionnel)"
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", marginBottom:10 }} />
        <button onClick={handleSuspend} disabled={suspending||!suspendEmail.trim()}
          style={{ padding:"10px 20px", borderRadius:10, border:"none", background:C.danger, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:suspending||!suspendEmail.trim()?0.5:1 }}>
          {suspending?"Suspension…":"🔒 Suspendre"}
        </button>
        {suspendResult && <div style={{ marginTop:8, fontSize:12, color:suspendResult.ok?C.success:C.accent, fontWeight:600 }}>{suspendResult.ok?"✅":"❌"} {suspendResult.msg}</div>}
      </div>

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>📧 Communication globale</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <textarea value={commMsg} onChange={e=>setCommMsg(e.target.value)} placeholder="Message à envoyer à tous les prestataires actifs…" rows={3}
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical", marginBottom:10 }} />
        <button onClick={handleComm} disabled={commSending||!commMsg.trim()}
          style={{ padding:"10px 20px", borderRadius:10, border:"none", background:C.violet, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:commSending||!commMsg.trim()?0.5:1 }}>
          {commSending?"Envoi…":"📧 Envoyer"}
        </button>
        {commResult && <div style={{ marginTop:8, fontSize:12, color:commResult.ok?C.success:C.accent, fontWeight:600 }}>{commResult.ok?"✅":"❌"} {commResult.msg}</div>}
      </div>

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🔧 Outils</div>
      <div onClick={handleSync} style={{ background:"#0D1B3E", borderRadius:13, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
        onMouseEnter={e=>e.currentTarget.style.transform="translateX(4px)"}
        onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}>
        <div style={{ width:38, height:38, borderRadius:11, background:`${C.indigo}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🔄</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>Synchroniser les données</div>
          {lastSync && <div style={{ color:C.textMuted, fontSize:11 }}>Dernier sync : {lastSync}</div>}
        </div>
        <span style={{ color:C.textSub, fontSize:16 }}>›</span>
      </div>
    </>
  );
}

function BOExportCSV({ d }) {
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      const rows = [["ID","Prénom","Nom","Email","Rôle","Statut","Téléphone","IBAN","Type compte","Société","Créé le"]];
      (Array.isArray(users) ? users : []).forEach(u => {
        rows.push([u.id,u.prenom||"",u.nom||"",u.email||"",u.role||"",u.status||"",u.telephone||"",u.rib||"",u.type_compte||"",u.societe_nom||"",u.created_at?.slice(0,10)||""]);
      });
      const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `alane-comptes-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch(_) {}
    setExporting(false);
  };
  return (
    <button onClick={doExport} disabled={exporting} style={{ flex:1, padding:"13px", borderRadius:r, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:exporting?0.7:1 }}>
      {exporting?"⏳ Export…":"📊 Export CSV"}
    </button>
  );
}

function BOExportPDF({ d }) {
  const doPDF = () => {
    const lines = [
      "RAPPORT FINANCIER ALANE",
      `Généré le : ${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "── UTILISATEURS ──",
      `Clients : ${d.users?.clients || 0}`,
      `Prestataires : ${d.users?.prestataires || 0}`,
      `Total : ${d.users?.total || 0}`,
      `En attente validation : ${d.users?.pending || 0}`,
      "",
      "── MISSIONS ──",
      `Total : ${d.missions?.total || 0}`,
      `Ouvertes : ${d.missions?.open || 0}`,
      `Assignées : ${d.missions?.assigned || 0}`,
      `Terminées : ${d.missions?.terminees || 0}`,
      `Taux completion : ${d.missions?.tauxCompletion || 0}%`,
      "",
      "── FINANCE ──",
      `CA Total (missions terminées) : ${d.finance?.caTotal || 0} €`,
      "",
      "── TICKETS SUPPORT ──",
      `Ouverts : ${d.tickets?.open || 0}`,
      `Total : ${d.tickets?.total || 0}`,
    ];
    const blob = new Blob([lines.join("\n")], { type:"text/plain;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `alane-rapport-${new Date().toISOString().slice(0,10)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <button onClick={doPDF} style={{ flex:1, padding:"13px", borderRadius:r, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
      📄 Rapport
    </button>
  );
}

function EmailTestButton() {
  const [status, setStatus] = useState("idle"); // idle | sending | ok | error
  const send = async () => {
    setStatus("sending");
    try {
      const r = await boFetch({ action:"send_test_email" });
      const j = await r.json();
      setStatus(j.success ? "ok" : "error");
    } catch { setStatus("error"); }
    setTimeout(()=>setStatus("idle"), 4000);
  };
  return (
    <button onClick={send} disabled={status==="sending"} style={{ padding:"10px 20px", borderRadius:r, border:"none", background:status==="ok"?C.success:status==="error"?"#E74C3C":C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:status==="sending"?0.7:1 }}>
      {status==="sending"?"Envoi…":status==="ok"?"✅ Envoyé !":status==="error"?"❌ Erreur":"Envoyer email test"}
    </button>
  );
}

function BOTest({ onNavigate }) {
  const MOCK_P = {
    id:"bo-test-001", name:"Jean Demo", jobTitle:"Agent de démonstration", role:"Agent de démonstration",
    avatar:"🧪", color:C.violet, rating:4.8, reviews:42, hourlyRate:"20 €/h HT", rateNum:20, tarifNet:15,
    available:true, sector:"logistique", skills:["Test","Démo","Présentation"], experience:"5 ans",
    distance:"0,5 km", responseTime:"~2 min", missions:42, bio:"Prestataire fictif pour les tests BO.",
  };

  const clientScreens = [
    { id:"home",              label:"Accueil client",          icon:"🏠" },
    { id:"catalogue",         label:"Catalogue secteurs",      icon:"🗂️" },
    { id:"search_filters",    label:"Recherche / filtres",     icon:"🔍" },
    { id:"dashboard",         label:"Dashboard client",        icon:"📊" },
    { id:"mission_history",   label:"Historique missions",     icon:"📋" },
    { id:"cashback",          label:"Wallet cashback",         icon:"💰" },
    { id:"notifications",     label:"Notifications",           icon:"🔔" },
    { id:"favorites",         label:"Favoris",                 icon:"❤️" },
    { id:"mission_request",   label:"Créer une mission",       icon:"➕" },
    { id:"team_booking",      label:"Réservation équipe",      icon:"👥" },
    { id:"settings",          label:"Paramètres",              icon:"⚙️" },
  ];

  const clientFlowScreens = [
    { id:"profile",     label:"Profil prestataire",   icon:"👤", data:MOCK_P },
    { id:"cv",          label:"CV prestataire",        icon:"📄", data:MOCK_P },
    { id:"booking",     label:"Réservation",           icon:"📅", data:MOCK_P },
    { id:"contract",    label:"Contrat",               icon:"✍️", data:MOCK_P },
    { id:"tracking",    label:"Suivi mission",         icon:"📍", data:MOCK_P },
    { id:"validation",  label:"Validation mission",    icon:"✅", data:MOCK_P },
    { id:"rating",      label:"Noter le prestataire",  icon:"⭐", data:MOCK_P },
    { id:"cancellation",label:"Annulation",            icon:"❌", data:MOCK_P },
    { id:"invoice",     label:"Facture",               icon:"🧾", data:MOCK_P },
    { id:"payslip",     label:"Fiche de paie",         icon:"💶", data:MOCK_P },
  ];

  const prestaScreens = [
    { id:"p_home",              label:"Accueil prestataire",  icon:"🏠" },
    { id:"p_missions",          label:"Missions disponibles", icon:"📦" },
    { id:"p_dashboard",         label:"Dashboard presta",     icon:"📊" },
    { id:"calendar",            label:"Calendrier",           icon:"📅" },
    { id:"abonnement_presta",   label:"Abonnement",           icon:"💳" },
    { id:"doc_upload",          label:"Documents",            icon:"📎" },
    { id:"presta_profile_edit", label:"Modifier profil",      icon:"✏️" },
  ];

  const sharedScreens = [
    { id:"faq",             label:"FAQ",                  icon:"❓" },
    { id:"legal",           label:"Mentions légales",     icon:"📜" },
    { id:"contact_support", label:"Support",              icon:"🎧" },
    { id:"referral",        label:"Parrainage",           icon:"🎁" },
    { id:"abonnement_presta",label:"Abonnement presta",  icon:"💎" },
  ];

  const NavBtn = ({ s, role }) => (
    <button onClick={()=>onNavigate(s.id, role, s.data||null)} style={{
      display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
      background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:10,
      color:C.text, fontSize:12, cursor:"pointer", fontFamily:"inherit",
      fontWeight:500, textAlign:"left", width:"100%",
    }}>
      <span style={{ fontSize:15 }}>{s.icon}</span>
      <span style={{ flex:1 }}>{s.label}</span>
      <span style={{ fontSize:10, color:C.textMuted, fontFamily:"monospace" }}>{s.id} →</span>
    </button>
  );

  const Section = ({ title, color, screens, role, note }) => (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontWeight:700, fontSize:12, color, marginBottom:6, display:"flex", alignItems:"center", gap:6, textTransform:"uppercase", letterSpacing:0.8 }}>
        <div style={{ width:3, height:12, background:color, borderRadius:2 }} />
        {title}
        {note && <span style={{ fontSize:10, color:C.textMuted, fontWeight:400, textTransform:"none", letterSpacing:0 }}>— {note}</span>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {screens.map(s => <NavBtn key={s.id+s.label} s={s} role={role} />)}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:12, padding:"12px 14px", marginBottom:18 }}>
        <div style={{ fontWeight:700, color:C.violet, fontSize:13, marginBottom:4 }}>🧪 Mode test</div>
        <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5 }}>
          Navigue vers n'importe quel écran sans compte. Les écrans du flux utilisent un prestataire fictif "Jean Demo".
        </div>
      </div>

      <Section title="Écrans client — navigation" color="#F0B429" screens={clientScreens} role="client" />
      <Section title="Flux client — avec prestataire" color="#F0B429" screens={clientFlowScreens} role="client" note="prestataire fictif injecté" />
      <Section title="Écrans prestataire" color={C.violet} screens={prestaScreens} role="prestataire" />
      <Section title="Écrans partagés" color={C.success} screens={sharedScreens} role="client" />

      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginTop:4 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:6 }}>📧 Test email</div>
        <p style={{ color:C.textSub, fontSize:12, margin:"0 0 12px" }}>Envoie un email test à direction@alane.fr pour vérifier Resend.</p>
        <EmailTestButton />
      </div>
    </div>
  );
}

function BackofficeDashboard({ onBack, onNavigate }) {
  const [tab, setTab] = useState("dashboard");
  const { data: boData, loading: boLoading } = useBoData();
  const d = boData || {
    users:    { clients:0, prestataires:0, total:0, pending:0 },
    missions: { total:0, open:0, assigned:0, terminees:0, closed:0, tauxCompletion:0 },
    finance:  { caTotal:0 },
    tickets:  { open:0, total:0 },
    sectors:  [],
    recentUsers: [],
  };

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
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 2px", fontFamily:font.display }}>⚙️ Backoffice ALANE</h2>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>Tableau de bord · Temps réel</p>
          </div>
          <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>● Actif</div>
        </div>
      </div>

      {/* Layout : sidebar gauche + contenu */}
      <div style={{ display:"flex", gap:0, padding:"18px 14px", alignItems:"flex-start" }}>

        {/* Sidebar onglets */}
        <div style={{ width:130, flexShrink:0, display:"flex", flexDirection:"column", gap:4, marginRight:14, position:"sticky", top:18 }}>
          {[
            {id:"dashboard",  l:"📊 KPIs"},
            {id:"comptes",    l:"✅ Comptes"},
            {id:"support",    l:"🎧 Support"},
            {id:"sectors",    l:"🗂️ Secteurs"},
            {id:"users",      l:"👥 Utilisateurs"},
            {id:"finance",    l:"💶 Finance"},
            {id:"moderation", l:"⚠️ Modération"},
            {id:"test",       l:"🧪 Test"},
          ].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"10px 10px", border:"none",
              borderRadius:10,
              borderLeft:`3px solid ${tab===t.id?C.violet:"transparent"}`,
              background: tab===t.id ? `${C.violet}18` : "transparent",
              color: tab===t.id ? C.violet : C.gray,
              fontWeight: tab===t.id ? 700 : 500,
              fontSize:12, cursor:"pointer", fontFamily:"inherit",
              textAlign:"left", transition:"all 0.15s",
              whiteSpace:"nowrap",
            }}>{t.l}</button>
          ))}
        </div>

        {/* Contenu */}
        <div style={{ flex:1, minWidth:0 }}>

        {/* ── COMPTES ── */}
        {tab==="comptes" && <BOComptes />}

        {/* ── SUPPORT ── */}
        {tab==="support" && <BOSupport />}

        {/* ── TEST ── */}
        {tab==="test" && <BOTest onNavigate={onNavigate} />}

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && <>
          {boLoading && <div style={{ textAlign:"center", color:C.textSub, fontSize:13, padding:"30px 0" }}>Chargement des données…</div>}

          {/* Alertes dynamiques */}
          {d.users.pending > 0 && (
            <div style={{ background:"#F39C1215", border:"1px solid #F39C1244", borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>📋</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1 }}>{d.users.pending} compte{d.users.pending>1?"s":""} en attente de validation</span>
              <span style={{ color:"#F39C12", fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={()=>setTab("comptes")}>Traiter →</span>
            </div>
          )}
          {d.tickets?.open > 0 && (
            <div style={{ background:"#E74C3C15", border:"1px solid #E74C3C44", borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>🎧</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1 }}>{d.tickets.open} ticket{d.tickets.open>1?"s":""} support ouverts</span>
              <span style={{ color:"#E74C3C", fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={()=>setTab("support")}>Traiter →</span>
            </div>
          )}

          {/* KPIs grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, margin:"14px 0" }}>
            <KPICard icon="👥" label="Utilisateurs total" value={d.users.total} sub={`${d.users.pending} en attente`} color={C.violet} />
            <KPICard icon="✅" label="Missions terminées" value={d.missions.terminees} sub={`${d.missions.tauxCompletion}% de taux`} color={C.success} />
            <KPICard icon="💶" label="CA total (€)" value={d.finance.caTotal > 0 ? `${(d.finance.caTotal/1000).toFixed(1)}k` : `${d.finance.caTotal} €`} sub="Missions complétées" color={C.accentGold} />
            <KPICard icon="📦" label="Missions actives" value={d.missions.open + d.missions.assigned} sub={`${d.missions.open} ouvertes · ${d.missions.assigned} assignées`} color="#7C6FE0" />
          </div>

          {/* Missions par statut */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:14 }}>📋 Statut des missions</div>
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              {[
                {l:"Ouvertes",  v:d.missions.open,      c:"#F0B429"},
                {l:"Assignées", v:d.missions.assigned,   c:C.violet},
                {l:"Terminées", v:d.missions.terminees,  c:C.success},
                {l:"Fermées",   v:d.missions.closed,     c:C.textMuted},
              ].map(s=>(
                <div key={s.l} style={{ flex:1, minWidth:60, textAlign:"center", background:`${s.c}12`, borderRadius:12, padding:"10px 6px" }}>
                  <div style={{ fontWeight:800, color:s.c, fontSize:20 }}>{s.v}</div>
                  <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:12, color:C.textSub, marginBottom:6 }}>Taux de complétion : <strong style={{ color:C.success }}>{d.missions.tauxCompletion}%</strong></div>
            <div style={{ height:8, background:"#162547", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${d.missions.tauxCompletion}%`, background:`linear-gradient(90deg,${C.success},#1e8449)`, borderRadius:4, transition:"width 1s" }} />
            </div>
          </div>

          {/* Répartition utilisateurs */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            {[
              {l:"Total",        v:d.users.total,        c:C.violet},
              {l:"Clients",      v:d.users.clients,      c:C.accentGold},
              {l:"Prestataires", v:d.users.prestataires, c:C.success},
            ].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"12px 10px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:s.c, fontSize:20 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </>}

        {/* ── SECTEURS ── */}
        {tab==="sectors" && <>
          <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:20 }}>
            <DonutChart sectors={d.sectors.length > 0 ? d.sectors : [{pct:100,color:"#162547"}]} />
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>Répartition des missions</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Total : {d.missions.total} missions</div>
              {d.sectors[0] && <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:C.textSub }}>Secteur #1</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>{d.sectors[0].icon} {d.sectors[0].label} ({d.sectors[0].pct}%)</div>
              </div>}
              {d.sectors.length === 0 && <div style={{ marginTop:8, fontSize:12, color:C.textMuted }}>Aucune mission pour l'instant</div>}
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

          <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🕐 Dernières inscriptions</div>
          {d.recentUsers.length === 0 && <div style={{ color:C.textMuted, fontSize:12, textAlign:"center", padding:"20px 0" }}>Aucun utilisateur inscrit</div>}
          {d.recentUsers.map((u,i) => {
            const statusColor = u.status==="approved"?C.success : u.status==="rejected"?C.danger : C.accentGold;
            const statusLabel = u.status==="approved"?"Approuvé" : u.status==="rejected"?"Refusé" : "En attente";
            const dateStr = new Date(u.created_at).toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
            return (
              <div key={i} style={{ background:"#0D1B3E", borderRadius:13, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 6px rgba(0,0,0,0.04)" }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`${u.role==="client"?C.violet:C.accent}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{u.role==="client"?"🏢":"👷"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{u.prenom} {u.nom}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{u.role==="client"?"Client":"Prestataire"} · {dateStr}</div>
                </div>
                <Badge color={statusColor} small>{statusLabel}</Badge>
              </div>
            );
          })}
        </>}

        {/* ── FINANCE ── */}
        {tab==="finance" && <>
          <div style={{ background:`linear-gradient(135deg,${C.violet},${C.indigo})`, borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 4px" }}>Chiffre d'affaires total plateforme</p>
            <div style={{ color:C.white, fontSize:36, fontWeight:900 }}>{d.finance.caTotal.toLocaleString()} €</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginTop:4 }}>Missions complétées : <strong style={{ color:C.accentGold }}>{d.missions.terminees}</strong></div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[{l:"CA total",v:`${d.finance.caTotal.toLocaleString()} €`,c:C.accentGold,i:"💰"},{l:"Missions terminées",v:d.missions.terminees,c:C.success,i:"✅"},{l:"Missions actives",v:d.missions.open+d.missions.assigned,c:C.violet,i:"📦"},{l:"Tickets support",v:d.tickets?.open||0,c:C.danger,i:"🎧"}].map(s=>(
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
            <BOExportCSV d={d} />
            <BOExportPDF d={d} />
          </div>
        </>}

        {/* ── MODÉRATION ── */}
        {tab==="moderation" && <BOModerationTab d={d} />}
        </div>{/* fin contenu */}
      </div>{/* fin layout */}
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
        <div style={{
          background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
          border:"1px solid rgba(16,217,143,0.35)",
          borderRadius:r, padding:"12px 14px", marginBottom:20,
          display:"flex", gap:10, alignItems:"center",
        }}>
          <span style={{ fontSize:18, flexShrink:0 }}>🎁</span>
          <div>
            <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement</div>
            <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5 }}>
              {role==="prestataire" ? "10 missions gratuites · Réservé aux 100 premiers prestataires inscrits" : "Tarif transparent · le prix affiché est le vrai prix de la mission"}
            </div>
          </div>
        </div>

        {role==="prestataire" && (
          <div style={{ marginBottom:20 }}>
            <div style={{ background:`linear-gradient(135deg,${C.violet}18,${C.indigo}10)`, border:`1px solid ${C.violet}40`, borderRadius:r+4, padding:"14px 16px", marginBottom:10 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:16 }}>⚡</span>
                <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>Abonnements ALANE</div>
              </div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5, marginBottom:12 }}>
                Tarif transparent, prix affiché = prix réel. Choisissez le plan adapté à votre activité.
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

        {role==="client" && (
          <div style={{ background:`linear-gradient(135deg,${C.violet}12,${C.indigo}08)`, border:`1px solid ${C.violet}35`, borderRadius:r+4, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:20, flexShrink:0 }}>💡</span>
            <div>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:4 }}>Tarification transparente</div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.6 }}>
                Les prestataires ALANE sont abonnés — aucune commission cachée. Le tarif affiché est le vrai tarif de la mission.
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
function ContractScreen({ provider, amount, hours, date, missionId, onSign, onBack }) {
  const p = provider;
  if (!p) return null;
  const [clientSigned, setClientSigned] = useState(false);
  const [prestaSigned, setPrestaSigned] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const [activeTab, setActiveTab] = useState("contrat");
  const bothSigned = clientSigned && prestaSigned;
  const [contractNum] = useState(`CTR-ALANE-2025-${Math.floor(Math.random()*90000+10000)}`);
  const today = new Date().toLocaleDateString("fr-FR");
  const missionDate = date || today;
  const missionHours = hours || 8;
  const totalAmount = (typeof amount === 'object' ? amount?.amount : amount) || 124;
  const prestaNet = (p.tarifNet * missionHours).toFixed(2);

  useEffect(()=>{
    if(!bothSigned) return;
    let mounted = true;
    const t = setTimeout(async ()=>{
      if (mounted) {
        try {
          const { data:{ user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from("contracts").insert({
              mission_id: missionId || null,
              contract_number: contractNum,
              client_id: user.id,
              prestataire_name: p.name,
              prestataire_role: p.role || p.jobTitle,
              nb_heures: missionHours,
              montant: totalAmount,
              client_signed: true,
              prestataire_signed: true,
              client_signed_at: new Date().toISOString(),
              prestataire_signed_at: new Date().toISOString(),
            });
          }
        } catch(_) {}
        setFinalised(true);
        onSign && onSign();
      }
    }, 1800);
    return ()=>{ mounted=false; clearTimeout(t); };
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
      content:`Le présent contrat a pour objet de définir les conditions dans lesquelles ${p.name}, auto-entrepreneur (ci-après "le Prestataire"), fournit ses services à la société cliente (ci-après "le Client"), dans le cadre d'une prestation de services réalisée via la plateforme ALANE.\n\nNature de la prestation : ${p.role}\nDate de la mission : ${missionDate}\nDurée estimée : ${missionHours} heures\nLieu : Paris, France (selon adresse renseignée lors de la réservation)`
    },
    {
      title:"Article 2 — Indépendance du prestataire",
      content:`Le Prestataire intervient en tant que travailleur indépendant. Il conserve toute liberté dans l'organisation et l'exécution de sa prestation. Le présent contrat ne crée aucun lien de subordination juridique entre le Client et le Prestataire.\n\nLe Prestataire n'est pas soumis aux directives du Client concernant les moyens d'exécution de la mission, mais uniquement quant aux résultats attendus. Aucune requalification en contrat de travail ne saurait résulter du présent accord.\n\nLe Prestataire demeure libre de travailler pour d'autres clients pendant et après la présente mission.`
    },
    {
      title:"Article 3 — Rémunération et paiement",
      content:`Taux horaire net prestataire : ${p.tarifNet ? p.tarifNet.toFixed(2) : "14,00"} €/h\nDurée : ${missionHours}h\nMontant net dû au Prestataire : ${prestaNet} €\nMontant total facturé au Client : ${totalAmount} € (incluant les frais de service ALANE)\n\nLe paiement est sécurisé via le système d'escrow ALANE : les fonds sont bloqués dès la réservation et libérés automatiquement au Prestataire dans un délai de 24h après validation mutuelle de la mission par les deux parties.\n\nEn cas de litige non résolu, ALANE intervient en médiateur et arbitre le déblocage des fonds sous 72h ouvrées.`
    },
    {
      title:"Article 4 — Obligations du prestataire",
      content:`Le Prestataire s'engage à :\n• Exécuter la mission avec sérieux, professionnalisme et compétence\n• Respecter scrupuleusement les horaires et le lieu convenus\n• Informer le Client et ALANE de tout empêchement dans un délai minimum de 4h avant la mission\n• Maintenir la confidentialité sur toute information relative à l'activité du Client\n• Respecter les consignes de sécurité applicables sur le lieu de mission\n• Posséder et maintenir à jour tous les diplômes, certifications et habilitations nécessaires à l'exercice de sa prestation\n• Être à jour de ses cotisations URSSAF et déclarations fiscales`
    },
    {
      title:"Article 5 — Obligations du client",
      content:`Le Client s'engage à :\n• Fournir au Prestataire toutes les informations nécessaires à la bonne exécution de la mission\n• Préparer les conditions matérielles requises pour l'exécution de la prestation\n• Valider ou contester la mission dans un délai de 48h suivant son achèvement\n• Traiter le Prestataire avec respect et dans le respect de la dignité humaine\n• Ne pas demander au Prestataire d'effectuer des tâches sortant du cadre défini dans le présent contrat\n• Ne pas tenter de court-circuiter la plateforme ALANE pour des missions futures avec le même prestataire`
    },
    {
      title:"Article 6 — Politique d’annulation",
      content:`Annulation par le Client :\n• Plus de 48h avant la mission : remboursement intégral\n• Entre 24h et 48h avant : 50% du montant retenu\n• Moins de 24h avant : 100% du montant retenu\n\nAnnulation par le Prestataire :\n• Plus de 48h avant : aucune pénalité, ALANE propose un remplaçant\n• Entre 4h et 48h avant : pénalité de 15% sur la prochaine mission\n• Moins de 4h avant : suspension temporaire du compte prestataire\n\nEn cas d'annulation par le Prestataire, ALANE s'engage à proposer un prestataire remplaçant dans les meilleurs délais. En l'absence de remplaçant, le Client est remboursé intégralement.`
    },
    {
      title:"Article 7 — Responsabilité et assurance",
      content:`Le Prestataire est seul responsable des dommages causés dans le cadre de l'exécution de sa mission et doit disposer d'une assurance Responsabilité Civile Professionnelle (RC Pro) en cours de validité.\n\nALANE agit en qualité de simple intermédiaire et ne saurait être tenu responsable des dommages résultant d'une inexécution ou mauvaise exécution de la prestation.\n\nLe Client est responsable des conditions matérielles d'accueil et de sécurité du lieu de mission. En cas d'accident du travail survenant chez le Client, la responsabilité incombe au Client en sa qualité de donneur d'ordre.`
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
      content:`En cas de différend relatif à l'exécution ou à l'interprétation du présent contrat, les parties s'engagent à recourir en premier lieu à la médiation ALANE, accessible via l'application.\n\nALANE dispose d'un délai de 72h ouvrées pour proposer une solution amiable. En cas d'échec de la médiation, les parties pourront saisir les juridictions compétentes.\n\nLe présent contrat est soumis au droit français. En cas de litige judiciaire, les tribunaux de Paris seront seuls compétents.`
    },
    {
      title:"Article 11 — Protection des données",
      content:`Les données personnelles collectées dans le cadre du présent contrat sont traitées par ALANE SAS conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés.\n\nCes données sont utilisées exclusivement pour la gestion de la relation contractuelle et ne sont pas transmises à des tiers sans consentement explicite.\n\nChaque partie dispose d'un droit d'accès, de rectification, d'effacement et de portabilité de ses données en contactant : rgpd@alane.fr`
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
                <div style={{ fontSize:24, fontWeight:800, color:C.violet, fontFamily:font.display, marginBottom:4 }}>ALANE</div>
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

            {/* ALANE */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Plateforme intermédiaire</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>⚡</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>ALANE SAS</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Plateforme de mise en relation</div>
                </div>
              </div>
              <div style={{ background:`${C.accentGold}15`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text, lineHeight:1.6 }}>
                💡 ALANE agit en qualité d'intermédiaire et gestionnaire de paiement. Les fonds de <strong>{totalAmount} €</strong> sont placés en escrow sécurisé jusqu'à validation mutuelle de la mission.
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
              🔒 <strong>Escrow sécurisé :</strong> Les <strong>{totalAmount} €</strong> sont actuellement bloqués chez ALANE et seront libérés vers {p.name} (<strong>{prestaNet} €</strong>) après validation mutuelle de la mission.
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
        { title:"1. Objet", text:"Les présentes CGU régissent l’utilisation de la plateforme ALANE, service de mise en relation entre clients et prestataires de services. En utilisant ALANE, vous acceptez sans réserve les présentes conditions." },
        { title:"2. Inscription", text:"L’inscription est gratuite. Vous devez fournir des informations exactes et à jour. Les prestataires doivent être auto-entrepreneurs en règle avec l’URSSAF et fournir les documents requis." },
        { title:"3. Responsabilités", text:"ALANE agit en qualité d’intermédiaire. La responsabilité de l’exécution de la mission incombe au prestataire. ALANE ne peut être tenu responsable des dommages résultant d’une mauvaise exécution." },
        { title:"4. Paiements", text:"Les paiements sont sécurisés via un système d’escrow. Les fonds sont bloqués lors de la réservation et libérés après validation mutuelle. La commission ALANE est incluse dans le tarif affiché." },
        { title:"5. Annulations", text:"Politique d’annulation : gratuit au-delà de 48h, 50% entre 24-48h, 100% en dessous de 24h. Ces frais s’appliquent tant aux clients qu’aux prestataires." },
        { title:"6. Litiges", text:"En cas de litige, les parties s’engagent à contacter la médiation ALANE en premier recours. À défaut de résolution amiable, les tribunaux de Paris seront compétents." },
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
        { title:"5. Vos droits", text:"Conformément au RGPD, vous disposez des droits suivants : accès, rectification, suppression, portabilité, opposition. Exercez-les en nous contactant : privacy@alane.fr" },
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
          Pour toute question : <strong style={{ color:C.violet }}>legal@alane.fr</strong>
        </div>
      </div>
    </div>
  );
}

// ── FICHE DE PAIE ─────────────────────────────────────────────────
function PayslipScreen({ provider, mission, onBack }) {
  const p = provider;
  if (!p) return null;
  const m = mission || { role:"Cariste CACES 1", client:"Entrepôt XYZ", date:"12/05/2025", hours:8, tarifNet:14 };
  const brut = m.tarifNet * m.hours;
  const num = `FP-2025-${Math.floor(Math.random()*90000+10000)}`;
  const [downloaded, setDownloaded] = useState(false);
  const [sendEmail, setSendEmail]   = useState("");
  const [sent, setSent]             = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [caReel, setCaReel] = useState(null);
  const [caPlafond] = useState(77700);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      if(!data?.user) return;
      supabase.from("missions").select("montant_total,tarif_horaire,nb_heures").eq("prestataire_id",data.user.id).eq("status","completed")
        .then(({data:ms})=>{
          if(!Array.isArray(ms)) return;
          const total=ms.reduce((s,m)=>s+Number(m.montant_total||(m.tarif_horaire&&m.nb_heures?Number(m.tarif_horaire)*Number(m.nb_heures):0)),0);
          setCaReel(Math.round(total*100)/100);
        });
    });
  },[]);

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
              <div style={{ fontSize:20, fontWeight:800, color:C.violet, fontFamily:font.display }}>ALANE</div>
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
            <div style={{ height:"100%", width:`${caReel!==null?Math.min(Math.round((caReel/caPlafond)*100),100):0}%`, background:`linear-gradient(90deg,${C.success},${C.accentGold})`, borderRadius:4, transition:"width 1s" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textSub }}>
            <span>CA réalisé : <strong style={{ color:C.success }}>{caReel!==null?caReel.toLocaleString("fr-FR")+"€":"—"}</strong></span>
            <span>Restant : <strong style={{ color:C.text }}>{caReel!==null?(caPlafond-caReel).toLocaleString("fr-FR")+"€":"—"}</strong></span>
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={()=>setDownloaded(true)} style={{ flex:1, padding:"13px", fontSize:13, color:downloaded?C.success:undefined }}>{downloaded?"✓ Téléchargé":"⬇️ Télécharger"}</Btn>
          <Btn onClick={()=>setShowSendForm(v=>!v)} style={{ flex:1, padding:"13px", fontSize:13 }}>📧 Envoyer</Btn>
        </div>
        {showSendForm && (
          <div style={{ background:"#0D1B3E", borderRadius:12, padding:"14px", marginTop:10, border:`1px solid ${C.border}` }}>
            {sent ? (
              <div style={{ textAlign:"center", color:C.success, fontWeight:700, fontSize:13, padding:"6px 0" }}>✅ Attestation envoyée</div>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <input value={sendEmail} onChange={e=>setSendEmail(e.target.value)} placeholder="Adresse email" type="email" style={{ flex:1, background:"#162547", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", color:C.text, fontSize:13, fontFamily:"inherit", outline:"none" }} />
                <button onClick={()=>{ if(sendEmail.includes("@")){ setSent(true); setShowSendForm(false); } }} style={{ padding:"9px 14px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Envoyer</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── HISTORIQUE MISSIONS CLIENT ────────────────────────────────────
function MissionHistoryScreen({ onNavigate, onBack }) {
  const [tab, setTab]             = useState("all");
  const [missions, setMissions]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [candidatures, setCandidatures] = useState([]);
  const [actioning, setActioning] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completedResult, setCompletedResult] = useState(null);
  const [userId, setUserId]       = useState(null);

  useEffect(()=>{ supabase.auth.getUser().then(({data})=>{ if(data?.user) setUserId(data.user.id); }); }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data?.user; if (!user) return;
      const res = await fetch("/api/missions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_client", client_id: user.id }),
      });
      const data2 = await res.json();
      setMissions(Array.isArray(data2) ? data2 : []);
      setLoading(false);
    });
  }, []);

  const openCandidatures = async (mission) => {
    setSelected(mission);
    const res = await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_candidatures", mission_id: mission.id }),
    });
    const data = await res.json();
    setCandidatures(Array.isArray(data) ? data : []);
  };

  const handleAccept = async (c) => {
    setActioning(c.id);
    await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", candidature_id: c.id, mission_id: selected.id, prestataire_id: c.prestataire_id }),
    });
    setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "assigned", prestataire_id: c.prestataire_id } : m));
    setCandidatures(cs => cs.map(x => ({ ...x, status: x.id === c.id ? "accepted" : "rejected" })));
    setSelected(s => s ? { ...s, status: "assigned" } : s);
    setActioning(null);
  };

  const handleComplete = async () => {
    if (!selected || !userId) return;
    setCompleting(true);
    const res = await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", mission_id: selected.id, client_id: userId }),
    });
    const data = await res.json();
    if (data.success) {
      setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "completed" } : m));
      setSelected(s => s ? { ...s, status: "completed" } : s);
      setCompletedResult(data);
    }
    setCompleting(false);
  };

  const handleReject = async (c) => {
    setActioning(c.id);
    await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", candidature_id: c.id }),
    });
    setCandidatures(cs => cs.map(x => x.id === c.id ? { ...x, status: "rejected" } : x));
    setActioning(null);
  };

  const handleClose = async (missionId) => {
    await fetch("/api/missions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", mission_id: missionId }),
    });
    setMissions(ms => ms.map(m => m.id === missionId ? { ...m, status: "closed" } : m));
  };

  const statusLabel  = { open:"Ouverte", assigned:"Assignée", completed:"Terminée", closed:"Fermée" };
  const statusColor  = { open:C.success, assigned:C.violet, completed:C.accentGold, closed:C.textMuted };
  const filtered = tab === "all" ? missions : missions.filter(m => m.status === tab);

  if (selected) {
    const sector = SECTORS.find(s => s.id === selected.sector);
    return (
      <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:80 }}>
        <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
          <button onClick={()=>setSelected(null)} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
          <div style={{ fontSize:28, marginBottom:6 }}>{sector?.icon||"📋"}</div>
          <h2 style={{ color:C.white, fontSize:18, fontWeight:800, margin:"0 0 2px" }}>{selected.metier || sector?.label}</h2>
          <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>📅 {selected.date} · {selected.hours}h · {selected.ville}</p>
        </div>
        <div style={{ padding:"18px" }}>
          <p style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:12 }}>
            {candidatures.length === 0 ? "Aucune candidature reçue" : `${candidatures.length} candidature${candidatures.length > 1 ? "s" : ""} reçue${candidatures.length > 1 ? "s" : ""}`}
          </p>
          {candidatures.map(c => (
            <div key={c.id} style={{ background:"#0D1B3E", borderRadius:14, padding:"14px", marginBottom:10, border:`1px solid ${c.status==="accepted"?C.success:c.status==="rejected"?"rgba(242,94,94,0.3)":C.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:c.message?8:0 }}>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{c.prenom} {c.nom}</div>
                  <div style={{ color:C.textMuted, fontSize:11 }}>{new Date(c.created_at).toLocaleDateString("fr-FR")}</div>
                </div>
                {c.status === "accepted" && <span style={{ color:C.success, fontWeight:700, fontSize:12 }}>✅ Accepté</span>}
                {c.status === "rejected" && <span style={{ color:"#F25E5E", fontWeight:700, fontSize:12 }}>❌ Refusé</span>}
              </div>
              {c.message && <p style={{ color:C.textSub, fontSize:13, margin:"0 0 10px", fontStyle:"italic" }}>"{c.message}"</p>}
              {c.status === "pending" && selected.status === "open" && (
                <div style={{ display:"flex", gap:8, marginTop:8 }}>
                  <button onClick={()=>handleReject(c)} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"transparent", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {actioning===c.id?"…":"❌ Refuser"}
                  </button>
                  <button onClick={()=>handleAccept(c)} disabled={!!actioning} style={{ flex:2, padding:"9px", borderRadius:10, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {actioning===c.id?"…":"✅ Accepter"}
                  </button>
                </div>
              )}
            </div>
          ))}
          {candidatures.length === 0 && (
            <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"28px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
              <div style={{ color:C.textSub, fontSize:13 }}>En attente de candidatures…</div>
            </div>
          )}
          {selected.status === "assigned" && !completedResult && (
            <div style={{ marginTop:20, background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}40`, borderRadius:14, padding:"16px" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Mission terminée ?</div>
              <div style={{ color:C.textSub, fontSize:12, marginBottom:12, lineHeight:1.5 }}>
                En validant, vous confirmez que la mission s'est bien déroulée. Le cashback sera crédité sur votre wallet.
              </div>
              <button onClick={handleComplete} disabled={completing} style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", background:C.accentGold, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                {completing ? "Validation…" : "✅ Valider la mission"}
              </button>
            </div>
          )}

          {completedResult && (
            <div style={{ marginTop:20, background:`${C.success}12`, border:`1px solid ${C.success}40`, borderRadius:14, padding:"20px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
              <div style={{ fontWeight:700, color:C.text, fontSize:15, marginBottom:4 }}>Mission validée !</div>
              <div style={{ color:C.textSub, fontSize:13, marginBottom:12 }}>
                Montant : <strong style={{ color:C.text }}>{completedResult.montantTotal?.toFixed(2).replace(".",",")} € HT</strong>
              </div>
              <div style={{ background:`${C.accentGold}20`, border:`1px solid ${C.accentGold}40`, borderRadius:10, padding:"12px" }}>
                <div style={{ color:C.accentGold, fontWeight:700, fontSize:16 }}>+{completedResult.cashbackEarned?.toFixed(2).replace(".",",")} € cashback</div>
                <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>crédité sur votre wallet</div>
              </div>
            </div>
          )}

          {selected.status === "completed" && !completedResult && (
            <div style={{ marginTop:20, background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:14, padding:"14px", textAlign:"center" }}>
              <div style={{ color:C.success, fontWeight:700, fontSize:14 }}>✅ Mission terminée et validée</div>
              {selected.montant_total > 0 && <div style={{ color:C.textSub, fontSize:12, marginTop:4 }}>Montant : {Number(selected.montant_total).toFixed(2).replace(".",",")} € HT</div>}
            </div>
          )}

          {selected.status === "open" && (
            <button onClick={()=>handleClose(selected.id)} style={{ width:"100%", marginTop:16, padding:"11px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:C.textSub, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Clôturer la mission
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>📋 Mes missions</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{missions.length} mission{missions.length!==1?"s":""} au total</p>
      </div>
      <div style={{ padding:"16px 18px 0" }}>
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
          {[{id:"all",l:"Toutes"},{id:"open",l:"Ouvertes"},{id:"assigned",l:"Assignées"},{id:"completed",l:"Terminées"},{id:"closed",l:"Fermées"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"8px 4px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit" }}>{t.l}</button>
          ))}
        </div>
        {loading && <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"32px", textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>📭</div>
            <div style={{ color:C.text, fontWeight:600, fontSize:13, marginBottom:6 }}>Aucune mission</div>
            <div style={{ color:C.textMuted, fontSize:12 }}>Publiez votre première mission depuis un secteur.</div>
          </div>
        )}
        {filtered.map(m => {
          const sector = SECTORS.find(s => s.id === m.sector);
          const pending = (m.candidatures||[]).filter(c=>c.status==="pending").length;
          return (
            <div key={m.id} onClick={()=>openCandidatures(m)} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, cursor:"pointer", border:`1px solid ${pending>0?C.violet+"55":C.border}` }}>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ width:46, height:46, borderRadius:12, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.metier || sector?.label || "Mission"}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>📅 {m.date} · {m.hours}h · {m.ville}</div>
                  {pending > 0 && <div style={{ color:C.violet, fontSize:11, fontWeight:700, marginTop:2 }}>🔔 {pending} candidature{pending>1?"s":""} en attente</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ color:statusColor[m.status]||C.textMuted, fontSize:11, fontWeight:700 }}>{statusLabel[m.status]||m.status}</span>
                  <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>›</div>
                </div>
              </div>
            </div>
          );
        })}
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
  ];
  const prestaNav = [
    { id:"p_home",     icon:"🏠", label:"Accueil"      },
    { id:"p_missions", icon:"📋", label:"Missions"     },
    { id:"calendar",   icon:"📅", label:"Planning"     },
    { id:"notifications",icon:"🔔",label:"Notifications"},
    { id:"p_dashboard",icon:"👤", label:"Mon profil"   },
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
        <ALANELogo size="sm" />
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
        <div onClick={()=>onNavigate("settings")}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, cursor:"pointer", marginBottom:6,
            background: screen==="settings" ? `${accentColor}22` : "rgba(255,255,255,0.05)",
            border: `1px solid ${screen==="settings" ? accentColor+"55" : "rgba(255,255,255,0.1)"}`,
            transition:"all 0.18s" }}
          onMouseEnter={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.1)"; }}
          onMouseLeave={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
        >
          <span style={{ fontSize:16 }}>⚙️</span>
          <span style={{ fontSize:13, fontWeight: screen==="settings"?700:500, color: screen==="settings"?C.white:"rgba(255,255,255,0.75)" }}>Réglages</span>
          {screen==="settings" && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
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
function ResponsiveLayout({ children, screen, role, isLoggedIn, onNavigate, showClientNav, showPrestaNav, onlineStatus, onToggleOnline, unreadCount }) {
  const { isMobile } = useResponsive();

  const hybridBanner = !["bo_login","bo_dashboard"].includes(screen) && (
    <div style={{ background:"linear-gradient(90deg,#4F46E5,#7C3AED)", padding:"6px 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexShrink:0 }}>
      <span style={{ fontSize:13 }}>⚡</span>
      <span style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:0.5 }}>⚡ ALANE · Tarif transparent · Prix affiché = Prix réel</span>
    </div>
  );

  const showAdminBtn = !["bo_login","bo_dashboard"].includes(screen);

  // Admin button — top-right, all screens
  const adminBtn = showAdminBtn && (
    <button
      onClick={() => onNavigate("bo_login")}
      title="Administration"
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        zIndex: 9999,
        width: 34,
        height: 34,
        borderRadius: 10,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.45)",
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(10px)",
      }}
    >
      ⚙️
    </button>
  );


  if (isMobile) {
    return (
      <div style={{ width:"100%", height:"100vh", display:"flex", flexDirection:"column", fontFamily:"’DM Sans’,system-ui,sans-serif", background:C.bg, position:"relative", overflow:"hidden" }}>
        {hybridBanner}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden" }}>
          {children}
        </div>
        {showClientNav && <ClientNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
        {showPrestaNav && <PrestaNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
        {adminBtn}
      </div>
    );
  }

  // Desktop layout
  const showSidebar = isLoggedIn && !["splash","role","auth_client","auth_presta","how_client","how_presta","client_onboarding","presta_onboarding","presta_pending","pending_approval","bo_login","bo_dashboard","reset_password"].includes(screen);

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
      {adminBtn}
    </div>
  );
}

// ── CASHBACK SYSTEM ──────────────────────────────────────────────

// Paliers de fidélité
const CASHBACK_TIERS = [
  { id:"standard", label:"Standard", min:0,   max:2,   rate:0.005,  color:"#8B8FA8", icon:"⭐"  },
  { id:"silver",   label:"Silver",   min:3,   max:5,   rate:0.0075, color:"#C0C0C0", icon:"🥈"  },
  { id:"gold",     label:"Gold",     min:6,   max:9,   rate:0.01,   color:"#F0B429", icon:"🥇"  },
  { id:"platinum", label:"Platinum", min:10,  max:999, rate:0.015,  color:"#A89DF5", icon:"💎"  },
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
  const [walletData, setWalletData] = useState({ balance: 0, missionsThisMonth: 0 });
  const [history, setHistory]       = useState([]);
  const [wLoading, setWLoading]     = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data?.user;
      if (!user) { setWLoading(false); return; }

      const [{ data: profile }, { data: completedMissions }] = await Promise.all([
        supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id", user.id).single(),
        supabase.from("missions").select("id,metier,sector,date,hours,tarif_horaire,montant_total,status")
          .eq("client_id", user.id).eq("status", "completed").order("created_at", { ascending: false }),
      ]);

      setWalletData({
        balance: profile?.cashback_balance || 0,
        missionsThisMonth: profile?.missions_completed_month || 0,
      });

      if (Array.isArray(completedMissions)) {
        setHistory(completedMissions.map(m => {
          const sector = SECTORS.find(s => s.id === m.sector);
          const montant = m.montant_total || ((m.hours||0) * (m.tarif_horaire||0));
          const rate = getCashbackTier(profile?.missions_completed_month || 0).rate;
          const cashback = Math.round(montant * rate * 100) / 100;
          return {
            mission: m.metier || sector?.label || "Mission",
            date: m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "—",
            amount: montant,
            cashback,
            status: "disponible",
          };
        }));
      }
      setWLoading(false);
    });
  }, []);

  const w = walletData;
  const tier = getCashbackTier(w.missionsThisMonth);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - w.missionsThisMonth : 0;
  const progressPct = nextTier
    ? Math.min(100, ((w.missionsThisMonth - tier.min) / (nextTier.min - tier.min)) * 100)
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
            {wLoading ? "—" : Number(w.balance).toFixed(2)} <span style={{ fontSize:22, color:C.textSub }}>€</span>
          </div>
          <p style={{ color:C.textMuted, fontSize:12, margin:"0 0 16px" }}>
            {w.balance >= 10 ? <span style={{ color:C.accentGold }}>Disponible à l'utilisation</span> : "Minimum 10 € pour utiliser votre cashback"}
          </p>
          <Btn onClick={()=>onNavigate("search_filters")} style={{ fontSize:13, padding:"10px 20px" }}>
            Utiliser mon cashback →
          </Btn>
        </div>

        {/* Stats rapides */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          {[
            { label:"Solde wallet",  value:`${Number(w.balance).toFixed(2)} €`,        color:C.success, icon:"💰" },
            { label:"Ce mois",       value:`${w.missionsThisMonth} mission${w.missionsThisMonth>1?"s":""}`, color:C.violet, icon:"📋" },
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
        {!wLoading && history.length === 0 && (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r, padding:"24px", textAlign:"center", marginBottom:12 }}>
            <div style={{ fontSize:28, marginBottom:8 }}>💸</div>
            <div style={{ color:C.textSub, fontSize:13 }}>Validez votre première mission pour gagner du cashback.</div>
          </div>
        )}
        {history.map((h,i)=>(
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
    let mounted = true;
    let channel;
    (async()=>{
      const { data:authData, error:authErr } = await supabase.auth.getUser();
      const user = authData?.user;
      if(!mounted){ return; }
      if(authErr || !user){ setLoading(false); return; }

      const { data:notifData } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at",{ascending:false}).limit(50);
      if(!mounted) return;
      setNotifs(notifData||[]);
      setLoading(false);

      channel = supabase.channel("notifs_"+user.id)
        .on("postgres_changes",{ event:"INSERT", schema:"public", table:"notifications", filter:`user_id=eq.${user.id}` },
          payload => { if(mounted) setNotifs(prev=>[payload.new, ...prev]); }
        ).subscribe();
    })();
    return ()=>{ mounted=false; if(channel) supabase.removeChannel(channel); };
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
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, []);

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
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Votre avis aide la communauté ALANE</p>
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

        <Btn full disabled={rating===0||saving} onClick={async()=>{
          setSaving(true);
          try {
            await supabase.from("ratings").insert({
              reviewer_id: userId,
              reviewee_provider_id: p.id,
              reviewee_name: p.name,
              rating,
              tags,
              comment: comment.trim()||null,
              mission_id: missionId||null,
            });
          } catch(_) {}
          setSaving(false);
          setSubmitted(true);
        }} style={{ fontSize:15, padding:"16px" }}>
          {saving ? "Envoi…" : "⭐ Publier mon avis"}
        </Btn>
        {rating===0 && <p style={{ textAlign:"center", color:C.textMuted, fontSize:12, marginTop:8 }}>Sélectionnez une note pour continuer</p>}
      </div>
    </div>
  );
}

// ── UPLOAD DOCUMENTS ─────────────────────────────────────────────
function DocUploadScreen({ onBack }) {
  const DOC_DEFS = [
    { id:"kbis",     label:"Extrait KBIS / Avis INSEE",  icon:"📋", required:true  },
    { id:"urssaf",   label:"Attestation URSSAF",          icon:"🏛️", required:true  },
    { id:"cni",      label:"Pièce d’identité",            icon:"🪪", required:true  },
    { id:"vitale",   label:"Carte Vitale",                icon:"💊", required:false },
    { id:"domicile", label:"Justificatif de domicile",    icon:"🏠", required:false },
    { id:"rib",      label:"RIB / IBAN",                  icon:"💳", required:true  },
    { id:"rcpro",    label:"Attestation RC Pro",          icon:"🛡️", required:false },
  ];

  const [userId, setUserId]   = useState(null);
  const [dbDocs, setDbDocs]   = useState([]);  // [{type, storage_path, created_at}]
  const [uploading, setUploading] = useState(null);
  const [uploadOk, setUploadOk]   = useState(null);
  const fileRefs = useRef({});

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if(!u) return;
      setUserId(u.id);
      const { data: rows } = await supabase.from("documents").select("type,storage_path,created_at").eq("prestataire_id", u.id);
      setDbDocs(rows || []);
    });
  }, []);

  const handleUpload = async (docId) => {
    const input = fileRefs.current[docId];
    if(!input) return;
    input.click();
  };

  const handleFileChange = async (docId, e) => {
    const file = e.target.files?.[0]; if(!file||!userId) return;
    setUploading(docId); setUploadOk(null);
    const ext = file.name.split(".").pop();
    const path = `${userId}/${docId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert:true });
    if(!error) {
      await supabase.from("documents").upsert({ prestataire_id:userId, type:docId, storage_path:path, created_at:new Date().toISOString() });
      setDbDocs(prev => { const filtered = prev.filter(d=>d.type!==docId); return [...filtered, { type:docId, storage_path:path, created_at:new Date().toISOString() }]; });
      setUploadOk(docId);
      setTimeout(()=>setUploadOk(null), 3000);
    }
    setUploading(null);
    e.target.value = "";
  };

  const docs = DOC_DEFS.map(def => {
    const saved = dbDocs.find(d=>d.type===def.id);
    return {
      ...def,
      status: saved ? "valid" : "missing",
      info:   saved ? `Envoyé le ${new Date(saved.created_at).toLocaleDateString("fr-FR")}` : (def.required ? "Document requis" : "Recommandé"),
    };
  });

  const statusColors = { valid:C.success, missing:C.accent };
  const statusLabels = { valid:"✓ Envoyé", missing:"Manquant" };

  const handleUploadLegacy = (id) => handleUpload(id);

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

        {/* Inputs fichiers cachés */}
        {DOC_DEFS.map(def => (
          <input key={def.id} type="file" accept=".pdf,.jpg,.jpeg,.png" ref={el=>fileRefs.current[def.id]=el}
            onChange={e=>handleFileChange(def.id,e)} style={{ display:"none" }} />
        ))}

        {/* Liste documents */}
        {docs.map((d,i) => (
          <div key={d.id} style={{ background:"#0D1B3E", border:`1px solid ${d.status==="valid" ? C.border : statusColors[d.status]+"40"}`, borderRadius:r, padding:"14px 15px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${statusColors[d.status]}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{d.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{d.label}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{d.info}</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <Badge color={statusColors[d.status]} small>{uploadOk===d.id?"✅ Envoyé !":statusLabels[d.status]}</Badge>
              <button onClick={()=>handleUploadLegacy(d.id)} disabled={uploading===d.id}
                style={{ background:d.status==="valid"?"rgba(255,255,255,0.08)":C.violet, border:"none", borderRadius:8, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:uploading===d.id?0.6:1 }}>
                {uploading===d.id?"⏳…":d.status==="valid"?"🔄 Remplacer":"📤 Charger"}
              </button>
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

function LaunchBadge({ context="home", spotsLeft=null }) {
  if(!isLaunchPhase()) return null;
  const msgs = {
    home:    { icon:"🎉", title:"Offre de lancement", sub:"10 missions gratuites pour les 100 premiers prestataires inscrits" },
    presta:  { icon:"🚀", title:"10 missions offertes", sub: spotsLeft !== null ? `${spotsLeft} places restantes sur 100 · Inscrivez-vous maintenant` : "Réservé aux 100 premiers prestataires inscrits" },
    booking: { icon:"💡", title:"Tarif transparent", sub:"Le prix affiché est le prix réel — aucune surprise" },
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
  const [saving,setSaving]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [missionsUsed,setMissionsUsed]=useState(0);

  useEffect(()=>{
    supabase.auth.getUser().then(async ({data})=>{
      const u=data?.user; if(!u) return;
      setCurrent(u.user_metadata?.plan_abonnement||"free");
      setLoaded(true);
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      supabase.from("missions").select("id",{count:"exact",head:true})
        .eq("user_id",u.id).gte("created_at",startOfMonth)
        .then(({count})=>{ if(count!=null) setMissionsUsed(count); });
    });
  },[]);

  const handleChangePlan = async (planId) => {
    if(planId === current) return;
    if(!window.confirm(`Passer au plan ${ABONNEMENTS_PRESTA.find(p=>p.id===planId)?.label} ?`)) return;
    setSaving(true);
    await supabase.auth.updateUser({ data: { plan_abonnement: planId } });
    setCurrent(planId);
    setSaving(false);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:40 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>Mon abonnement</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>Tarif transparent · prix affiché = prix réel</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {isLaunchPhase() && (
          <div style={{ background:`${C.violet}18`, border:`1px solid ${C.violet}50`, borderRadius:r, padding:"13px 15px", marginBottom:20 }}>
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:20 }}>🚀</span>
              <div>
                <div style={{ fontWeight:700, color:C.violetLight, fontSize:13 }}>Offre de lancement exclusive</div>
                <div style={{ color:C.textSub, fontSize:12, marginTop:3, lineHeight:1.5 }}>Les <strong style={{ color:C.white }}>100 premiers prestataires inscrits</strong> bénéficient de <strong style={{ color:C.accentGold }}>10 missions/mois gratuites</strong>.<br/>Plan Gratuit : 2 missions/mois ensuite pour tous.</div>
              </div>
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
                  <div style={{ fontWeight:800, color:plan.color, fontSize:20 }}>{price===0?"Gratuit":price+" €"}{price>0&&<span style={{ fontSize:12, color:C.textSub, fontWeight:400 }}>/mois</span>}</div>
                </div>
              </div>
              {plan.features.map((f,i)=>(
                <div key={i} style={{ display:"flex", gap:8, padding:"3px 0" }}>
                  <span style={{ color:plan.color, fontSize:13 }}>✓</span>
                  <span style={{ color:C.text, fontSize:12 }}>{f}</span>
                </div>
              ))}
              {plan.note && <p style={{ color:C.textMuted, fontSize:10, margin:"8px 0 0", lineHeight:1.5, fontStyle:"italic" }}>{plan.note}</p>}
              {price > 0 && (
                <div style={{ marginTop:10, background:plan.color+"10", border:`1px solid ${plan.color}30`, borderRadius:10, padding:"9px 12px" }}>
                  <div style={{ fontSize:11, color:C.textSub, marginBottom:4 }}>💡 Rentabilité estimée</div>
                  <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>
                    Abonnement couvert dès <strong style={{ color:plan.color }}>la 1ère mission</strong><br/>
                    <span style={{ color:C.textSub, fontSize:11 }}>
                      {plan.id==="premium"
                        ? `1 mission ≈ 96€ net · Abonnement = ${price}€ · Bénéfice net dès mission 1 : +${96-price}€`
                        : `1 mission ≈ 96€ net · Abonnement = ${price}€ · Bénéfice net dès mission 1 : +${96-price}€ · Position #1 + Manager dédié`
                      }
                    </span>
                  </div>
                </div>
              )}
              {plan.missions < 999 && active && (
                <div style={{ marginTop:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textSub, marginBottom:4 }}>
                    <span>Missions ce mois</span>
                    <span style={{ color: missionsUsed >= plan.missions ? C.danger : C.success }}>{missionsUsed} / {plan.missions}</span>
                  </div>
                  <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:99, height:4 }}>
                    <div style={{ width:`${Math.min(100,(missionsUsed/plan.missions)*100)}%`, height:"100%", background: missionsUsed >= plan.missions ? C.danger : C.success, borderRadius:99, transition:"width 0.5s" }} />
                  </div>
                </div>
              )}
              <button onClick={()=>handleChangePlan(plan.id)} disabled={saving} style={{ width:"100%", padding:"11px", border:"none", borderRadius:r, cursor:saving?"not-allowed":"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, marginTop:12, background:active?plan.color+"30":plan.price===0?C.bgSurface:`linear-gradient(135deg,${plan.color},${plan.color}cc)`, color:active?plan.color:plan.price===0?C.textSub:"#fff", opacity:saving?0.7:1 }}>
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
          ville, adresse, description, status: "open",
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
    const style = document.getElementById("alane-spin-style");
    if(!style){
      const s=document.createElement("style");
      s.id="alane-spin-style";
      s.textContent="@keyframes alaneSpin{to{transform:rotate(360deg)}}";
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
      <style>{`@keyframes alaneSpin{to{transform:rotate(360deg)}}`}</style>

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
            <div style={{ width:32, height:32, borderRadius:"50%", border:`3px solid ${C.violet}`, borderTopColor:"transparent", animation:"alaneSpin 0.9s linear infinite", flexShrink:0 }} />
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
  const [role,setRole]=useState(null);
  const [supaUser,setSupaUser]=useState(null);
  const [selectedProvider,setSelectedProvider]=useState(null);
  const [pendingProvider,setPendingProvider]=useState(null);
  const [selectedSector,setSelectedSector]=useState(null);
  const [selectedMissionId,setSelectedMissionId]=useState(null);
  const [chatClientId,setChatClientId]=useState(null);
  const [paymentAmount,setPaymentAmount]=useState(0);
  const [paymentHours,setPaymentHours]=useState(8);
  const [paymentDate,setPaymentDate]=useState("");
  const [boUnlocked,setBoUnlocked]=useState(false);
  const [boTestMode,setBoTestMode]=useState(false);
  const [legalType,setLegalType]=useState("cgu");
  const [payslipData,setPayslipData]=useState(null);
  const [onlineStatus,setOnlineStatus]=useState(true);
  const [pendingMission,setPendingMission]=useState(null);
  const [bookingSource,setBookingSource]=useState("profile");
  const [unreadCount,setUnreadCount]=useState(0);
  const [notifCount,setNotifCount]=useState(0);
  const [clientCoords,setClientCoords]=useState(null);
  const [realProviders,setRealProviders]=useState([]);

  // Chargement des prestataires réels depuis Supabase
  useEffect(()=>{
    fetch("/api/prestataires")
      .then(r=>r.json())
      .then(({ prestataires })=>{
        if(!Array.isArray(prestataires)) return;
        setRealProviders(prestataires.map(p=>({
          id: p.id,
          name: p.name,
          jobTitle: p.metier || "Prestataire",
          role: p.metier || "Prestataire",
          avatar: "👤",
          color: C.violet,
          rating: 4.5,
          reviews: 0,
          hourlyRate: `${Math.round((p.tarif_net||12)*1.35)} €/h HT`,
          rateNum: Math.round((p.tarif_net||12)*1.35),
          tarifNet: p.tarif_net||12,
          available: !!p.dispo_immediat,
          sector: p.secteur,
          code_postal: p.code_postal,
          responseTime: "< 2h",
          distance: "—",
          _real: true,
        })));
      })
      .catch(()=>{});
  },[]);

  // Reset badge messages non lus quand le chat est ouvert
  useEffect(()=>{
    if(screen==="chat"){
      localStorage.setItem("alane_msg_last_seen", new Date().toISOString());
      setUnreadCount(0);
    }
    if(screen==="notifications") setNotifCount(0);
  },[screen]);

  // Géolocalisation au montage
  useEffect(()=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos=>setClientCoords({ lat:pos.coords.latitude, lng:pos.coords.longitude }),
        ()=>{}
      );
    }
  },[]);

  // Poll messages non lus toutes les 10 secondes
  useEffect(()=>{
    if(!supaUser) return;
    let mounted = true;
    const userId = supaUser.id;
    const poll = async()=>{
      const lastSeen = localStorage.getItem("alane_msg_last_seen") || new Date(0).toISOString();
      const { data, error } = await supabase
        .from("messages")
        .select("id", { count:"exact" })
        .ilike("conversation_key", `%${userId}%`)
        .neq("sender_tag","client")
        .gt("created_at", lastSeen);
      if(!error && mounted) setUnreadCount(data?.length || 0);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return ()=>{ mounted=false; clearInterval(interval); };
  },[supaUser]);

  // Poll notifications non lues toutes les 30 secondes
  useEffect(()=>{
    if(!supaUser) return;
    let mounted = true;
    const pollNotifs = async()=>{
      const { count } = await supabase.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",supaUser.id).eq("read",false);
      if(mounted) setNotifCount(count||0);
    };
    pollNotifs();
    const iv = setInterval(pollNotifs,30000);
    return ()=>{ mounted=false; clearInterval(iv); };
  },[supaUser]);

  // Écouter les changements de session (déconnexion, reset password)
  // Ne pas auto-naviguer au démarrage : l'utilisateur passe toujours par le splash
  useEffect(()=>{
    let initialized = false;
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event,session)=>{
      // INITIAL_SESSION : on met à jour supaUser silencieusement, sans naviguer
      if(event==="INITIAL_SESSION"){ setSupaUser(session?.user||null); initialized=true; return; }
      // TOKEN_REFRESHED : simple mise à jour du user, jamais de navigation
      if(event==="TOKEN_REFRESHED"){ setSupaUser(session?.user||null); return; }

      setSupaUser(session?.user||null);
      if(event==="PASSWORD_RECOVERY") { setScreen("reset_password"); return; }
      if(event==="SIGNED_OUT") {
        // Ignorer le SIGNED_OUT si on est déjà sur un écran pre-login (évite les sauts au démarrage)
        if(!initialized) return;
        localStorage.removeItem("alane_stay_logged_in");
        sessionStorage.removeItem("alane_session_active");
        setRole(null);
        const preLoginScreens = ["splash","role","auth_client","auth_presta","how_client","how_presta","client_onboarding","presta_onboarding","presta_pending","pending_approval","reset_password","bo_login","bo_dashboard"];
        setScreen(prev => preLoginScreens.includes(prev) ? prev : "role");
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Appelé quand l'utilisateur clique "Commencer" sur le splash
  const handleSplashNext = async () => {
    const { data:{ session } } = await supabase.auth.getSession();
    if(session){
      const stayLoggedIn  = localStorage.getItem("alane_stay_logged_in");
      const sessionActive = sessionStorage.getItem("alane_session_active");
      if (!stayLoggedIn && !sessionActive) {
        // Session Supabase persistée mais l'utilisateur n'a pas coché "Rester connecté"
        await supabase.auth.signOut();
        setScreen("role");
        return;
      }
      setSupaUser(session.user);
      const { data:profile } = await supabase.from("profiles").select("role,status").eq("id",session.user.id).single();
      if(profile?.role){
        setRole(profile.role);
        if(!profile.status || profile.status === "pending"){ setScreen("pending_approval"); return; }
        if(profile.status === "rejected"){ setScreen("role"); return; }
        setScreen(profile.role==="prestataire"?"p_home":"home");
        return;
      }
    }
    setScreen("role");
  };

  const PRESTA_SCREENS=["p_home","p_missions","p_dashboard","calendar","abonnement_presta","doc_upload","presta_profile_edit","presta_pointage"];
  const CLIENT_SCREENS=["home","catalogue","search_filters","dashboard","sector_detail","profile","cv","booking","stripe_pay","tracking","validation","cancellation","team_booking","mission_history","notifications","favorites","cashback","mission_request","mission_broadcast","mission_pending"];
  const navigate=(to,data)=>{
    if(role==="client"    && PRESTA_SCREENS.includes(to)) return;
    if(role==="prestataire" && CLIENT_SCREENS.includes(to)) return;
    if(to==="profile"||to==="chat"||to==="tracking"||to==="validation"||to==="cancellation"||to==="contract"||to==="presta_pointage") setSelectedProvider(data?.provider||data);
    if(to==="chat") setChatClientId(data?.clientId||null);
    if(to==="sector_detail") setSelectedSector(data);
    if(to==="booking") { setSelectedProvider(data); setBookingSource("profile"); }
    if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||""); }
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
      unreadCount={unreadCount}
    >
      {screen==="reset_password"    && <ResetPasswordScreen onDone={()=>setScreen("role")} />}
      {screen==="pending_approval"  && <PendingApprovalScreen onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} />}
      {screen==="settings"          && <SettingsScreen role={role} onNavigate={navigate} onBack={()=>setScreen(role==="prestataire"?"p_home":"home")} onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} />}
      {screen==="contact_support"   && <ContactSupportScreen onBack={()=>setScreen("settings")} />}
      {screen==="faq"               && <FAQScreen onBack={()=>setScreen("settings")} role={role} />}
      {screen==="splash"            && <SplashScreen onNext={handleSplashNext} onBackoffice={()=>setScreen("bo_login")} />}
      {screen==="role"              && <RoleScreen onSelect={r=>{ setRole(r); setScreen(r==="prestataire"?"auth_presta":"auth_client"); }} />}

      {/* Auth — connexion ou inscription pour les deux rôles */}
      {screen==="auth_client"       && <AuthScreen role="client"
          onLogin={()=>{ setRole("client"); setScreen("home"); }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}
      {screen==="auth_presta"       && <AuthScreen role="prestataire"
          onLogin={()=>{ setRole("prestataire"); setScreen("p_home"); }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}

      {/* Comment ca marche — uniquement pour les nouveaux inscrits */}
      {screen==="how_client"        && <HowItWorksScreen role="client" onNext={()=>setScreen("client_onboarding")} onBack={()=>setScreen("auth_client")} />}
      {screen==="how_presta"        && <HowItWorksScreen role="prestataire" onNext={()=>setScreen("presta_onboarding")} onBack={()=>setScreen("auth_presta")} />}

      {/* Onboarding complet — uniquement pour les nouveaux */}
      {screen==="client_onboarding" && <ClientOnboarding onComplete={()=>setScreen("home")} onBack={()=>setScreen("how_client")} />}
      {screen==="client_auth"       && <AuthScreen role="client" onLogin={()=>setScreen("home")} onRegister={()=>setScreen("how_client")} onBack={()=>setScreen("role")} />}
      {screen==="home"              && <HomeScreen onNavigate={navigate} notifCount={notifCount} />}
      {screen==="catalogue"         && <CatalogueScreen onNavigate={navigate} realProviders={realProviders} />}
      {screen==="sector_detail"     && <SectorDetailScreen sector={selectedSector} onNavigate={navigate} clientCoords={clientCoords} realProviders={realProviders} />}
      {screen==="mission_request"   && <MissionRequestScreen sector={selectedSector} onBack={()=>setScreen("sector_detail")} onSubmit={(m)=>{ if(m?.id) setSelectedMissionId(m.id); setScreen("mission_broadcast"); setPendingMission(m); }} />}
      {screen==="mission_broadcast" && <MissionBroadcastScreen mission={pendingMission} onCancel={()=>setScreen("mission_request")} onChoose={p=>{ setSelectedProvider(p); setBookingSource("mission_broadcast"); setScreen("booking"); }} />}
      {screen==="search_filters"    && <SearchFiltersScreen onNavigate={navigate} />}
      {screen==="profile"           && <ProfileScreen provider={selectedProvider} onNavigate={navigate} onBack={()=>setScreen(selectedSector?"sector_detail":"search_filters")} />}
      {screen==="cv"                && <CVScreen provider={selectedProvider} onBack={()=>setScreen("profile")} onNavigate={navigate} />}
      {screen==="booking"           && <BookingScreen provider={selectedProvider} onNavigate={(to,data)=>{ if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||""); setScreen("stripe_pay"); } else navigate(to,data); }} onBack={()=>{ setBookingSource("profile"); setScreen(bookingSource); }} />}
      {screen==="stripe_pay"        && <StripePaymentScreen amount={paymentAmount} provider={selectedProvider} onSuccess={async()=>{
        setPendingProvider(selectedProvider);
        if(selectedMissionId && selectedProvider?.id){
          const today=new Date().toDateString();
          const mDay=paymentDate?new Date(paymentDate).toDateString():null;
          const isSameDay=!mDay||mDay===today;
          const deadline=new Date(Date.now()+(isSameDay?1:4)*3600000).toISOString();
          await supabase.from("missions").update({ prestataire_id:selectedProvider.id, status:"pending_acceptance", acceptance_deadline:deadline }).eq("id",selectedMissionId);
          await supabase.from("notifications").insert({ user_id:selectedProvider.id, type:"mission_request", title:"Nouvelle demande de mission", message:`Un client vous propose une mission. Vous avez ${isSameDay?"1 heure":"4 heures"} pour accepter ou refuser.` });
        }
        setScreen("mission_pending");
      }} onBack={()=>setScreen("booking")} />}
      {screen==="mission_pending"   && <MissionPendingScreen
        provider={pendingProvider||selectedProvider}
        amount={paymentAmount}
        missionId={selectedMissionId}
        hours={paymentHours}
        onAccepted={()=>setScreen("contract")}
        onCancelled={()=>{ setScreen("sector_detail"); }}
        onBack={()=>setScreen("home")}
      />}
      {screen==="contract"          && <ContractScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} missionId={selectedMissionId} onSign={()=>setTimeout(()=>setScreen("tracking"),1000)} onBack={()=>setScreen("stripe_pay")} />}
      {screen==="tracking"          && <TrackingScreen provider={selectedProvider} missionId={selectedMissionId} onNavigate={navigate} />}
      {screen==="validation"        && <ValidationScreen provider={selectedProvider} role={role} missionId={selectedMissionId} onNavigate={navigate} />}
      {screen==="invoice"           && <InvoiceScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} missionId={selectedMissionId} onBack={()=>setScreen("dashboard")} />}
      {screen==="cancellation"      && <CancellationScreen provider={selectedProvider} missionId={selectedMissionId} missionDate={paymentAmount?.date||null} onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="team_booking"      && <TeamBookingScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="mission_history"   && <MissionHistoryScreen onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="chat"              && <ChatScreen provider={selectedProvider} chatClientId={chatClientId} onBack={()=>setScreen(role==="prestataire"?"p_missions":"search_filters")} />}
      {screen==="notifications"     && <NotificationsScreen onBack={()=>setScreen("home")} onNavigate={navigate} />}
      {screen==="favorites"         && <FavoritesScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="referral"          && <ReferralScreen onBack={()=>setScreen("home")} />}
      {screen==="abonnement_presta" && <AbonnementPrestaScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="cashback"          && <CashbackWalletScreen onBack={()=>setScreen("dashboard")} onNavigate={navigate} />}
      {screen==="rating"            && <RatingScreen provider={selectedProvider} onSubmit={()=>setScreen("home")} onBack={()=>setScreen("validation")} />}
      {screen==="doc_upload"           && <DocUploadScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_profile_edit"  && <PrestaProfileEditScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_pointage"      && <PrestaPointageScreen provider={{...selectedProvider, _pointageType:undefined}} type={selectedProvider?._pointageType||"in"} onSuccess={()=>setScreen("p_missions")} onBack={()=>setScreen("p_missions")} />}
      {screen==="calendar"          && <CalendarScreen />}
      {screen==="legal"             && <LegalScreen type={legalType} onBack={()=>setScreen(role?"dashboard":"splash")} />}
      {screen==="payslip"           && <PayslipScreen provider={payslipData?.provider||selectedProvider} mission={payslipData} onBack={()=>setScreen(role==="prestataire"?"p_dashboard":"dashboard")} />}
      {screen==="bo_login"          && <BackofficeLogin onLogin={()=>{ setBoUnlocked(true); setScreen("bo_dashboard"); }} onBack={()=>setScreen("splash")} />}
      {screen==="bo_dashboard"      && boUnlocked && <BackofficeDashboard onBack={()=>{ sessionStorage.removeItem("bo_token"); setBoUnlocked(false); setScreen("splash"); }} onNavigate={(s,r,data)=>{ if(r) setRole(r); setBoTestMode(true); navigate(s,data); }} />}
      {boTestMode && screen!=="bo_dashboard" && (
        <div style={{ position:"fixed", bottom:80, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:C.violet, borderRadius:30, padding:"10px 20px", display:"flex", alignItems:"center", gap:8, boxShadow:"0 4px 20px rgba(124,111,224,0.5)", cursor:"pointer", whiteSpace:"nowrap" }}
          onClick={()=>{ setBoTestMode(false); setRole(null); setScreen("bo_dashboard"); }}>
          <span style={{ color:"#fff", fontSize:13, fontWeight:700 }}>← Retour BO</span>
        </div>
      )}

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
                  <Badge color={getCashbackTier(0).color} small>
                    {getCashbackTier(0).icon} {getCashbackTier(0).label}
                  </Badge>
                </div>
                <div style={{ color:C.textSub, fontSize:12 }}>
                  <strong style={{ color:C.success }}>0,00 €</strong> · {(getCashbackTier(0).rate*100).toFixed(0)}% sur chaque mission
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
              { icon:"🎁", label:"Parrainage",         sub:"3 filleuls Premium = 1 mois offert", action:"referral"      },
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
              <div style={{ color:C.textMuted, fontSize:11, marginBottom:8 }}>ALANE v1.0 — Île-de-France</div>
              <button onClick={async()=>{ if(window.confirm("Se déconnecter ?")) { await supabase.auth.signOut(); setRole(null); setScreen("role"); }}} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:r, padding:"10px 28px", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
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

      {role==="prestataire" && (screen==="p_home"||screen==="p_missions"||screen==="p_dashboard") && (
        <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
          <PrestaDashboard activeScreen={screen} onNavigate={(to,data)=>{
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
              </div>
            </div>
          )}
        </div>
      )}
    </ResponsiveLayout>
  );
}