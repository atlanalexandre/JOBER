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
// ── LES CODES ROME ─────────────────────────────────────────────────────────
//
// Chaque métier porte un champ `rome` : le code de la nomenclature ROME de
// France Travail correspondant à sa famille. Il n'existait jusqu'au 21/08/2026
// que sept commentaires, un par secteur, et deux d'entre eux désignaient des
// familles qui n'existent pas (« D1507-D1513 » : la famille D15 s'arrête à
// D1509 ; « G1401-G1502 » pour l'hôtellerie, dont les métiers relèvent de G15
// et G17).
//
// À QUOI IL SERT, ET À QUOI IL NE SERT PAS
//
// C'est un rattachement DOCUMENTAIRE : il situe le métier dans la nomenclature
// publique, ce qui aide à rapprocher une prestation d'une convention
// collective ou d'un référentiel de qualification. Aucun traitement de
// l'application ne le lit — ni le tarif, ni l'affectation, ni la facturation.
//
// CE QU'IL FAUT SAVOIR AVANT DE S'EN SERVIR AILLEURS
//
// Ces codes ont été établis d'après la nomenclature ROME, mais ils N'ONT PAS
// été confrontés au référentiel officiel de France Travail : l'environnement
// de développement n'a pas accès à data.gouv.fr. Avant tout usage ayant une
// portée juridique ou contractuelle, les vérifier sur
// https://france-competences.fr ou l'API ROME de France Travail.
//
// Seize métiers portent `rome: null` : leur rattachement ne pouvait pas être
// établi sans ambiguïté (un « conseiller de vente » générique, par exemple,
// relève d'une famille D12 différente selon le produit vendu). `null` est un
// aveu d'ignorance assumé — un code approximatif serait pire, parce qu'il
// aurait l'air juste.
//
// EN AJOUTANT UN MÉTIER : renseigner `rome`, ou `rome: null` si le
// rattachement est douteux. Un test vérifie que le champ est présent.
// ───────────────────────────────────────────────────────────────────────────
export const METIERS_TARIFS = {
  // ROME : K22 (propreté), J1301 (milieu de santé), K2303 (espaces urbains), A1203 (espaces verts)
  proprete:{
    "Agent de propreté":                    { min:11.5, max:13.5, default:12, rome:"K2204" },
    "Agent de propreté et d'hygiène":       { min:11.5, max:13.5, default:12, rome:"K2204" },
    "Agent d'entretien des bureaux":        { min:11.5, max:13,   default:12, rome:"K2204" },
    "Agent de nettoyage industriel":        { min:12,   max:15,   default:13, rome:"K2204" },
    "Agent multiservice":                   { min:11.5, max:14,   default:12, rome:"K2204" },
    "Technicien de surface":                { min:13,   max:16,   default:14, rome:"K2204" },
    "Laveur de vitres":                     { min:13,   max:16,   default:14, rome:"K2202" },
    "Nettoyeur haute pression":             { min:13,   max:16,   default:14, rome:"K2204" },
    "Opérateur de machines de nettoyage":   { min:12,   max:15,   default:13, rome:"K2204" },
    "Opérateur de nettoyage spécialisé":    { min:14,   max:18,   default:15, rome:"K2204" },
    "Agent de désinfection":                { min:12,   max:15,   default:13, rome:"K2204" },
    "Chef d'équipe propreté":               { min:14,   max:17,   default:15, rome:"K2203" },
    "Chef de chantier propreté":            { min:16,   max:21,   default:18, rome:"K2203" },
    "Responsable de site propreté":         { min:17,   max:23,   default:19, rome:"K2203" },
    "Responsable qualité propreté":         { min:18,   max:25,   default:21, rome:"K2203" },
    // Ajoutés le 21/08/2026 — le catalogue s'arrêtait au nettoyage de bureaux,
    // alors que l'essentiel du marché de la propreté est ailleurs : santé,
    // agroalimentaire, remise en état, travail en hauteur.
    "Agent de bionettoyage (milieu de santé)": { min:13, max:17,   default:14, rome:"J1301" },
    "Agent de service hospitalier (ASH)":   { min:12,   max:15,   default:13, rome:"J1301" },
    "Agent de propreté en EHPAD":           { min:12,   max:15.5, default:13, rome:"J1301" },
    "Agent de propreté en agroalimentaire": { min:12.5, max:16,   default:13.5, rome:"K2204" },
    "Agent de remise en état après sinistre": { min:14, max:19,   default:16, rome:"K2204" },
    "Agent de propreté urbaine":            { min:12,   max:15,   default:13, rome:"K2303" },
    "Agent de collecte des déchets":        { min:12,   max:15,   default:13, rome:"K2303" },
    "Laveur de vitres en hauteur (cordiste)": { min:18, max:28,   default:22, rome:"K2202" },
    "Agent de blanchisserie / Repasseur":   { min:11.5, max:14,   default:12, rome:"K2201" },
    "Agent d'entretien d'espaces verts":    { min:12,   max:15.5, default:13, rome:"A1203" },
  },
  // ROME : N11 (manutention, magasinage, conduite d'engins), N12 (transit, douane), N13 (exploitation)
  logistique:{
    "Manutentionnaire":                     { min:11.5, max:13,   default:11.8, rome:"N1105" },
    "Préparateur de commandes":             { min:11.5, max:13.5, default:12, rome:"N1103" },
    "Préparateur de commandes vocales":     { min:12,   max:14,   default:12.5, rome:"N1103" },
    "Préparateur de commandes click&collect":{ min:12,  max:14,   default:12.5, rome:"N1103" },
    "Agent de quai":                        { min:11.5, max:14,   default:12, rome:"N1105" },
    "Opérateur de tri":                     { min:11.5, max:13,   default:12, rome:"N1105" },
    "Opérateur de réception":               { min:12,   max:14,   default:12.5, rome:"N1103" },
    "Agent d'expédition":                   { min:12,   max:15,   default:13, rome:"N1103" },
    "Réceptionnaire marchandises":          { min:12,   max:15,   default:13, rome:"N1103" },
    "Magasinier":                           { min:12,   max:15,   default:13, rome:"N1103" },
    "Cariste CACES 1":                      { min:13,   max:16,   default:14, rome:"N1101" },
    "Cariste CACES 3":                      { min:14,   max:17,   default:15, rome:"N1101" },
    "Cariste CACES 5":                      { min:14,   max:18,   default:15.5, rome:"N1101" },
    "Opérateur logistique":                 { min:12,   max:15,   default:13, rome:"N1303" },
    "Gestionnaire de stocks":               { min:14,   max:19,   default:16, rome:"N1303" },
    "Agent de fret":                        { min:13,   max:17,   default:14.5, rome:"N1201" },
    "Coordinateur logistique":              { min:16,   max:22,   default:18, rome:"N1303" },
    "Chef d'équipe logistique":             { min:17,   max:24,   default:19, rome:"N1303" },
    "Responsable logistique":               { min:18,   max:26,   default:21, rome:"N1301" },
    "Conditionneur / Opérateur de conditionnement": { min:11.5, max:13, default:11.8, rome:"H3301" },
    "Chargeur / Déchargeur":                { min:11.5, max:13,   default:12, rome:"N1105" },
    "Cariste CACES 2":                      { min:13,   max:16,   default:14, rome:"N1101" },
    "Dispatcher logistique":                { min:15,   max:21,   default:17, rome:"N1303" },
    "Agent de transit":                     { min:14,   max:19,   default:16, rome:"N1202" },
    // Ajoutés le 21/08/2026.
    "Approvisionneur":                      { min:14,   max:19,   default:16, rome:null },
    "Contrôleur qualité logistique":        { min:14,   max:19,   default:16, rome:null },
    "Inventoriste logistique":              { min:12,   max:15,   default:13, rome:"N1103" },
    "Opérateur retours / SAV logistique":   { min:12.5, max:16,   default:13.5, rome:"N1103" },
    "Planificateur transport":              { min:16,   max:22,   default:18, rome:"N1301" },
    "Déclarant en douane":                  { min:17,   max:25,   default:20, rome:"N1202" },
    "Responsable d'entrepôt":               { min:19,   max:28,   default:22, rome:"N1302" },
  },
  // ROME : G15 (étages), G17 (réception, hall, conciergerie), G1402 (direction)
  hotellerie:{
    "Équipier polyvalent hôtellerie":       { min:11.5, max:14,   default:12, rome:"G1502" },
    "Femme/Valet de chambre":               { min:11.5, max:14,   default:12.5, rome:"G1501" },
    "Liftier":                              { min:12,   max:14,   default:12.5, rome:"G1702" },
    "Bagagiste / Portier":                  { min:12,   max:15,   default:13, rome:"G1702" },
    "Voiturier":                            { min:12,   max:15,   default:13, rome:"G1702" },
    "Standardiste hôtelier":                { min:12,   max:15,   default:13, rome:"G1703" },
    "Agent d'accueil hôtelier":             { min:12,   max:15,   default:13, rome:"G1703" },
    "Agent de réservation":                 { min:13,   max:16,   default:14, rome:"G1703" },
    "Réceptionniste":                       { min:12,   max:15,   default:13, rome:"G1703" },
    "Réceptionniste bilingue":              { min:13,   max:17,   default:14.5, rome:"G1703" },
    "Veilleur de nuit":                     { min:13,   max:16,   default:14, rome:"G1703" },
    "Night Auditor":                        { min:14,   max:18,   default:16, rome:"G1703" },
    "Concierge d'hôtel":                    { min:14,   max:18,   default:15, rome:"G1701" },
    "Gouvernant(e) d'étage":                { min:14,   max:18,   default:15.5, rome:"G1503" },
    "Responsable des étages":               { min:16,   max:21,   default:18, rome:"G1503" },
    "Gouvernant(e) général(e)":             { min:18,   max:24,   default:20, rome:"G1503" },
    "Lingère / Employé(e) de lingerie":     { min:11.5, max:14,   default:12, rome:"G1501" },
    "Équipier petit-déjeuner":              { min:11.5, max:14,   default:12, rome:"G1502" },
    "Chasseur / Groom":                     { min:11.5, max:14,   default:12.5, rome:"G1702" },
    "Chef de réception":                    { min:17,   max:23,   default:19, rome:"G1703" },
    "Responsable hébergement":              { min:19,   max:27,   default:22, rome:null },
    "Directeur d'hôtel":                    { min:25,   max:40,   default:30, rome:"G1402" },
    "Spa praticien / Esthéticien":          { min:13,   max:18,   default:15, rome:"D1208" },
    "Majordome":                            { min:18,   max:28,   default:22, rome:null },
    "Runner hôtelier":                      { min:11.5, max:13,   default:12, rome:"G1502" },
    "Animateur club enfants":               { min:12,   max:15,   default:13, rome:"G1202" },
  },
  // ROME : G16 (cuisine, plonge), G18 (salle, bar), D11 (métiers de bouche)
  restauration:{
    "Runner":                               { min:11.5, max:13,   default:12, rome:"G1603" },
    "Plongeur":                             { min:11.5, max:13,   default:11.8, rome:"G1605" },
    "Équipier restauration rapide":         { min:11.5, max:13,   default:11.8, rome:"G1603" },
    "Vendeur en restauration":              { min:11.5, max:13.5, default:12, rome:"G1603" },
    "Hôte(sse) d'accueil restaurant":       { min:12,   max:14,   default:12.5, rome:"G1803" },
    "Serveur(se)":                          { min:11.5, max:14,   default:12, rome:"G1803" },
    "Barman / Barmaid":                     { min:12,   max:16,   default:13, rome:"G1801" },
    "Barista":                              { min:12,   max:15,   default:13, rome:"G1801" },
    "Commis de cuisine":                    { min:12,   max:14,   default:12.5, rome:"G1602" },
    "Cuisinier":                            { min:13,   max:17,   default:14.5, rome:"G1602" },
    "Pizzaïolo":                            { min:13,   max:18,   default:15, rome:"G1604" },
    "Rôtisseur":                            { min:13,   max:17,   default:14.5, rome:"G1602" },
    "Traiteur":                             { min:14,   max:20,   default:16, rome:"D1103" },
    "Sushi man":                            { min:14,   max:20,   default:16, rome:"G1602" },
    "Chef de rang":                         { min:13,   max:17,   default:14.5, rome:"G1803" },
    "Chef de partie":                       { min:15,   max:21,   default:17, rome:"G1602" },
    "Pâtissier":                            { min:14,   max:20,   default:16.5, rome:"D1104" },
    "Sommelier":                            { min:16,   max:23,   default:19, rome:null },
    "Responsable de salle":                 { min:16,   max:22,   default:18, rome:"G1802" },
    "Second de cuisine":                    { min:17,   max:24,   default:20, rome:"G1601" },
    "Maître d'hôtel":                       { min:17,   max:24,   default:19, rome:"G1802" },
    "Chef de cuisine":                      { min:20,   max:35,   default:25, rome:"G1601" },
    "Responsable restauration collective":  { min:18,   max:27,   default:22, rome:null },
    "Directeur de restaurant":              { min:22,   max:35,   default:27, rome:"G1402" },
    "Commis pâtissier":                     { min:12,   max:15,   default:13, rome:"D1104" },
    "Glacier":                              { min:13,   max:17,   default:14.5, rome:"D1104" },
    "Poissonnier-écailler":                 { min:14,   max:20,   default:16, rome:"D1105" },
    "Cuisinier de collectivité":            { min:13,   max:17,   default:14.5, rome:"G1602" },
    "Agent de restauration scolaire":       { min:11.5, max:13.5, default:12, rome:"G1603" },
    // Ajoutés le 21/08/2026.
    "Employé de cafétéria":                 { min:11.5, max:13.5, default:12, rome:"G1603" },
    "Serveur banquet / extra":              { min:12,   max:16,   default:13.5, rome:"G1803" },
    "Crêpier":                              { min:13,   max:17,   default:14.5, rome:"G1604" },
    "Grillardin":                           { min:13,   max:17,   default:14.5, rome:"G1602" },
    "Boulanger":                            { min:13,   max:18,   default:15, rome:"D1102" },
    "Chocolatier":                          { min:14,   max:20,   default:16, rome:"D1104" },
    "Chef pâtissier":                       { min:18,   max:28,   default:22, rome:"D1104" },
    "Chef sommelier / Caviste":             { min:18,   max:26,   default:21, rome:null },
    "Assistant maître d'hôtel":             { min:15,   max:20,   default:17, rome:"G1802" },
    "Responsable de production culinaire":  { min:18,   max:26,   default:21, rome:"G1601" },
    "Chef gérant en restauration collective": { min:17, max:25,   default:20, rome:null },
  },
  // ROME : D14 (relation commerciale, télévente), D1501 (animation de vente), M1705 (marketing)
  commercial:{
    "Conseiller de vente":                  { min:12,   max:16,   default:13.5, rome:null },
    "Télévendeur":                          { min:12,   max:15,   default:13, rome:"D1408" },
    "Téléconseiller":                       { min:12,   max:15,   default:13, rome:"D1408" },
    "Commercial sédentaire":                { min:13,   max:17,   default:14.5, rome:"D1402" },
    "Animateur commercial":                 { min:13,   max:17,   default:14.5, rome:"D1501" },
    "Promoteur des ventes (PLV)":           { min:13,   max:18,   default:15, rome:"D1501" },
    "Prospecteur commercial":               { min:13,   max:18,   default:14.5, rome:"D1403" },
    "Commercial terrain":                   { min:13,   max:19,   default:15, rome:"D1402" },
    "Attaché commercial":                   { min:14,   max:20,   default:16, rome:"D1402" },
    "Agent commercial":                     { min:13,   max:19,   default:15, rome:"D1402" },
    "Chargé de clientèle":                  { min:14,   max:19,   default:16, rome:"D1403" },
    "Chargé de développement commercial":   { min:16,   max:24,   default:19, rome:"D1402" },
    "Négociateur commercial":               { min:15,   max:23,   default:18, rome:"D1402" },
    "Responsable de secteur":               { min:18,   max:28,   default:22, rome:"D1406" },
    "Business developer":                   { min:18,   max:30,   default:23, rome:"D1402" },
    "Ingénieur commercial":                 { min:20,   max:35,   default:26, rome:"D1407" },
    "Responsable comptes clés":             { min:22,   max:35,   default:27, rome:"D1402" },
    "Manager commercial":                   { min:20,   max:30,   default:24, rome:"D1406" },
    "VRP (Voyageur Représentant Placier)":  { min:14,   max:22,   default:17, rome:"D1402" },
    "Technico-commercial":                  { min:16,   max:26,   default:20, rome:"D1407" },
    "Chef des ventes":                      { min:22,   max:35,   default:27, rome:"D1406" },
    "Délégué commercial":                   { min:14,   max:21,   default:17, rome:"D1402" },
    "Chargé d'affaires":                    { min:18,   max:30,   default:23, rome:"D1402" },
    // Ajoutés le 21/08/2026.
    "Assistant commercial":                 { min:13,   max:17,   default:14.5, rome:"D1401" },
    "Conseiller clientèle particuliers":    { min:14,   max:19,   default:16, rome:"D1403" },
    "Conseiller clientèle professionnels":  { min:16,   max:24,   default:19, rome:"D1402" },
    "Démonstrateur / Animateur de stand":   { min:12,   max:16,   default:13.5, rome:"D1501" },
    "Merchandiser terrain":                 { min:13,   max:17,   default:14.5, rome:"D1501" },
    "Chargé de recouvrement":               { min:14,   max:19,   default:16, rome:null },
    "Chargé de marketing opérationnel":     { min:16,   max:24,   default:19, rome:"M1705" },
    "Chef de secteur GMS":                  { min:18,   max:27,   default:21, rome:"D1406" },
    "Responsable e-commerce":               { min:18,   max:28,   default:22, rome:null },
  },
  // ROME : D15 (caisse, rayon, direction de magasin), D11 (métiers de bouche), D12 (vente spécialisée)
  distribution:{
    "Hôte(sse) de caisse":                  { min:11.5, max:13,   default:11.8, rome:"D1505" },
    "Caissier(ère) principal(e)":           { min:12,   max:14,   default:12.5, rome:"D1508" },
    "Employé de rayon":                     { min:11.5, max:13.5, default:12, rome:"D1507" },
    "Employé de drive":                     { min:11.5, max:13.5, default:12, rome:"D1507" },
    "Préparateur drive":                    { min:12,   max:14,   default:12.5, rome:"D1507" },
    "Inventoriste":                         { min:11.5, max:14,   default:12, rome:"D1507" },
    "Livreur courses à domicile":           { min:12,   max:15,   default:13, rome:"N4105" },
    "Merchandiser":                         { min:12,   max:15,   default:13, rome:"D1501" },
    "Hôte(sse) d'accueil magasin":          { min:12,   max:14,   default:12.5, rome:"M1601" },
    "Boulanger en GMS":                     { min:13,   max:17,   default:14.5, rome:"D1102" },
    "Charcutier-traiteur":                  { min:13,   max:18,   default:15, rome:"D1103" },
    "Fromager en GMS":                      { min:13,   max:17,   default:14.5, rome:"D1106" },
    "Poissonnier en GMS":                   { min:13,   max:18,   default:15, rome:"D1105" },
    "Boucher en GMS":                       { min:14,   max:19,   default:16, rome:"D1101" },
    "Vendeur en prêt-à-porter":             { min:12,   max:15,   default:13, rome:"D1214" },
    "Vendeur en bricolage":                 { min:12,   max:16,   default:13.5, rome:"D1212" },
    "Vendeur en électroménager":            { min:13,   max:17,   default:14.5, rome:"D1212" },
    "Chef de rayon alimentaire":            { min:15,   max:21,   default:17, rome:"D1502" },
    "Chef de rayon non-alimentaire":        { min:15,   max:21,   default:17, rome:"D1503" },
    "Responsable de secteur GMS":           { min:17,   max:24,   default:20, rome:"D1509" },
    "Responsable adjoint magasin":          { min:16,   max:23,   default:19, rome:"D1504" },
    "Directeur de magasin":                 { min:22,   max:35,   default:27, rome:"D1504" },
    "Conseiller jardinerie":                { min:12,   max:16,   default:13.5, rome:"D1209" },
    "Fleuriste en GMS":                     { min:12,   max:16,   default:13.5, rome:"D1209" },
    "Vendeur en parfumerie":                { min:12,   max:16,   default:13.5, rome:null },
    "Vendeur en sport":                     { min:12,   max:16,   default:13.5, rome:"D1211" },
    // Ajoutés le 21/08/2026.
    "Employé libre-service":                { min:11.5, max:13.5, default:12, rome:"D1507" },
    "Réassortisseur":                       { min:11.5, max:13.5, default:12, rome:"D1507" },
    "Chef de caisse":                       { min:14,   max:19,   default:16, rome:"D1508" },
    "Hôte(sse) service client / SAV":       { min:12.5, max:16,   default:13.5, rome:"D1408" },
    "Employé de station-service":           { min:11.5, max:14,   default:12.5, rome:null },
    "Vendeur en boulangerie-pâtisserie":    { min:12,   max:15,   default:13, rome:"D1106" },
    "Vendeur en librairie / papeterie":     { min:12,   max:15,   default:13, rome:null },
    "Vendeur en téléphonie":                { min:12,   max:16,   default:13.5, rome:"D1212" },
    "Vendeur en optique":                   { min:13,   max:18,   default:15, rome:"J1405" },
    "Agent de prévention des pertes (magasin)": { min:13, max:17, default:14.5, rome:"K2503" },
  },
  // ROME : K25 (sécurité, gardiennage), K13 (services à la personne), M16 (accueil, secrétariat),
  //        N41 (conduite), G12 (animation, sport), E12/L15 (image, régie), E1108 (traduction)
  divers:{
    "Employé polyvalent":                   { min:11.5, max:13.5, default:12, rome:null },
    "Aide à domicile":                      { min:11.5, max:14,   default:12, rome:"K1304" },
    "Coursier / Livreur":                   { min:12,   max:15,   default:13, rome:"N4105" },
    "Facteur":                              { min:12,   max:14,   default:12.5, rome:"N4105" },
    "Chauffeur livreur":                    { min:12,   max:16,   default:13.5, rome:"N4105" },
    "Hôte(sse) d'accueil":                 { min:12,   max:15,   default:12.5, rome:"M1601" },
    "Hôte(sse) d'événement":               { min:12,   max:15,   default:13, rome:"M1601" },
    "Animateur(trice) événementiel(le)":    { min:12,   max:16,   default:13.5, rome:"G1202" },
    "Agent de sécurité":                    { min:12,   max:16,   default:13.5, rome:"K2503" },
    "Agent de sûreté":                      { min:13,   max:17,   default:14.5, rome:"K2503" },
    "Gardien d'immeuble":                   { min:12,   max:15,   default:13, rome:"K2501" },
    "Standardiste":                         { min:12,   max:15,   default:13, rome:"M1601" },
    "Agent d'accueil":                      { min:12,   max:15,   default:12.5, rome:"M1601" },
    "Auxiliaire de vie":                    { min:12,   max:16,   default:13.5, rome:"K1302" },
    "Assistant(e) administratif(ve)":       { min:13,   max:17,   default:14, rome:"M1607" },
    "Secrétaire":                           { min:13,   max:17,   default:14.5, rome:"M1607" },
    "Chauffeur VTC":                        { min:14,   max:20,   default:16, rome:"N4102" },
    "Téléconseiller":                       { min:12,   max:15,   default:13, rome:"D1408" },
    "Éducateur sportif / Coach":            { min:14,   max:22,   default:17, rome:"G1204" },
    "Agent de médiation":                   { min:13,   max:18,   default:15, rome:"K1204" },
    "Photographe événementiel":             { min:16,   max:28,   default:21, rome:"E1201" },
    "Technicien son / lumière":             { min:15,   max:25,   default:19, rome:"L1508" },
    // Ajoutés le 21/08/2026. Volontairement écartés : les métiers du bâtiment
    // (électricien, plombier, couvreur), qui relèvent de la garantie décennale
    // et d'assurances que la RC Pro demandée à l'inscription ne couvre pas, et
    // les professions de santé réglementées (aide-soignant, auxiliaire de
    // puériculture), dont l'exercice suppose un diplôme d'État que la
    // plateforme ne vérifie pas.
    "Agent de sécurité incendie SSIAP 1":   { min:13.5, max:17,   default:15, rome:"K2503" },
    "Agent de sécurité incendie SSIAP 2":   { min:16,   max:21,   default:18, rome:"K2503" },
    "Agent cynophile de sécurité":          { min:15,   max:20,   default:17, rome:"K2503" },
    "Maître-nageur sauveteur (BNSSA)":      { min:14,   max:20,   default:16, rome:"G1204" },
    "Animateur périscolaire (BAFA)":        { min:12,   max:15,   default:13, rome:"G1202" },
    "Chauffeur poids lourd (permis C)":     { min:14,   max:19,   default:16, rome:"N4101" },
    "Chauffeur de bus / autocar":           { min:14,   max:19,   default:16, rome:"N4103" },
    "Déménageur":                           { min:12.5, max:16,   default:13.5, rome:"N1102" },
    "Jardinier / Paysagiste":               { min:13,   max:18,   default:15, rome:"A1203" },
    "Agent d'entretien du bâtiment":        { min:14,   max:19,   default:16, rome:"I1203" },
    "Régisseur événementiel":               { min:17,   max:26,   default:21, rome:"L1509" },
    "Hôte(sse) bilingue salon":             { min:13,   max:17,   default:14.5, rome:"M1601" },
    "Community manager":                    { min:16,   max:26,   default:20, rome:null },
    "Interprète / Traducteur":              { min:20,   max:35,   default:26, rome:"E1108" },
  },
};

