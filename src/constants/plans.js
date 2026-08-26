export const IS_LAUNCH = true;
export const isLaunchPhase = () => IS_LAUNCH;

export const FRAIS_MER = { single:4.90, range:2.90, urgent:9.90 };

// Ce que chaque plan apporte RÉELLEMENT.
//
// Trois mentions ont été retirées le 17/08/2026 : « Prestations urgentes (tarif
// majoré de 30%) », vendue comme un avantage Premium et Elite et comme un manque
// du plan gratuit.
//
// Elle était fausse deux fois. Aucun filtre par plan n'existe — le plan gratuit
// accède aux prestations urgentes exactement pareil, vérifié dans le tunnel de
// réservation comme dans `candidatsPourMission` — et la majoration n'est pas de
// 30 % mais du montant fixe de `platform_settings.urgency_surcharge`, 2 € HT par
// heure par défaut.
//
// Vendre une caractéristique substantielle inexacte est une pratique commerciale
// trompeuse (article L121-2 du Code de la consommation). Décision du 17/08/2026 :
// l'urgence reste ouverte à tous, et l'abonnement se vend sur ce qu'il change
// vraiment — le quota mensuel, le badge, et le classement dans les résultats.
export const ABONNEMENTS_PRESTA = [
  // `missions` n'est qu'un repli d'affichage : la limite opposable vient de
  // /api/missions (`limite_mensuelle`), qui applique plan_limits et l'offre de
  // lancement. Elle valait 10 ici alors que le plan gratuit en accorde 2 hors
  // lancement — l'écran annonçait « 2/10 » à un prestataire déjà bloqué.
  { id:"free",    label:"Gratuit", price:0,  color:"#8B8FA8", icon:"🆓", missions:2,  popular:false,
    features:["2 prestations/mois","Profil visible par les clients"],
    locked:["8 prestations/mois","Badge ✓ Certifié — les clients te font davantage confiance","Priorité dans les résultats de recherche"],
    note:"🎁 Offre de lancement : 8 prestations/mois offertes aux 100 premiers prestataires validés." },
  { id:"premium", label:"Premium", price:29.99, color:"#7C6FE0", icon:"💎", missions:8, popular:true,
    features:["8 prestations/mois","Badge ✓ Certifié affiché sur ton profil — visible par tous les clients"],
    locked:["Badge 👑 Elite et position #1 garantie dans les résultats"] },
  { id:"elite",   label:"Elite",   price:79.99, color:"#F0B429", icon:"👑", missions:999, popular:false,
    features:["Prestations illimitées","Badge 👑 Elite — ton profil apparaît en tête des résultats","Position #1 dans les recherches (attribuée selon note moyenne et avis)"],
    locked:[],
    note:"La position #1 est attribuée parmi les membres Elite selon la note moyenne et les avis clients." },
];

export const prixClient = (tarifNet) => tarifNet;
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
