# ALANE — Ce que la plateforme sait faire aujourd'hui

*Document de présentation — état au 17 août 2026*

Ce document décrit **les fonctionnalités réellement en place et testées**, pas la feuille de
route. Ce qui n'est pas encore fait est regroupé à la fin, dans une section séparée, pour que
la distinction reste nette.

---

## 1. Le produit en trois phrases

ALANE met en relation des **clients** — entreprises ayant un besoin ponctuel de main-d'œuvre —
et des **prestataires indépendants** (auto-entrepreneurs), dans sept secteurs : propreté,
logistique, hôtellerie, restauration, commercial, grande distribution, divers.

Le client réserve et paie en ligne. Le prestataire réalise. Les deux valident. L'argent est
conservé jusqu'à la validation, puis versé au prestataire.

ALANE ne prend **aucune commission sur le tarif horaire** : elle se rémunère uniquement sur des
frais de service payés par le client, en plus du tarif. Le prestataire touche l'intégralité de
son tarif.

---

## 2. L'espace client

### Trouver un prestataire

- **Catalogue par secteur** — sept secteurs, chacun avec ses métiers et ses fourchettes
  tarifaires officielles (alignées sur les codes ROME).
- **Recherche et filtres** — métier, ville, tarif, note, disponibilité.
- **Fiche prestataire** — parcours, compétences, langues, note moyenne, avis clients,
  rayon d'intervention, badge d'abonnement (Certifié / Elite).
- **Favoris** — enregistrer un prestataire pour le retrouver.
- **Partage de profil** — un lien de fiche prestataire s'ouvre sans avoir de compte.
- **Un secteur qui n'a pas encore assez de prestataires n'apparaît pas** : le client ne peut
  pas tomber sur une offre qu'on ne saurait pas honorer.

### Réserver

- **Réservation directe** d'un prestataire choisi, ou **publication d'une demande** ouverte à
  laquelle les prestataires répondent.
- **Réservation d'équipe** — plusieurs prestataires sur un même créneau.
- **Prestations récurrentes** — plusieurs jours en une seule commande, facturés et payés pour
  l'ensemble des jours.
- **Prestation urgente** — départ sous 45 minutes minimum, avec une majoration du tarif horaire
  qui va au prestataire (voir §5).
- **Contrat de prestation signé** à chaque commande, électroniquement, par les deux parties.
- **Récapitulatif avant paiement** : tarif horaire, nombre d'heures, frais de service, total.
- **Relance automatique** si le client abandonne son panier en cours de tunnel.

### Payer

- **Carte bancaire** via Stripe, avec possibilité d'enregistrer la carte.
- **Apple Pay**, quand le téléphone le propose.
- **Cashback** crédité à chaque prestation terminée, sur un barème progressif (voir §5).
- **Facture** disponible pour chaque prestation, numérotée et archivée.

*Le portefeuille prépayé a été **fermé le 16 août 2026** sur avis prudentiel : conserver des
sommes reçues du public sans agrément relève d'un régime réglementé qu'ALANE n'a pas. Le
rechargement n'existe plus, et les soldes constitués restent remboursables à tout moment
(CGPS art. 5B.3). Aucun solde n'existait à la fermeture.*

### Suivre la prestation

- **Fenêtre en page d'accueil** : la prestation en cours ou la prochaine est affichée dès la
  connexion, avec le compte à rebours et l'action attendue.
- **Géolocalisation du prestataire** — visible sur une carte, uniquement d'**une heure avant**
  le début à **une heure après** la fin. En dehors de cette fenêtre, elle est coupée : hors
  prestation, une position n'est plus un trajet, c'est un domicile.
- **Code de confirmation à 4 chiffres** — le client et le prestataire calculent le même code
  sans avoir à communiquer, pour confirmer l'arrivée sur place.
- **Notifications** dans l'application, par e-mail et en notification push (téléphone).
- **Messagerie** entre le client et le prestataire de la prestation.
- **Alerte de retard** — si le prestataire arrive avec plus de 15 minutes de retard, le client
  est prévenu avec les chiffres et choisit : décaler la fin, ou réduire les heures facturées.
