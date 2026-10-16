# Publications LinkedIn d'ALANE

Une publication par semaine, **le jeudi**, préparée par la relecture quotidienne de 6 h
(décision d'Alexandre du 15/10/2026). Alexandre la reçoit avec le résumé du matin — l'image et le
texte prêts à coller — et la publie lui-même sur la page ALANE (`linkedin.com/company/alane-fr`).
Rien n'est publié automatiquement.

## Générer l'image

```
npm run linkedin -- <fiche.json> <sortie.png>
```

Une fiche JSON décrit le visuel ; le générateur produit une image 1080 × 1350 (format 4:5, celui
qui occupe le plus de place dans le fil) aux couleurs, au logo et aux polices du site. Les polices
sont téléchargées une fois depuis Google Fonts (`ALANE_POLICES` choisit le dossier du cache).

**Un texte trop long fait échouer la génération** : raccourcir, ne jamais forcer.
Après chaque génération, **regarder l'image** (outil Read) avant de l'envoyer.

### Format des fiches

Champs communs : `modele`, `pastille` (petit badge doré en haut à droite, facultatif),
`pied_gauche` (par défaut les sept secteurs ; `""` pour rien), `pied_droite` (par défaut `alane.fr`).
Dans tous les textes, `**mot**` s'affiche en doré.

| `modele` | Champs | Usage |
|---|---|---|
| `titre-points` | `titre` (tableau de lignes : la 1re blanche, les suivantes violettes), `sous_titre`, `points` (2 à 6 × `{gras, detail}`) | une idée et ses preuves |
| `chiffre` | `chiffre`, `chiffre_texte`, `encadre`, `points` | un chiffre fort (vérifié !) |
| `etapes` | `titre`, `sous_titre`, `etapes` (3 ou 4 × `{titre, detail}`) | un parcours |
| `annonce` | `lien` (`plein`, `pointille`, `lumineux`), `titre`, `sous_titre`, `bouton` | un événement |

Exemple : [`exemple.json`](exemple.json). Les fiches de chaque semaine ne sont pas gardées dans le
dépôt : elles vivent dans le dossier de travail de la session.

## Règles de contenu — non négociables

1. **Seulement des faits vérifiés dans le code le jour même** : `src/constants/cgps.js` (ce qui est
   promis contractuellement), `src/constants/plans.js` (cashback, abonnements), `src/constants/data.js`
   (secteurs, métiers, documents), `api/` (ce qui se passe vraiment). Une promesse fausse sur
   LinkedIn est une pratique commerciale trompeuse, comme l'était l'affichage du cashback.
2. **Vocabulaire** : ALANE met en relation des clients avec des **prestataires indépendants** pour
   des **prestations**. Jamais « recrutement », « intérim », « embauche », « mise à disposition »,
   « extra », « candidat », « salarié », « travailleur » : ce serait contredire le statut de la
   plateforme (voir l'objet social et l'avis demandé à l'avocate).
3. **Aucun chiffre d'activité** (nombre d'inscrits, de prestations, de clients) tant qu'Alexandre ne
   l'a pas demandé : les volumes sont encore faibles.
4. **Aucune promesse absolue** (« toujours », « garanti », « en 5 minutes ») que le code ne tient pas.
5. **Aucun prix de frais de service ou d'abonnement**, sauf demande d'Alexandre.
6. **Aucun nom de client ni de prestataire**, aucune donnée personnelle.
7. Un texte de 600 à 1 200 caractères, aéré, une question à la fin quand elle vient naturellement,
   **3 hashtags au plus**, le lien `alane.fr` une fois.
8. Typographie : apostrophe ’, espace insécable devant ? ! : ; (le générateur s'en charge sur l'image).

## Où on en est : avant l'ouverture

La plateforme n'est **pas encore ouverte au public** : les textes parlent au futur proche
(« bientôt », « dès l'ouverture »). Quand Alexandre annonce l'ouverture, mettre à jour cette ligne,
publier le visuel n° 5 de la série d'ouverture, et passer les textes au présent.

**Série d'ouverture déjà préparée** (5 visuels envoyés le 15/10/2026, publiés par Alexandre le
mardi) : 1. en construction ; 2. trois promesses ; 3. prestataires, 100 places ; 4. comment ça
marche ; 5. c'est ouvert (le jour de l'ouverture). Les jeudis ne doivent pas les répéter.

## Calendrier des jeudis

| Jeudi | Sujet | À vérifier avant d'écrire |
|---|---|---|
| 22/10/2026 | Pourquoi ALANE : trouver un prestataire indépendant vérifié sans intermédiaire opaque | CGPS art. 1 à 4 |
| 29/10/2026 | Le prix affiché est le prix payé | `prixClient()` (`data.js`), CGPS sur les frais |
| 05/11/2026 | Comment on vérifie un prestataire | CGPS art. 2 (pièces exigées), `DOCS_REQUIS` |
| 12/11/2026 | Indépendants : vous fixez votre tarif, vous acceptez ou non | `METIERS_TARIFS`, écrans prestataire |
| 19/11/2026 | Sept secteurs, plus de 200 métiers | `SECTORS`, `METIERS` (232 le 15/10/2026) |
| 26/11/2026 | Le paiement, étape par étape | `api/stripe-intent.js`, `_cloture.js`, délai de contestation |
| 03/12/2026 | Un besoin pour demain | réservation urgente : délai et surcoût réels |
| 10/12/2026 | Chaque semaine, le même prestataire | réservation hebdomadaire (`_recurrence.js`) |
| 17/12/2026 | Le cashback des clients | `CASHBACK_TIERS` (0,5 % à 1,5 % le 15/10/2026), `tauxCashback()` |
| 24/12/2026 | Les fêtes : renforts en hôtellerie, restauration, commerce | métiers réels de ces secteurs |
| 31/12/2026 | Vœux : ce qui arrive en 2027 | rien d'annoncé qui ne soit décidé |
| 07/01/2027 | Les questions qu'on nous pose | CGPS |

Après le 07/01/2027 : proposer à Alexandre un nouveau calendrier dans le résumé.

## Livraison

Le jeudi, la relecture quotidienne :
1. prend le sujet de la date, vérifie chaque fait à la source indiquée ;
2. écrit le texte, puis la fiche, lance `npm run linkedin`, regarde l'image ;
3. envoie l'image (SendUserFile) et met le texte, prêt à coller, dans le résumé ;
4. le mentionne dans la notification du matin.

En cas de doute sur un fait, on retire la phrase : une publication plus courte vaut mieux qu'une
promesse fausse.
