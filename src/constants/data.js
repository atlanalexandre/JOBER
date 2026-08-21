export const CP_COORDS = {
  "75":[ 48.8566,  2.3522], "92":[ 48.8924,  2.2540], "93":[ 48.9156,  2.4825],
  "94":[ 48.7847,  2.4697], "91":[ 48.6325,  2.4427], "95":[ 49.0379,  2.0769],
  "77":[ 48.8400,  2.9713], "78":[ 48.8017,  1.9670], "69":[ 45.7640,  4.8357],
  "13":[ 43.2965,  5.3698], "33":[ 44.8378, -0.5792], "31":[ 43.6047,  1.4442],
  "59":[ 50.6292,  3.0573], "67":[ 48.5734,  7.7521], "44":[ 47.2184, -1.5536],
  "06":[ 43.7102,  7.2620], "34":[ 43.6119,  3.8772], "76":[ 49.4432,  1.0993],
  "38":[ 45.1885,  5.7245], "35":[ 48.1173, -1.6778],
};

export function cpToCoords(cp) {
  const dept = (cp||"").slice(0,2);
  return CP_COORDS[dept] || null;
}

// Génère un code à 4 chiffres déterministe basé sur l'ID du prestataire + date du jour
// Les deux parties (client et presta) calculent le même code sans communication
export function genMissionCode(provId, type) {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const idStr = String(provId || "");
  let h = 0;
  for (let i = 0; i < idStr.length; i++) { h = (Math.imul(31, h) + idStr.charCodeAt(i)) | 0; }
  const base = (Math.abs(h) + parseInt(today.slice(-4)) * 31) % 9000;
  const offset = type === "out" ? 4567 : 0;
  return String(((Math.abs(base) + offset) % 9000) + 1000).slice(-4);
}

export const SECTORS = [
  { id:"proprete",     label:"Propreté",        icon:"🧹", color:"#4FC3F7", bg:"#E3F7FF", count:15, banner:"🏢", marge:0.20 },
  { id:"logistique",   label:"Logistique",      icon:"📦", color:"#81C784", bg:"#E8F5E9", count:24, banner:"🏭", marge:0.18 },
  { id:"hotellerie",   label:"Hôtellerie",      icon:"🏨", color:"#FFB74D", bg:"#FFF3E0", count:22, banner:"🏨", marge:0.20 },
  { id:"restauration", label:"Restauration",    icon:"🍽️", color:"#F06292", bg:"#FCE4EC", count:29, banner:"🍴", marge:0.25 },
  { id:"commercial",   label:"Commercial",      icon:"💼", color:"#BA68C8", bg:"#F3E5F5", count:23, banner:"📊", marge:0.22 },
  { id:"distribution", label:"Grande Distrib.", icon:"🛒", color:"#4DB6AC", bg:"#E0F2F1", count:26, banner:"🏬", marge:0.18 },
  { id:"divers",       label:"Divers",          icon:"✨", color:"#7986CB", bg:"#E8EAF6", count:22, banner:"🎯", marge:0.20 },
];