- **Annulation sans frais en cas de retard important** du prestataire — le seuil est
  proportionnel à la durée (20 min pour une heure de prestation, jusqu'à 60 min au-delà de
  quatre heures).

### Après

- **Validation de fin de prestation** par les deux parties, avec relance automatique.
- **Note et avis** — vérifiés côté serveur : on ne peut noter que quelqu'un avec qui on a
  réellement travaillé, et une seule fois.
- **Signalement d'un problème** dans les 48 h suivant la fin — ce qui **gèle l'argent** et
  ouvre un litige (voir §6).
- **Historique complet** des prestations, avec export.
- **Heures supplémentaires** — le client peut en demander pendant la prestation ; le
  prestataire fixe son tarif, le client paie le supplément, et seulement alors les heures sont
  ajoutées.

---

## 3. L'espace prestataire

### S'inscrire et être validé

- Inscription avec secteur, métiers (principal et secondaires), tarif net souhaité, rayon
  d'intervention, jours de disponibilité, langues, compétences.
- **Dépôt des pièces justificatives** : pièce d'identité, Kbis, attestation URSSAF, RC Pro,
  justificatif de domicile, RIB, diplômes, TVA.
- **Validation manuelle par ALANE** — contrairement au client, un prestataire n'a accès à rien
  tant que son dossier n'est pas contrôlé.
- Deux verrous distincts : le **compte validé**, et l'**accès aux prestations activé**. Les
  deux sont nécessaires pour apparaître dans le catalogue.
- **Relance automatique de la RC Pro** 30 jours avant expiration, puis à l'échéance, puis
  suspension de l'accès 30 jours après. Une attestation périmée ne passe pas inaperçue.
- **Purge automatique des pièces d'identité** 30 jours après vérification : le fichier est
  supprimé, la trace de la vérification est conservée.

### Travailler

- **Propositions de prestations** avec un délai de réponse imparti ; sans réponse, la
  proposition passe automatiquement au candidat suivant.
- **Prestations ouvertes** auxquelles se porter candidat.
- **Calendrier** des prestations acceptées.
- **Pointage** : bouton « Je suis sur place » disponible 15 minutes avant l'heure, bouton
  « Démarrer la prestation » à l'heure pile.
- **Partage de position** pendant la fenêtre de prestation.
- **Droit de remplacement** — un prestataire empêché peut proposer un confrère éligible,
  choisi dans une liste fermée. Le remplacement n'a lieu que si le remplaçant **et** le client
  acceptent, et au plus tard 2 h avant le début. Le remplaçant est payé de ce qu'il a fait et
  facture en son nom.
- **Demande d'heures supplémentaires** avec son propre tarif, jusqu'à 20 minutes après la fin.

### Gagner

- **Tableau de bord** : revenus du mois, prestations réalisées, note moyenne, quota restant.
- **Versement automatique** 48 h après la fin de la prestation, par virement Stripe.
- **Facturation automatique** au nom du prestataire — ALANE établit la facture pour lui
  (mandat de facturation), avec numérotation continue et archivage à dix ans. Le prestataire
  peut contester une facture émise en son nom.
- **Export comptable** de ses prestations.
- **Abonnement** pour dépasser le quota mensuel gratuit (voir §5).
- **Parrainage** — trois filleuls réellement abonnés donnent un mois offert, qui prolonge
  l'abonnement en cours.

---

## 4. Le déroulé d'une prestation, de bout en bout

| Étape | Ce qui se passe |
|---|---|
| 1. Commande | Le client choisit ou publie, remplit le formulaire, signe le contrat |
| 2. Contrôles | Secteur ouvert, prestataire actif, tarif cohérent, adresse dans le rayon — **avant tout paiement** |
| 3. Paiement | Carte bancaire ou Apple Pay. L'argent est encaissé et conservé |
| 4. Sollicitation | Le prestataire reçoit la proposition et a un délai pour répondre |
| 5. Attribution | S'il accepte, la prestation lui est attribuée. S'il refuse ou ne répond pas, on passe au suivant |
| 6. Veille | Notifications, rappels, géolocalisation ouverte 1 h avant |
| 7. Arrivée | Pointage « sur place » 15 min avant, code de confirmation |
| 8. Exécution | Démarrage à l'heure, retard mesuré et arbitré par le client |
| 9. Fin | Les deux valident. Relances automatiques si l'un des deux tarde |
| 10. Argent | Cashback crédité au client, facture émise, versement au prestataire **48 h après la fin** |
| 11. Recours | Le client a 48 h pour signaler un problème — ce qui bloque le versement |

