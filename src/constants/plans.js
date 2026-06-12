export const IS_LAUNCH = true;
export const isLaunchPhase = () => IS_LAUNCH;

export const MARGES = {
  proprete:0.20, logistique:0.18, hotellerie:0.20,
  restauration:0.25, commercial:0.22, distribution:0.18, divers:0.20,
};

export const FRAIS_MER = { single:4.90, range:2.90, urgent:9.90 };

export const ABONNEMENTS_PRESTA = [
  { id:"free",    label:"Gratuit", price:0,  color:"#8B8FA8", icon:"🆓", missions:10,  popular:false,
    features:["2 missions/mois (10 pendant le lancement)","Profil visible par les clients"],
    locked:["10 missions/mois","Badge ✓ Certifié — les clients te font davantage confiance","Missions urgentes (tarif majoré)","Priorité dans les résultats de recherche"],
    note:"* 10 missions/mois réservé aux 100 premiers inscrits. 2 missions/mois ensuite." },
  { id:"premium", label:"Premium", price:29, color:"#7C6FE0", icon:"⚡", missions:10, popular:true,
    features:["10 missions/mois","Badge ✓ Certifié affiché sur ton profil — visible par tous les clients","Missions urgentes (tarif majoré de 30%)"],
    locked:["Badge 👑 Elite et position #1 garantie dans les résultats"] },
  { id:"elite",   label:"Elite",   price:59, color:"#F0B429", icon:"👑", missions:999, popular:false,
    features:["Missions illimitées","Badge 👑 Elite — ton profil apparaît en tête des résultats","Missions urgentes (tarif majoré de 30%)","Position #1 dans les recherches (attribuée selon note moyenne et avis)"],
    locked:[],
    note:"La position #1 est attribuée parmi les membres Elite selon la note moyenne et les avis clients." },
];

export const prixClient = (tarifNet, _sector) => tarifNet;
export const tarifInterim = (t) => Math.round(t * 2.2 * 100) / 100;
export const economiePct  = (t) => Math.round(((tarifInterim(t) - t) / tarifInterim(t)) * 100);
export const formatE = (v) => v.toFixed(2).replace(".", ",") + " €/h";

export const CASHBACK_TIERS = [
  { id:"standard", min:0,  max:2,  rate:0.005,  label:"Standard", icon:"🥉", color:"#8B8FA8" },
  { id:"silver",   min:3,  max:5,  rate:0.0075, label:"Silver",   icon:"🥈", color:"#C0C0C0" },
  { id:"gold",     min:6,  max:9,  rate:0.01,   label:"Gold",     icon:"🥇", color:"#F0B429" },
  { id:"platinum", min:10, max:999, rate:0.015,  label:"Platinum", icon:"💎", color:"#A89DF5" },
];
export const getCashbackTier = (missions) => CASHBACK_TIERS.slice().reverse().find(t => missions >= t.min) || CASHBACK_TIERS[0];
export const calcCashback = (amount, missions) => amount * getCashbackTier(missions).rate;