// Fourchettes tarifaires nettes par métier (ce que le prestataire encaisse)
// Le client voit toujours prixClient(tarifNet, sector)
// ═══════════════════════════════════════════════════════════════════════════
// LE CATALOGUE N'EXCLUT AUCUN MÉTIER — L'ARTICLE 4.1 DES CGPS EXCLUT DES
// MODALITÉS D'EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════
//
// L'article 4.1 interdisait nommément « opérateur de production,
// manutentionnaire, préparateur de commandes, cariste, conditionneur » — que ce
// fichier proposait pourtant. Les conditions générales interdisaient donc ce que
// la plateforme vendait, et personne ne s'en était aperçu.
//
// L'article a été réécrit le 21/08/2026 : ce qui est exclu, ce sont les
// modalités qui font une mise à disposition de personnel (intégration à une
// équipe du client, poste permanent, cadences imposées, fourniture de
// main-d'œuvre sans travail déterminé), et non l'intitulé du métier. C'est le
// critère que retient le juge, et une liste de noms de métiers n'aurait de toute
// façon rien empêché : elle laisse passer une mise à disposition déguisée sous
// un autre nom et interdit des prestations régulières.
//
// Conséquence pour ce fichier : ajouter un métier ne pose pas de question de
// principe. Ce qui doit rester vrai, c'est qu'une prestation ait un OBJET
// DÉTERMINÉ et une DURÉE DÉFINIE, ce que garantit le parcours de commande.
//
// Deux familles restent volontairement absentes, pour des raisons qui ne
// tiennent pas au droit du travail :
//   • le bâtiment (électricien, plombier, couvreur) — garantie décennale, non
//     couverte par la RC Pro demandée à l'inscription ;
//   • les professions de santé réglementées (aide-soignant, auxiliaire de
//     puériculture) — diplôme d'État que la plateforme ne vérifie pas.
// ═══════════════════════════════════════════════════════════════════════════
export const METIERS_TARIFS = {
  // ROME K2204 - Nettoyage de locaux | K2202 - Lavage de vitres
  proprete:{
    "Agent de propreté":                    { min:11.5, max:13.5, default:12   },
    "Agent de propreté et d'hygiène":       { min:11.5, max:13.5, default:12   },
    "Agent d'entretien des bureaux":        { min:11.5, max:13,   default:12   },
    "Agent de nettoyage industriel":        { min:12,   max:15,   default:13   },
    "Agent multiservice":                   { min:11.5, max:14,   default:12   },
    "Technicien de surface":                { min:13,   max:16,   default:14   },
    "Laveur de vitres":                     { min:13,   max:16,   default:14   },
    "Nettoyeur haute pression":             { min:13,   max:16,   default:14   },
    "Opérateur de machines de nettoyage":   { min:12,   max:15,   default:13   },
    "Opérateur de nettoyage spécialisé":    { min:14,   max:18,   default:15   },
    "Agent de désinfection":                { min:12,   max:15,   default:13   },
    "Chef d'équipe propreté":               { min:14,   max:17,   default:15   },
    "Chef de chantier propreté":            { min:16,   max:21,   default:18   },
    "Responsable de site propreté":         { min:17,   max:23,   default:19   },
    "Responsable qualité propreté":         { min:18,   max:25,   default:21   },
    // Ajoutés le 21/08/2026 — le catalogue s'arrêtait au nettoyage de bureaux,
    // alors que l'essentiel du marché de la propreté est ailleurs : santé,
    // agroalimentaire, remise en état, travail en hauteur.
    "Agent de bionettoyage (milieu de santé)": { min:13, max:17,   default:14   },
    "Agent de service hospitalier (ASH)":   { min:12,   max:15,   default:13   },
    "Agent de propreté en EHPAD":           { min:12,   max:15.5, default:13   },
    "Agent de propreté en agroalimentaire": { min:12.5, max:16,   default:13.5 },
    "Agent de remise en état après sinistre": { min:14, max:19,   default:16   },
    "Agent de propreté urbaine":            { min:12,   max:15,   default:13   },
    "Agent de collecte des déchets":        { min:12,   max:15,   default:13   },
    "Laveur de vitres en hauteur (cordiste)": { min:18, max:28,   default:22   },
    "Agent de blanchisserie / Repasseur":   { min:11.5, max:14,   default:12   },
    "Agent d'entretien d'espaces verts":    { min:12,   max:15.5, default:13   },
  },
  // ROME N1101-N1303 - Logistique, manutention, magasinage
  logistique:{
    "Manutentionnaire":                     { min:11.5, max:13,   default:11.8 },
    "Préparateur de commandes":             { min:11.5, max:13.5, default:12   },
    "Préparateur de commandes vocales":     { min:12,   max:14,   default:12.5 },
    "Préparateur de commandes click&collect":{ min:12,  max:14,   default:12.5 },
    "Agent de quai":                        { min:11.5, max:14,   default:12   },
    "Opérateur de tri":                     { min:11.5, max:13,   default:12   },
    "Opérateur de réception":               { min:12,   max:14,   default:12.5 },
    "Agent d'expédition":                   { min:12,   max:15,   default:13   },
    "Réceptionnaire marchandises":          { min:12,   max:15,   default:13   },
    "Magasinier":                           { min:12,   max:15,   default:13   },
    "Cariste CACES 1":                      { min:13,   max:16,   default:14   },
    "Cariste CACES 3":                      { min:14,   max:17,   default:15   },
    "Cariste CACES 5":                      { min:14,   max:18,   default:15.5 },
    "Opérateur logistique":                 { min:12,   max:15,   default:13   },
    "Gestionnaire de stocks":               { min:14,   max:19,   default:16   },
    "Agent de fret":                        { min:13,   max:17,   default:14.5 },
    "Coordinateur logistique":              { min:16,   max:22,   default:18   },
    "Chef d'équipe logistique":             { min:17,   max:24,   default:19   },
    "Responsable logistique":               { min:18,   max:26,   default:21   },
    "Conditionneur / Opérateur de conditionnement": { min:11.5, max:13, default:11.8 },
    "Chargeur / Déchargeur":                { min:11.5, max:13,   default:12   },
    "Cariste CACES 2":                      { min:13,   max:16,   default:14   },
    "Dispatcher logistique":                { min:15,   max:21,   default:17   },
    "Agent de transit":                     { min:14,   max:19,   default:16   },
    // Ajoutés le 21/08/2026.
    "Approvisionneur":                      { min:14,   max:19,   default:16   },
    "Contrôleur qualité logistique":        { min:14,   max:19,   default:16   },
    "Inventoriste logistique":              { min:12,   max:15,   default:13   },
    "Opérateur retours / SAV logistique":   { min:12.5, max:16,   default:13.5 },
    "Planificateur transport":              { min:16,   max:22,   default:18   },
    "Déclarant en douane":                  { min:17,   max:25,   default:20   },
    "Responsable d'entrepôt":               { min:19,   max:28,   default:22   },
  },
  // ROME G1401-G1502 - Hôtellerie
  hotellerie:{
    "Équipier polyvalent hôtellerie":       { min:11.5, max:14,   default:12   },
    "Femme/Valet de chambre":               { min:11.5, max:14,   default:12.5 },
    "Liftier":                              { min:12,   max:14,   default:12.5 },
    "Bagagiste / Portier":                  { min:12,   max:15,   default:13   },
    "Voiturier":                            { min:12,   max:15,   default:13   },
    "Standardiste hôtelier":                { min:12,   max:15,   default:13   },
    "Agent d'accueil hôtelier":             { min:12,   max:15,   default:13   },
    "Agent de réservation":                 { min:13,   max:16,   default:14   },
    "Réceptionniste":                       { min:12,   max:15,   default:13   },
    "Réceptionniste bilingue":              { min:13,   max:17,   default:14.5 },
    "Veilleur de nuit":                     { min:13,   max:16,   default:14   },
    "Night Auditor":                        { min:14,   max:18,   default:16   },
    "Concierge d'hôtel":                    { min:14,   max:18,   default:15   },
    "Gouvernant(e) d'étage":                { min:14,   max:18,   default:15.5 },
    "Responsable des étages":               { min:16,   max:21,   default:18   },
    "Gouvernant(e) général(e)":             { min:18,   max:24,   default:20   },
    "Lingère / Employé(e) de lingerie":     { min:11.5, max:14,   default:12   },
    "Équipier petit-déjeuner":              { min:11.5, max:14,   default:12   },
    "Chasseur / Groom":                     { min:11.5, max:14,   default:12.5 },
    "Chef de réception":                    { min:17,   max:23,   default:19   },
    "Responsable hébergement":              { min:19,   max:27,   default:22   },
    "Directeur d'hôtel":                    { min:25,   max:40,   default:30   },
    "Spa praticien / Esthéticien":          { min:13,   max:18,   default:15   },
    "Majordome":                            { min:18,   max:28,   default:22   },
    "Runner hôtelier":                      { min:11.5, max:13,   default:12   },
    "Animateur club enfants":               { min:12,   max:15,   default:13   },
  },
  // ROME G1501-G1606 - Restauration
  restauration:{
    "Runner":                               { min:11.5, max:13,   default:12   },
    "Plongeur":                             { min:11.5, max:13,   default:11.8 },
    "Équipier restauration rapide":         { min:11.5, max:13,   default:11.8 },
    "Vendeur en restauration":              { min:11.5, max:13.5, default:12   },
    "Hôte(sse) d'accueil restaurant":       { min:12,   max:14,   default:12.5 },
    "Serveur(se)":                          { min:11.5, max:14,   default:12   },
    "Barman / Barmaid":                     { min:12,   max:16,   default:13   },
    "Barista":                              { min:12,   max:15,   default:13   },
    "Commis de cuisine":                    { min:12,   max:14,   default:12.5 },
    "Cuisinier":                            { min:13,   max:17,   default:14.5 },
    "Pizzaïolo":                            { min:13,   max:18,   default:15   },
    "Rôtisseur":                            { min:13,   max:17,   default:14.5 },
    "Traiteur":                             { min:14,   max:20,   default:16   },
    "Sushi man":                            { min:14,   max:20,   default:16   },
    "Chef de rang":                         { min:13,   max:17,   default:14.5 },
    "Chef de partie":                       { min:15,   max:21,   default:17   },
    "Pâtissier":                            { min:14,   max:20,   default:16.5 },
    "Sommelier":                            { min:16,   max:23,   default:19   },
    "Responsable de salle":                 { min:16,   max:22,   default:18   },
    "Second de cuisine":                    { min:17,   max:24,   default:20   },
    "Maître d'hôtel":                       { min:17,   max:24,   default:19   },
    "Chef de cuisine":                      { min:20,   max:35,   default:25   },
    "Responsable restauration collective":  { min:18,   max:27,   default:22   },
    "Directeur de restaurant":              { min:22,   max:35,   default:27   },
    "Commis pâtissier":                     { min:12,   max:15,   default:13   },
    "Glacier":                              { min:13,   max:17,   default:14.5 },
    "Poissonnier-écailler":                 { min:14,   max:20,   default:16   },
    "Cuisinier de collectivité":            { min:13,   max:17,   default:14.5 },
    "Agent de restauration scolaire":       { min:11.5, max:13.5, default:12   },
    // Ajoutés le 21/08/2026.
    "Employé de cafétéria":                 { min:11.5, max:13.5, default:12   },
    "Serveur banquet / extra":              { min:12,   max:16,   default:13.5 },
    "Crêpier":                              { min:13,   max:17,   default:14.5 },
    "Grillardin":                           { min:13,   max:17,   default:14.5 },
    "Boulanger":                            { min:13,   max:18,   default:15   },
    "Chocolatier":                          { min:14,   max:20,   default:16   },
    "Chef pâtissier":                       { min:18,   max:28,   default:22   },
    "Chef sommelier / Caviste":             { min:18,   max:26,   default:21   },
    "Assistant maître d'hôtel":             { min:15,   max:20,   default:17   },
    "Responsable de production culinaire":  { min:18,   max:26,   default:21   },
    "Chef gérant en restauration collective": { min:17, max:25,   default:20   },
  },
  // ROME D1401-D1506 - Commerce, vente
  commercial:{
    "Conseiller de vente":                  { min:12,   max:16,   default:13.5 },
    "Télévendeur":                          { min:12,   max:15,   default:13   },
    "Téléconseiller":                       { min:12,   max:15,   default:13   },
    "Commercial sédentaire":                { min:13,   max:17,   default:14.5 },
    "Animateur commercial":                 { min:13,   max:17,   default:14.5 },
    "Promoteur des ventes (PLV)":           { min:13,   max:18,   default:15   },
    "Prospecteur commercial":               { min:13,   max:18,   default:14.5 },
    "Commercial terrain":                   { min:13,   max:19,   default:15   },
    "Attaché commercial":                   { min:14,   max:20,   default:16   },
    "Agent commercial":                     { min:13,   max:19,   default:15   },
    "Chargé de clientèle":                  { min:14,   max:19,   default:16   },
    "Chargé de développement commercial":   { min:16,   max:24,   default:19   },
    "Négociateur commercial":               { min:15,   max:23,   default:18   },
    "Responsable de secteur":               { min:18,   max:28,   default:22   },
    "Business developer":                   { min:18,   max:30,   default:23   },
    "Ingénieur commercial":                 { min:20,   max:35,   default:26   },
    "Responsable comptes clés":             { min:22,   max:35,   default:27   },
    "Manager commercial":                   { min:20,   max:30,   default:24   },
    "VRP (Voyageur Représentant Placier)":  { min:14,   max:22,   default:17   },
    "Technico-commercial":                  { min:16,   max:26,   default:20   },
    "Chef des ventes":                      { min:22,   max:35,   default:27   },
    "Délégué commercial":                   { min:14,   max:21,   default:17   },
    "Chargé d'affaires":                    { min:18,   max:30,   default:23   },
    // Ajoutés le 21/08/2026.
    "Assistant commercial":                 { min:13,   max:17,   default:14.5 },
    "Conseiller clientèle particuliers":    { min:14,   max:19,   default:16   },
    "Conseiller clientèle professionnels":  { min:16,   max:24,   default:19   },
    "Démonstrateur / Animateur de stand":   { min:12,   max:16,   default:13.5 },
    "Merchandiser terrain":                 { min:13,   max:17,   default:14.5 },
    "Chargé de recouvrement":               { min:14,   max:19,   default:16   },
    "Chargé de marketing opérationnel":     { min:16,   max:24,   default:19   },
    "Chef de secteur GMS":                  { min:18,   max:27,   default:21   },
    "Responsable e-commerce":               { min:18,   max:28,   default:22   },
  },
  // ROME D1507-D1513 - Grande distribution
  distribution:{
    "Hôte(sse) de caisse":                  { min:11.5, max:13,   default:11.8 },
    "Caissier(ère) principal(e)":           { min:12,   max:14,   default:12.5 },
    "Employé de rayon":                     { min:11.5, max:13.5, default:12   },
    "Employé de drive":                     { min:11.5, max:13.5, default:12   },
    "Préparateur drive":                    { min:12,   max:14,   default:12.5 },
    "Inventoriste":                         { min:11.5, max:14,   default:12   },
    "Livreur courses à domicile":           { min:12,   max:15,   default:13   },
    "Merchandiser":                         { min:12,   max:15,   default:13   },
    "Hôte(sse) d'accueil magasin":          { min:12,   max:14,   default:12.5 },
    "Boulanger en GMS":                     { min:13,   max:17,   default:14.5 },
    "Charcutier-traiteur":                  { min:13,   max:18,   default:15   },
    "Fromager en GMS":                      { min:13,   max:17,   default:14.5 },
    "Poissonnier en GMS":                   { min:13,   max:18,   default:15   },
    "Boucher en GMS":                       { min:14,   max:19,   default:16   },
    "Vendeur en prêt-à-porter":             { min:12,   max:15,   default:13   },
    "Vendeur en bricolage":                 { min:12,   max:16,   default:13.5 },
    "Vendeur en électroménager":            { min:13,   max:17,   default:14.5 },
    "Chef de rayon alimentaire":            { min:15,   max:21,   default:17   },
    "Chef de rayon non-alimentaire":        { min:15,   max:21,   default:17   },
    "Responsable de secteur GMS":           { min:17,   max:24,   default:20   },
    "Responsable adjoint magasin":          { min:16,   max:23,   default:19   },
    "Directeur de magasin":                 { min:22,   max:35,   default:27   },
    "Conseiller jardinerie":                { min:12,   max:16,   default:13.5 },
    "Fleuriste en GMS":                     { min:12,   max:16,   default:13.5 },
    "Vendeur en parfumerie":                { min:12,   max:16,   default:13.5 },
    "Vendeur en sport":                     { min:12,   max:16,   default:13.5 },
    // Ajoutés le 21/08/2026.
    "Employé libre-service":                { min:11.5, max:13.5, default:12   },
    "Réassortisseur":                       { min:11.5, max:13.5, default:12   },
    "Chef de caisse":                       { min:14,   max:19,   default:16   },
    "Hôte(sse) service client / SAV":       { min:12.5, max:16,   default:13.5 },
    "Employé de station-service":           { min:11.5, max:14,   default:12.5 },
    "Vendeur en boulangerie-pâtisserie":    { min:12,   max:15,   default:13   },
    "Vendeur en librairie / papeterie":     { min:12,   max:15,   default:13   },
    "Vendeur en téléphonie":                { min:12,   max:16,   default:13.5 },
    "Vendeur en optique":                   { min:13,   max:18,   default:15   },
    "Agent de prévention des pertes (magasin)": { min:13, max:17, default:14.5 },
  },
  // ROME K2503, G1203, M1601, M1607, N4101, N4105, K1303...
  divers:{
    "Employé polyvalent":                   { min:11.5, max:13.5, default:12   },
    "Aide à domicile":                      { min:11.5, max:14,   default:12   },
    "Coursier / Livreur":                   { min:12,   max:15,   default:13   },
    "Facteur":                              { min:12,   max:14,   default:12.5 },
    "Chauffeur livreur":                    { min:12,   max:16,   default:13.5 },
    "Hôte(sse) d'accueil":                 { min:12,   max:15,   default:12.5 },
    "Hôte(sse) d'événement":               { min:12,   max:15,   default:13   },
    "Animateur(trice) événementiel(le)":    { min:12,   max:16,   default:13.5 },
    "Agent de sécurité":                    { min:12,   max:16,   default:13.5 },
    "Agent de sûreté":                      { min:13,   max:17,   default:14.5 },
    "Gardien d'immeuble":                   { min:12,   max:15,   default:13   },
    "Standardiste":                         { min:12,   max:15,   default:13   },
    "Agent d'accueil":                      { min:12,   max:15,   default:12.5 },
    "Auxiliaire de vie":                    { min:12,   max:16,   default:13.5 },
    "Assistant(e) administratif(ve)":       { min:13,   max:17,   default:14   },
    "Secrétaire":                           { min:13,   max:17,   default:14.5 },
    "Chauffeur VTC":                        { min:14,   max:20,   default:16   },
    "Téléconseiller":                       { min:12,   max:15,   default:13   },
    "Éducateur sportif / Coach":            { min:14,   max:22,   default:17   },
    "Agent de médiation":                   { min:13,   max:18,   default:15   },
    "Photographe événementiel":             { min:16,   max:28,   default:21   },
    "Technicien son / lumière":             { min:15,   max:25,   default:19   },
    // Ajoutés le 21/08/2026. Volontairement écartés : les métiers du bâtiment
    // (électricien, plombier, couvreur), qui relèvent de la garantie décennale
    // et d'assurances que la RC Pro demandée à l'inscription ne couvre pas, et
    // les professions de santé réglementées (aide-soignant, auxiliaire de
    // puériculture), dont l'exercice suppose un diplôme d'État que la
    // plateforme ne vérifie pas.
    "Agent de sécurité incendie SSIAP 1":   { min:13.5, max:17,   default:15   },
    "Agent de sécurité incendie SSIAP 2":   { min:16,   max:21,   default:18   },
    "Agent cynophile de sécurité":          { min:15,   max:20,   default:17   },
    "Maître-nageur sauveteur (BNSSA)":      { min:14,   max:20,   default:16   },
    "Animateur périscolaire (BAFA)":        { min:12,   max:15,   default:13   },
    "Chauffeur poids lourd (permis C)":     { min:14,   max:19,   default:16   },
    "Chauffeur de bus / autocar":           { min:14,   max:19,   default:16   },
    "Déménageur":                           { min:12.5, max:16,   default:13.5 },
    "Jardinier / Paysagiste":               { min:13,   max:18,   default:15   },
    "Agent d'entretien du bâtiment":        { min:14,   max:19,   default:16   },
    "Régisseur événementiel":               { min:17,   max:26,   default:21   },
    "Hôte(sse) bilingue salon":             { min:13,   max:17,   default:14.5 },
    "Community manager":                    { min:16,   max:26,   default:20   },
    "Interprète / Traducteur":              { min:20,   max:35,   default:26   },
  },
};