**Si rien ne se passe à l'étape 4 ou 5**, la commande n'est pas perdue : le système cascade
sur les candidats suivants, et si personne n'est disponible, la prestation repart en
diffusion ouverte. En dernier recours, le client est **intégralement remboursé, frais de
service compris**.

---

## 5. L'argent

### Ce que paie le client

**Tarif horaire du prestataire × heures × jours + frais de service.**

Les frais de service se composent d'une **part fixe** et d'une **part variable de 2 %** du prix
de la prestation :

| Type de prestation | Part fixe | Part variable |
|---|---|---|
| Créneau précis | 4,90 € | 2 % |
| Prestation récurrente (plusieurs jours) | 2,90 € **par jour** | 2 % |
| Prestation urgente | 9,90 € | 2 % |

*Exemple : 8 heures à 14 €/h = 112 € de prestation. Frais = 4,90 € + 2,24 €, soit 7,14 €.
Le client paie 119,14 €, le prestataire touche 112 €.*

**Pourquoi une part variable** — elle couvre les frais du prestataire de services de paiement
(Stripe), qui sont proportionnels au montant encaissé. Une part fixe seule suffit sur une
petite prestation et devient déficitaire au-delà de quelques centaines d'euros : sur une
prestation à 1 000 €, Stripe prélève à lui seul plus que la totalité des frais fixes.

Le client voit **une seule ligne « Frais de service »** : il n'a pas à connaître la
répartition, et une ligne « frais bancaires » séparée n'apporterait qu'une question de plus.
Les deux parts sont réglables depuis le back-office, sans intervention technique.

Une prestation urgente supporte en plus une **majoration de 2 € HT par heure**, qui va
intégralement au prestataire. Ce montant est réglable depuis le back-office.

### Ce que touche le prestataire

**L'intégralité de sa part horaire** — tarif × heures réelles × jours. Aucune retenue.
Les frais de service ne figurent pas sur sa facture, et c'est volontaire : les y porter
gonflerait artificiellement son chiffre d'affaires déclaré, donc ses cotisations URSSAF et son
plafond de micro-entreprise, sur un argent qu'il n'a jamais reçu.

### Ce que gagne ALANE

**Les frais de service, et rien d'autre**, plus les abonnements prestataires. Sur ces frais,
la part variable de 2 % est presque entièrement absorbée par Stripe : la marge réelle est donc
proche de la part fixe. C'est simple à expliquer à un prestataire, et c'est ce qui rend le
modèle défendable : ALANE ne prélève rien sur le travail.

### Cashback client

Progressif, selon le nombre de prestations validées **dans le mois en cours** — le compteur est
remis à zéro chaque mois :

| Palier | Prestations dans le mois | Cashback |
|---|---|---|
| 🥉 Standard | 0 à 2 | 0,5 % |
| 🥈 Silver | 3 à 5 | 0,75 % |
| 🥇 Gold | 6 à 9 | 1 % |
| 💎 Platinum | 10 et + | 1,5 % |

**Le cashback se dépense en réduction du paiement.** Au moment de régler une prestation, le
solde disponible est déduit automatiquement du montant à payer par carte. Le client voit la
ligne dans son récapitulatif, et ne paie que la différence.

Trois garde-fous : un euro reste toujours à la charge de la carte (en dessous, Stripe refuse le
paiement) ; le solde n'est prélevé **qu'une fois le paiement abouti**, si bien qu'un panier
abandonné ne coûte rien ; et si la prestation est remboursée, le cashback consommé **revient au
client** — la prestation n'a pas eu lieu, l'avantage n'a pas été utilisé.

