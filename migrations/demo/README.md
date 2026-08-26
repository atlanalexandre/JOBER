# Jeu de démonstration

Ce dossier ne contient pas de migration. Il contient un script qui **crée des
prestations d'essai** dans chacun des états du produit, pour pouvoir montrer
ALANE sans avoir à les fabriquer une par une ni à attendre les bons horaires.

> ⚠️ **Ce n'est pas à passer en production ouverte au public.** Ces prestations
> apparaîtront dans les écrans des deux comptes visés, et dans le back-office.

## Ce que le script crée

Dix prestations, sur deux comptes existants, avec des dates calculées par
rapport au jour où on le lance :

| # | Situation | Ce qu'elle permet de montrer |
|---|---|---|
| 1 | En recherche | La publication d'une prestation, la diffusion aux prestataires |
| 2 | Réponse attendue | Le délai d'acceptation qui court, côté prestataire |
| 3 | Confirmée | Une prestation à venir, le contrat, le récapitulatif |
| 4 | En cours, 18 min de retard | Le pointage géolocalisé et l'arbitrage du retard par le client |
| 5 | Heures supplémentaires | La prolongation payante : le prestataire fixe son tarif, le client règle |
| 6 | À valider | La fin de prestation, et ce qui déclenche le versement |
| 7 | Terminée | La facture au nom du prestataire, le versement programmé |
| 8 | Litige | La proposition de résolution, le remboursement partiel, les 48 h d'opposition |
| 9 | Annulée et remboursée | Ce qui se passe quand personne n'accepte avant l'heure |
| 10 | Versement en retard | La bannière « compte de virement manquant » du back-office |

## Deux choses qui ne fonctionneront pas, et c'est normal

**Un remboursement lancé depuis le back-office échouera.** Ces prestations
portent un identifiant de paiement fictif (`pi_demo_…`) que Stripe ne connaît
pas. Le code refuse alors de clore le litige plutôt que de le clore sans avoir
rendu l'argent — c'est le comportement voulu, mais mieux vaut le savoir que le
découvrir devant quelqu'un.

**Le versement au prestataire restera « en attente »**, faute de compte Stripe
Connect actif. C'est de toute façon l'état réel de la plateforme aujourd'hui.

Tout le reste — parcours, écrans, montants, règles, délais — est authentique :
ce sont de vraies prestations lues par le vrai code.

## Mode d'emploi

1. Ouvrir `jeu-de-demonstration.sql`.
2. Vérifier les deux adresses e-mail du §1, les corriger si besoin.
3. Exécuter le §1 dans Supabase → SQL Editor : **deux lignes** doivent
   apparaître, `CLIENT` et `PRESTATAIRE`.
4. Exécuter le §2 en entier, d'un seul coup.
5. Ouvrir l'application et se connecter avec l'un ou l'autre compte.

Le script est **rejouable** : il efface son propre jeu avant de le recréer. Le
relancer remet donc les horaires à jour — utile si la démonstration a lieu un
autre jour.

Pour tout effacer : le **§3**. Il ne touche que les prestations dont
l'identifiant commence par `d0000000`, donc uniquement celles qu'il a créées.

## Ordre conseillé pour la démonstration

**Côté client** — accueil, publication d'une prestation, puis « Mes
prestations » : les onglets montrent les cas 1, 3, 6 et 7, et le litige (8) est
épinglé en tête.

**Côté prestataire** — le tableau de bord montre le litige en cours, la
proposition de résolution avec ses deux boutons, puis l'onglet Prestations pour
le retard (4) et les heures supplémentaires (5), et Revenus pour les versements.

**Back-office** — Litiges pour la proposition de remboursement partiel,
Versements pour la bannière « compte de virement manquant » (10), Comptes pour
la validation d'un dossier.