export const METIERS = Object.fromEntries(
  Object.entries(METIERS_TARIFS).map(([k,v]) => [k, Object.keys(v)])
);

// tarifNet = ce que le prestataire encaisse
// hourlyRate = prix affiché au CLIENT (tarifNet × (1+marge)) — jamais montré au prestataire

// ═══════════════════════════════════════════════════════════════════════════
// LES FAUX PARCOURS PROFESSIONNELS ONT ÉTÉ SUPPRIMÉS — 24/08/2026
// ═══════════════════════════════════════════════════════════════════════════
//
// `CV_DATA` contenait treize parcours entièrement inventés — « Thomas Saumur,
// Cariste Polyvalent chez Amazon Logistique France 2021-2025 », « Agent
// Logistique chez DHL Supply Chain », « Préparateur de commandes chez Carrefour
// Supply » — attribués à des personnes nommées, chez des entreprises réelles,
// avec des périodes et des responsabilités précises.
//
// Ils ne s'affichaient plus : la table était indexée par des identifiants
// NUMÉRIQUES (1, 61…) alors que les prestataires portent des UUID, si bien que
// `CV_DATA[p.id]` valait toujours `undefined`. Du code mort, donc — mais du
// code mort qui fabriquait des références professionnelles vérifiables et
// fausses, à un clic d'une remise en service accidentelle.
//
// Sur une plateforme dont l'argument est « profils vérifiés », c'est
// exactement ce qu'il ne faut pas avoir dans le dépôt.
//
// Les parcours réels vivent dans `profiles.cv`, renseigné par le prestataire
// lui-même. Les écrans lisent désormais `p.cv` et rien d'autre : sans parcours
// saisi, ils n'en affichent aucun.

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