La réduction est une remise commerciale d'ALANE : elle ne change ni ce que touche le
prestataire, ni les frais de service dus.

### Abonnements prestataires

| Plan | Prix | Prestations/mois | Ce qui change réellement |
|---|---|---|---|
| Gratuit | 0 € | 2 | Profil visible par les clients |
| Premium | 29,99 € | 10 | Badge ✓ Certifié |
| Elite | 79,99 € | illimité | Badge 👑 Elite, première position dans les résultats |

Ce que l'abonnement change : le **quota mensuel**, le **badge** et le **classement** dans les
résultats. Rien d'autre — les prestations urgentes sont ouvertes à tous les plans.

**Offre de lancement en cours** : 10 prestations/mois offertes aux 100 premiers prestataires
inscrits.

---

## 6. Litiges, retenues et sommes dues

- **Signaler un problème** dans les 48 h après la fin gèle l'argent : la prestation sort des
  traitements automatiques, aucun virement ne part.
- **Proposition de résolution** — ALANE formule une proposition écrite et motivée (verser au
  prestataire, ou rembourser le client). Chacune des deux parties dispose de **48 h pour s'y
  opposer**. Sans opposition, l'accord est réputé acquis et exécuté.
- **Ce qui a fait bouger l'argent est enregistré** : accord tacite, décision de justice, ou
  procédure de l'établissement de paiement. C'est la seule chose qu'on aura à produire si l'on
  nous demande un jour au titre de quoi les fonds ont bougé.
- **Les frais de service restent acquis** même quand un litige se dénoue par un remboursement :
  ils couvrent des coûts déjà engagés. Unique exception, le remboursement est **intégral** quand
  c'est le prestataire ou la plateforme qui a fait défaut.
- **Retenue sur versement** — cinq motifs limitativement prévus au contrat, notification écrite
  obligatoire au prestataire avec le motif et le montant, levée automatique au plus tard à
  90 jours.
- **Sommes dues par un prestataire** — récupérables par imputation sur ses versements, dans la
  limite de la moitié de chaque versement, jamais sur une créance non notifiée ou contestée.

---

## 7. Ce qui protège la plateforme

C'est la partie la moins visible et la plus importante. Le risque principal d'une plateforme
de ce type est la **requalification** de la relation en contrat de travail.

- **Le client ne choisit plus nominativement son prestataire dès qu'un tiers est en jeu.**
  Quand un client professionnel déclare intervenir chez son propre client, c'est ALANE qui
  affecte, sur des critères **exclusivement objectifs** : métier, secteur, tarif, jour de
  disponibilité, distance, charge du mois. Ni note, ni abonnement, ni ancienneté — un
  classement fondé sur le comportement s'apparenterait à un pouvoir de direction.
- **Déclaration d'intervention chez un tiers** — le client professionnel déclare le
  bénéficiaire final, le service vendu, le périmètre, le livrable attendu et qui organise le
  travail sur place. Le formulaire force à décrire un **résultat vendu**, pas une présence.
- **Contrat-cadre Client Professionnel** — huit articles, à accepter avant la première
  réservation chez un tiers. Sans acceptation, la réservation est bloquée.
- **Détection automatique de schémas à risque** — dépendance économique d'un prestataire à un
  client, récurrence au même endroit, intégration durable. Chaque signal détecté **doit être
  traité** dans le back-office, avec cinq décisions possibles et un motif écrit obligatoire
  pour « classer sans suite ». Une détection qu'on ne traite pas est pire que pas de détection :
  elle établit qu'on savait.
- **Droit de remplacement réellement exerçable** — c'est l'indice d'indépendance le plus net :
  un salarié ne peut jamais envoyer quelqu'un à sa place.
- **Le retard n'est jamais une sanction** — c'est un ajustement du prix du service réellement
  exécuté. Il n'alimente ni suspension, ni classement, ni quota, et le prestataire dispose
  d'une voie de contestation.
- **CGPS en 23 articles**, source unique, acceptées à l'inscription et générées automatiquement
  en page publique.
- **Conformité RGPD** — minimisation des données bancaires, suppression de compte avec
  anonymisation, conservation des factures dix ans au titre de l'obligation comptable,
  empreintes anonymes pour empêcher la recréation de compte après suppression.