export const METIERS = Object.fromEntries(
  Object.entries(METIERS_TARIFS).map(([k,v]) => [k, Object.keys(v)])
);

// tarifNet = ce que le prestataire encaisse
// hourlyRate = prix affiché au CLIENT (tarifNet × (1+marge)) — jamais montré au prestataire

// CV simulés pour quelques prestataires (les autres n'en ont pas)
export const CV_DATA = {
  1: { // Thomas Saumur
    titre:"Logisticien Senior — Cariste CACES 1/3/5",
    accroche:"Expert en gestion d'entrepôt avec 8 ans d'expérience dans la logistique industrielle. Spécialisé dans les opérations de manutention lourde et la gestion de stocks.",
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
    accroche:"Passionnée de gastronomie française, j'ai évolué dans les plus grands établissements parisiens. Mon expertise couvre le service en salle, la sommellerie de base et l'accueil VIP.",
    experiences:[
      { poste:"Chef de rang", entreprise:"Restaurant Le Grand Véfour ***", periode:"2022 – 2025", desc:"Service gastronomique étoilé · Gestion d'une équipe de 4 serveurs · Accueil clientèle internationale" },
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

export const DOCS_REQUIS = [
  { id:"photo",    label:"Photo de profil",            icon:"📸", required:true,  info:"Photo professionnelle de face, fond neutre (JPG ou PNG uniquement)" },
  { id:"kbis",     label:"Extrait KBIS / INSEE",       icon:"🏢", required:true,  info:"Attestation existence légale de votre auto-entreprise" },
  { id:"urssaf",   label:"Attestation URSSAF",         icon:"📋", required:true,  info:"Prouve que vous êtes à jour de vos cotisations" },
  { id:"cni",      label:"Pièce d'identité",           icon:"🪪", required:true,  info:"CNI ou passeport en cours de validité" },
  { id:"domicile", label:"Justificatif de domicile",   icon:"🏠", required:true,  info:"Facture EDF ou quittance de loyer -3 mois" },
  { id:"rib",      label:"RIB / IBAN",                 icon:"🏦", required:true,  info:"Pour le virement de vos paiements" },
  { id:"rc_pro",   label:"Attestation RC Pro",         icon:"🛡️", required:true,  info:"Assurance RC Professionnelle en cours de validité (obligatoire)" },
  { id:"diplomes", label:"Diplômes & Certifications",  icon:"🎓", required:false, info:"CACES, habilitations, diplômes pro…" },
  // Exigé des seuls ressortissants hors Union européenne. Un indépendant
  // étranger doit disposer d'un titre l'autorisant à exercer une activité NON
  // SALARIÉE en France : la nationalité était déclarée à l'inscription, aucun
  // justificatif n'était demandé. Voir `docsRequisPour()`.
  { id:"titre_sejour", label:"Titre de séjour",         icon:"🛂", required:false, info:"Autorisant l'exercice d'une activité non salariée en France (hors UE uniquement)" },
];

// Documents exigés d'un prestataire donné.
//
// La liste n'est pas la même pour tout le monde : le titre de séjour ne concerne
// que les ressortissants hors UE. L'afficher à tous ferait renoncer des candidats
// français qui n'ont rien à fournir ; ne l'exiger de personne laisse ALANE mettre
// en relation des professionnels sans droit d'exercer.
export function docsRequisPour(nationalite) {
  const horsUE = String(nationalite || "").toLowerCase().includes("hors");
  return DOCS_REQUIS
    .filter(d => d.id !== "titre_sejour" || horsUE)
    .map(d => (d.id === "titre_sejour" ? { ...d, required: true } : d));
}

export const DOCS_REQUIS_CLIENT_PRO = [
  { id:"kbis",      label:"Extrait KBIS / Sirene",                icon:"🏢", required:true, info:"Justificatif d'existence légale de votre société" },
  { id:"rib",       label:"RIB de l'entreprise",                  icon:"🏦", required:true, info:"Coordonnées bancaires de la société pour la facturation" },
  { id:"cni",       label:"CNI / Passeport du gérant",            icon:"🪪", required:true, info:"Pièce d'identité en cours de validité du représentant légal" },
  { id:"tva",       label:"Attestation TVA intracommunautaire",   icon:"📋", required:true, info:"Numéro de TVA intracommunautaire de la société (si applicable)" },
];

export const JOURS=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
export const PLAGES=["Matin (6h-13h)","Après-midi (13h-20h)","Soir/Nuit (20h-6h)"];
export const NIVEAUX=["Débutant","Confirmé","Expert"];
export const LANGUES_LIST=["Français","Anglais","Espagnol","Arabe","Portugais","Allemand","Italien","Mandarin"];

export const COMPETENCES_PAR_SECTEUR = {
  proprete:    ["Nettoyage bureaux","Nettoyage industriel","Désinfection","Lavage vitres","Sols spéciaux","Monobrosse","Autolaveuse","Karcher haute pression","HACCP","Tri sélectif","Produits chimiques","EPI","ISO 9001","QHSE","Audit propreté"],
  logistique:  ["CACES 1","CACES 3","CACES 5","CACES R489","Prépa commandes","Commandes vocales","Gestion de stock","WMS","SAP WM","Scan code-barres","Palettisation","Réception/Expédition","Contrôle qualité","EDI","Inventaire tournant"],
  hotellerie:  ["Opera PMS","Fidelio","Check-in/out","Réservations","Conciergerie","Accueil VIP","Service buffet","Gestion réclamations","Yield management","Upselling","Revenue management","Protocole hôtelier","Langues étrangères","Room service","Facturation"],
  restauration:["Service en salle","Prise de commande","HACCP","Cuisine française","Cuisine italienne","Cuisine asiatique","Cuissons","Pâtisserie","Sommellerie","Cocktails","Latte art","Caisse","Accueil clientèle","Gestion de cave","Découpe de viande"],
  commercial:  ["Prospection B2B","Prospection B2C","CRM","Salesforce","HubSpot","Closing","Négociation","Upselling","Cross-selling","Cold calling","LinkedIn","Phoning","Account management","Gestion portefeuille","Reporting"],
  distribution:["Encaissement","Mise en rayon","Gestion DLC/DDM","Facing","PLV","Inventaire","Gestion de rayon","Réception livraisons","Boucherie","Boulangerie","Poissonnerie","Fromage","Charcuterie","SAV","Click & Collect"],
  divers:      ["CQP APS","Surveillance vidéo","Contrôle accès","Ronde de sécurité","Permis B","VTC","Animation événements","Bureautique","Word/Excel","Standard téléphonique","Accueil physique","Aide à la personne","Conduite accompagnée","Livraison","BAFA"],
};

export const COMPETENCES_PAR_METIER = {
  // ── Propreté ──
  "Agent de propreté":                    ["Nettoyage bureaux","Désinfection","Produits d'entretien","EPI","Tri sélectif","Aspiration","Lavage sols","Protocole hygiène","HACCP"],
  "Agent de propreté et d'hygiène":       ["Désinfection","HACCP","Produits biocides","EPI","Nettoyage sanitaires","Traçabilité hygiène","Protocole ISO"],
  "Agent d'entretien des bureaux":        ["Nettoyage bureaux","Aspiration","Lavage sols","Dépoussiérage","Vidage poubelles","Respect des espaces de travail"],
  "Agent de nettoyage industriel":        ["Nettoyage industriel","Monobrosse","Autolaveuse","Produits chimiques","EPI","QHSE","Sécurité machines"],
  "Agent multiservice":                   ["Nettoyage","Petite maintenance","Manutention légère","Accueil","Polyvalence","Entretien espaces verts"],
  "Technicien de surface":                ["Monobrosse","Autolaveuse","Sols spéciaux","Moquette","Cristallisation","Vitrification","Cire"],
  "Laveur de vitres":                     ["Lavage vitres","Perche télescopique","Nacelle","PEMP","Sécurité en hauteur","Karcher","Raclette pro"],
  "Nettoyeur haute pression":             ["Karcher haute pression","Dégraissage","Toiture","Façades","Gouttières","EPI","Eau chaude"],
  "Opérateur de machines de nettoyage":   ["Autolaveuse","Monobrosse","Balayeuse","Aspiro-brosseur","CACES optionnel","Maintenance 1er niveau"],
  "Chef d'équipe propreté":               ["Management équipe","Plannings","Contrôle qualité","Formation agents","Commande produits","QHSE","Reporting"],
  "Chef de chantier propreté":            ["Gestion de chantier","Multi-sites","QHSE","Audit propreté","ISO 9001","Management","Appels d'offres"],
  // ── Logistique ──
  "Manutentionnaire":                     ["Manutention manuelle","Charges lourdes","Palettisation","Filmage palette","Scan","EPI","Sécurité entrepôt"],
  "Préparateur de commandes":             ["Prépa commandes","Scan code-barres","Commandes vocales","Palettisation","Gestion de stock","WMS","Inventaire"],
  "Préparateur de commandes vocales":     ["Commandes vocales","Scan","Palettisation","WMS","Inventaire tournant","Gestion emplacements"],
  "Agent de quai":                        ["Réception/Expédition","Contrôle BL","Filmage","Transpalette","CACES 1","Chargement/Déchargement"],
  "Cariste CACES 1":                      ["CACES 1","Prépa commandes","Scan","Palettisation","Gestion de stock","Filmage palette","Entrepôt grande hauteur"],
  "Cariste CACES 3":                      ["CACES 3","Magasinage","Chargement/Déchargement","WMS","Gestion emplacements","SAP WM"],
  "Cariste CACES 5":                      ["CACES 5","Grande hauteur","Gestion stocks spécialisés","CACES R489","Entrepôt froid"],
  "Gestionnaire de stocks":               ["WMS","SAP WM","EDI","Inventaire tournant","Gestion entrées/sorties","Réapprovisionnement","Reporting stocks"],
  "Coordinateur logistique":              ["Coordination flux","Transport","EDI","SAP","Gestion fournisseurs","KPIs logistique","Excel avancé"],
  "Chef d'équipe logistique":             ["Management équipe","Plannings","Sécurité entrepôt","KPIs","WMS","Formation caristes","Reporting"],
  // ── Hôtellerie ──
  "Femme/Valet de chambre":               ["Nettoyage de chambre","Protocole de chambre","Literie","Gestion du chariot","Produits d'entretien hôteliers","Contrôle minibar","Rapport de ronde","Courtoisie client"],
  "Équipier polyvalent hôtellerie":       ["Polyvalence","Service chambre","Nettoyage","Manutention","Accueil ponctuel","Communication équipe"],
  "Bagagiste / Portier":                  ["Bagagerie","Accueil client","Protocole luxe","Service voiturier","Communication radio","Discrétion VIP"],
  "Voiturier":                            ["Conduite véhicules","Permis B","Stationnement","Protocole accueil","Discrétion","Service haut de gamme"],
  "Standardiste hôtelier":               ["Standard téléphonique","Opera PMS","Réservations","Filtrage d'appels","Langues étrangères","Gestion messagerie"],
  "Agent d'accueil hôtelier":            ["Accueil client","Check-in/out","Opera PMS","Langues étrangères","Facturation","Gestion réclamations"],
  "Réceptionniste":                       ["Check-in/out","Opera PMS","Fidelio","Facturation","Réservations","Gestion réclamations","Langues étrangères","Encaissement"],
  "Réceptionniste bilingue":              ["Check-in/out","Opera PMS","Fidelio","Anglais courant","Seconde langue","Facturation","Protocole luxe"],
  "Veilleur de nuit":                     ["Clôture de nuit","Night audit","Rapport de nuit","Gestion des urgences","Sécurité hôtel","Facturation","Check-in tardif"],
  "Night Auditor":                        ["Night audit","Clôture comptable","Opera PMS","Reporting direction","Gestion des urgences","Soldes de caisse"],
  "Concierge d'hôtel":                    ["Conciergerie","Réservations restaurants","Transferts VIP","Réseau prestataires","Langues étrangères","Protocole luxe","Bagagerie"],
  "Gouvernant(e) d'étage":               ["Management équipe","Contrôle qualité chambre","Plannings","Commande produits","Formation femmes de chambre","Protocole hôtelier"],
  "Responsable des étages":              ["Management","Audit qualité","Plannings multi-équipes","Gestion fournitures","QHSE","Recrutement"],
  "Chef de réception":                    ["Management réception","Opera PMS","Yield management","Formation équipe","Gestion plaintes","Reporting direction"],
  "Spa praticien / Esthéticien":         ["Soins corps","Soins visage","Massage","Épilation","Protocoles spa","Produits professionnels","Relation client premium"],
  "Animateur club enfants":              ["Animation enfants","BAFA","Jeux pédagogiques","Sécurité mineurs","Activités créatives","Communication parents"],
  // ── Restauration ──
  "Runner":                               ["Service en salle","Transport assiettes","Communication brigade","Dressage","Rapidité","Service à table"],
  "Plongeur":                             ["Plonge","Nettoyage cuisine","HACCP","Rangement vaisselle","Aide cuisine","EPI"],
  "Serveur(se)":                          ["Service en salle","Prise de commande","HACCP","Encaissement","Accueil clientèle","Upselling","Travail en brigade"],
  "Barman / Barmaid":                     ["Cocktails","Mixologie","Vins","Gestion bar","Caisse","Accueil client","Mise en place bar"],
  "Barista":                              ["Latte art","Espresso","Gestion machine","Café de spécialité","Accueil client","Mise en place"],
  "Commis de cuisine":                    ["Préparations préliminaires","Mise en place","HACCP","Aide chef de partie","Fiches techniques","Cuissons de base"],
  "Cuisinier":                            ["Cuissons","HACCP","Fiches techniques","Cuisine française","Travail en brigade","Gestion des déchets","Mise en place"],
  "Chef de partie":                       ["Management poste","Cuissons maîtrisées","HACCP","Fiches techniques","Gestion des stocks de poste","Formation commis"],
  "Pâtissier":                            ["Pâtisserie","Viennoiserie","Décoration","Entremets","Chocolaterie","Fiches techniques","HACCP"],
  "Pizzaïolo":                            ["Pétrissage","Cuisson four à bois","Étalage","Garnitures","HACCP","Gestion des stocks","Service rapide"],
  "Chef de cuisine":                      ["Management brigade","Création de cartes","Gestion des coûts","HACCP","Formation équipe","Commandes fournisseurs"],
  "Maître d'hôtel":                       ["Management salle","Protocole service","Vins et accords","Formation équipe","Gestion réservations","Relation clients VIP"],
  "Sommelier":                            ["Œnologie","Accords mets/vins","Gestion de cave","Service du vin","Conseil client","Commandes fournisseurs"],
  // ── Commercial ──
  "Conseiller de vente":                  ["Accueil client","Techniques de vente","Upselling","Caisse","Gestion stock rayon","Fidélisation","Connaissance produits"],
  "Télévendeur":                          ["Phoning","Argumentaire","CRM","Gestion objections","Closing téléphonique","Reporting","Quota"],
  "Commercial terrain":                   ["Prospection B2B","Closing","Négociation","CRM","Gestion portefeuille","Reporting","Permis B","Déplacements"],
  "Chargé de clientèle":                  ["Relation client","CRM","Gestion de compte","Upselling","Cross-selling","Reporting","SAV"],
  "Business developer":                   ["Prospection","Partenariats","Négociation","Closing","LinkedIn","Salesforce","HubSpot","Stratégie commerciale"],
  "Technico-commercial":                  ["Connaissance technique produit","Argumentation technique","Chiffrage","Devis","Closing","CRM","Démonstration"],
  // ── Distribution ──
  "Hôte(sse) de caisse":                 ["Encaissement","Accueil client","Gestion coffre","Programme fidélité","SAV caisse","Rapidité d'exécution"],
  "Employé libre-service":                ["Mise en rayon","Gestion DLC/DDM","Facing","Réception livraisons","Inventaire","PLV","Rotation des stocks"],
  "Responsable rayon":                    ["Gestion de rayon","Management équipe","Commandes","Inventaire","Objectifs CA","Formation employés","PLV"],
  "Boucher":                              ["Découpe de viande","Désossage","Ficelage","Respect chaîne du froid","Hygiène alimentaire","Relation client","Étiquetage"],
  "Boulanger":                            ["Pétrissage","Fermentation","Cuisson","Viennoiserie","HACCP","Gestion stocks","Normes sanitaires"],
  "Poissonnier-écailler":                 ["Découpe poisson","Écaillage","Levage de filets","Respect chaîne du froid","Connaissance produits marée","Traçabilité"],
  // ── Divers ──
  "Agent de sécurité":                    ["CQP APS","Surveillance vidéo","Contrôle accès","Ronde de sécurité","Gestion de crise","Main courante","SST"],
  "Hôte(sse) d'accueil":                 ["Accueil physique","Standard téléphonique","Orientation visiteurs","Gestion badges","Tenue professionnelle","Langues étrangères"],
  "Animateur événementiel":              ["Animation","Prise de parole","Gestion foule","Microphone","Dynamisme","Gestion du temps","BAFA"],
  "Chauffeur VTC":                        ["Permis B","Carte VTC","Connaissance Paris","Discrétion","Anglais de base","Application VTC","Véhicule haut de gamme"],
};

export const PROVIDERS_CACHE_TTL = 3 * 60 * 1000; // 3 min

// ── LEAFLET MAP ───────────────────────────────────────────────────
export const FR_CITY_COORDS = {
  "paris":[48.8566,2.3522],"lyon":[45.7640,4.8357],"marseille":[43.2965,5.3698],
  "toulouse":[43.6047,1.4442],"nice":[43.7102,7.2620],"nantes":[47.2184,-1.5536],
  "montpellier":[43.6119,3.8772],"strasbourg":[48.5734,7.7521],"bordeaux":[44.8378,-0.5792],
  "lille":[50.6292,3.0573],"rennes":[48.1173,-1.6778],"reims":[49.2583,4.0317],
  "toulon":[43.1242,5.9280],"saint-etienne":[45.4397,4.3872],"grenoble":[45.1885,5.7245],
  "dijon":[47.3220,5.0415],"angers":[47.4784,-0.5632],"nimes":[43.8367,4.3601],
  "villeurbanne":[45.7676,4.8796],"le mans":[48.0061,0.1996],"aix-en-provence":[43.5297,5.4474],
  "clermont-ferrand":[45.7772,3.0870],"brest":[48.3905,-4.4860],"tours":[47.3941,0.6848],
  "amiens":[49.8941,2.2958],"limoges":[45.8315,1.2578],"metz":[49.1193,6.1757],"nancy":[48.6921,6.1844],
};

export const SECTOR_LABELS = { proprete:"Propreté", logistique:"Logistique", hotellerie:"Hôtellerie", restauration:"Restauration", commercial:"Commercial", distribution:"Grande Distrib.", divers:"Divers" };