---

## 8. Le back-office (admin.alane.fr)

Accessible par mot de passe, avec limitation des tentatives et journalisation de toutes les
actions sensibles.

| Onglet | Ce qu'on y fait |
|---|---|
| **Tableau de bord** | Chiffres clés, comptes en attente, tickets à traiter |
| **Comptes** | Valider, refuser, suspendre, activer l'accès aux prestations |
| **Documents** | Consulter et vérifier les pièces justificatives |
| **Prestations** | Suivre, forcer une clôture, exporter |
| **Litiges** | Formuler une proposition de résolution, exécuter, rembourser |
| **Versements** | Voir les virements en attente, retenus, échoués — et les échéances dépassées |
| **Utilisateurs** | Vue d'ensemble des comptes, recherche, fiches détaillées |
| **Modération** | Signaux de dépendance économique et de mise à disposition, avec traçabilité |
| **Avis** | Modération des notes et commentaires |
| **Support** | Tickets clients et prestataires |
| **Finance** | Chiffre d'affaires, frais encaissés, cashback distribué |
| **Secteurs** | Ouvrir ou fermer un secteur, forcer l'ouverture malgré le seuil |
| **Réglages** | Frais de service, taux de cashback, prix des abonnements, seuils de vigilance |
| **Journal** | Trace horodatée de chaque action sensible |
| **Test** | Prévisualisation de tous les écrans client et prestataire sans compte réel |

Deux points notables : l'**IBAN complet** d'un prestataire ne s'affiche que fiche par fiche, et
chaque consultation est tracée. Et **aucun réglage du back-office n'est décoratif** : chaque
clé est effectivement lue par le code.

---

## 9. Notifications

Trois canaux, selon l'importance : **dans l'application**, **e-mail**, et **notification push**
sur le téléphone. Un quatrième, le **SMS**, n'est branché que sur un cas précis : la diffusion
d'une nouvelle prestation aux prestataires du secteur, et seulement si la clé Brevo est
configurée.

Les moments qui déclenchent une notification : nouvelle proposition, acceptation, refus,
rappel avant la prestation, arrivée du prestataire, retard, demande d'heures supplémentaires,
fin de prestation à valider, relance de validation, versement émis, retenue, litige, réponse
du support, expiration de document.

**Aucune notification ne peut être créée depuis un navigateur** — toutes passent par le
serveur. C'était sinon un vecteur d'hameçonnage à l'intérieur de l'application.

---

## 10. Ce qui n'est pas encore fait

Pour que la liste précédente garde sa valeur, voici ce qui reste ouvert.

| Sujet | État |
|---|---|
| **Test Stripe de bout en bout** | Le seul point sérieux. La chaîne complète — paiement, prestation, validation, versement — n'a pas encore été jouée en conditions réelles avec les vraies clés en mode test |
| **Immatriculation de la société** | Bloque le SIRET sur les factures, les mentions légales, le médiateur de la consommation et l'assurance ALANE |
| **Architecture Stripe Connect** | Les fonds transitent aujourd'hui par ALANE avant d'être reversés. La cible est un encaissement direct pour le compte du prestataire, ce qui écarte toute question de statut d'établissement de paiement. Recommandé par le conseil juridique, à faire avant la mise en production commerciale |
| **Messagerie** | Fonctionne, mais son modèle interne est fragile et doit être repris avant une montée en charge |
| **Application mobile native** | Non prévue à ce stade — le site fonctionne sur mobile et les notifications push sont déjà en place |

---

## En résumé pour un lecteur pressé

Ce qui est **fait et fonctionnel** : les deux parcours complets (client et prestataire), le
paiement par carte, les abonnements, la facturation légale, la géolocalisation encadrée, le
pointage, les heures supplémentaires payantes, le remplacement, les litiges avec délai
d'opposition, les versements différés et automatisés, le back-office complet, et l'arsenal de
conformité anti-requalification.

Ce qui **manque avant d'ouvrir commercialement** : la société immatriculée, un test de
paiement de bout en bout, et la bascule Stripe Connect.
