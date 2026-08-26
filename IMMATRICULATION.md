# À faire le jour de l'immatriculation

Ce fichier existe pour une raison précise : le jour où la société ALANE sera
immatriculée, **une dizaine d'endroits du produit devront recevoir ses données**.
Aucun n'est visible depuis le back-office, et plusieurs ne se découvrent qu'en
lisant le code. Sans cette liste, on en oublierait — et ce sont exactement les
oublis qu'un contrôle ou un litige fait ressortir six mois plus tard.

Établi le 24/08/2026, par relecture du code. À tenir à jour comme le reste.

---

## 1. Les informations à rassembler d'abord

Une seule fois, avant de toucher au code. Toutes viennent de l'extrait
d'immatriculation.

| Donnée | Où on la trouve | Utilisée par |
|---|---|---|
| Dénomination sociale exacte | Extrait Kbis / avis de situation | mentions légales, CGPS, factures |
| Forme juridique (SAS, SASU, SARL…) | idem | mentions légales |
| Capital social | idem | mentions légales |
| SIREN (9 chiffres) | idem | mentions légales, factures |
| SIRET du siège (14 chiffres) | idem | mentions légales, factures |
| Numéro RCS + ville du greffe | idem | mentions légales |
| Code APE / NAF | idem | mentions légales |
| Adresse du siège social | idem | mentions légales, CGPS, factures |
| Numéro de TVA intracommunautaire | délivré par le SIE | **voir §5, décision à prendre** |
| Directeur de la publication | c'est le représentant légal | mentions légales (obligation LCEN) |
| Responsable de traitement RGPD | la société, représentée par | politique de confidentialité |

---

## 2. Les mentions légales — `src/components/client-screens.jsx`

L'écran existe déjà et porte des marqueurs `[À REMPLIR]`. Chercher cette chaîne
dans le fichier : elle apparaît dans deux sections.

**Section « Éditeur du site »** — six champs :
raison sociale, forme juridique, capital social, SIRET, siège social,
directeur de la publication.

**Section « Données personnelles »** — deux champs :
responsable de traitement, délégué à la protection des données (le second n'est
obligatoire que dans des cas précis ; à défaut, écrire « non désigné » plutôt
que de laisser un crochet vide).

**Ne pas oublier** : porter la date du jour dans `maj`, qui indique aux
utilisateurs quand le document a changé.

> **Pourquoi c'est le premier point de la liste.** L'article 6-III de la loi
> pour la confiance dans l'économie numérique impose ces mentions à tout
> éditeur de service en ligne, et leur absence est punie pénalement. C'est
> aussi la première chose que regarde un utilisateur qui doute.

---

## 3. Les CGPS et les CGU — `src/constants/cgps.js`, `src/constants/cgu.js`

Les deux textes désignent ALANE comme « la société éditrice de la plateforme »
sans jamais la nommer ni l'identifier. Il faut, à l'article 2 des CGPS
(Définitions) et à l'équivalent des CGU, remplacer cette formule par
l'identification complète : dénomination, forme, capital, siège, RCS.

**Après modification** : lancer `npm run cgps`, qui régénère `public/cgps.html`.
La CI refuse toute divergence entre le fichier source et la version publique.

**Et penser à la date de version** (`maj` en tête de `cgps.js`) : publier une
nouvelle version des conditions est une décision, elle doit se voir.

---

## 4. Le médiateur de la consommation

Les mentions légales annoncent aujourd'hui qu'ALANE est « en cours de
désignation d'un médiateur ». C'est une promesse datée : elle ne peut pas rester
en l'état une fois la société créée.

**La désignation est obligatoire** (articles L.612-1 et suivants du Code de la
consommation) dès lors qu'on s'adresse à des consommateurs — ce qui est le cas,
les CGPS visent explicitement les clients particuliers.

1. Adhérer à un médiateur référencé par la CECMC (liste sur `economie.gouv.fr`).
2. Reporter ses **nom, adresse postale et site** dans la section
   « Résolution des litiges et médiation » des mentions légales.
3. Supprimer la phrase « en cours de désignation ».

---

## 5. La TVA sur les frais de service — **décision à prendre**

C'est le point le plus structurant, et il n'est pas seulement administratif.

**Aujourd'hui**, les frais de service d'ALANE (4,90 € + 2 %) sont encaissés sans
aucune mention de TVA. `api/_montant.js` ne connaît pas ce mot. Tant qu'il n'y a
pas de société, la question ne se pose pas.

**Une fois la société créée**, deux cas :

- **Franchise en base** (sous les seuils) : rien à changer dans le calcul, mais
  la mention « TVA non applicable, art. 293 B du CGI » devient obligatoire sur
  les documents portant les frais de service.
- **Assujettissement à la TVA** : les frais de service deviennent un montant
  HT auquel s'ajoute 20 %. **Cela change le prix payé par le client**, donc
  l'affichage du tunnel de commande, le calcul de `_montant.js`, le récapitulatif
  de la facture, et la promesse « prix affiché = prix réel » qui est le bandeau
  permanent du site.

> **À trancher avec le comptable, pas seul.** Et à me dire : le second cas est
> un vrai chantier, pas un réglage.

---

## 6. La facture des frais de service — **manquante aujourd'hui**

La facture actuelle (`api/invoice.js`) est celle **du prestataire au client**,
établie par ALANE en vertu du mandat de facturation. Elle est correcte.

Mais les frais de service, eux, sont une prestation **d'ALANE au client**, et
aucun document ne les facture. Le client voit « Frais de service ALANE : 5,20 € »
dans un récapitulatif, ce qui n'est pas une facture et ne lui permet pas de
récupérer sa TVA ni de justifier sa charge.

Tant qu'ALANE n'existe pas juridiquement, elle ne peut rien facturer — le
manque est donc sans conséquence. **Le jour de l'immatriculation, il en a une** :
il faut créer ce document, avec sa propre numérotation, distincte de celle des
factures prestataires.

---

## 7. Le compte Stripe — à refaire au nom de la société

**Rien ne se transfère d'un compte Stripe à un autre** : ni les clients, ni les
abonnements, ni les comptes Connect des prestataires. C'est la raison pour
laquelle aucun prestataire ne doit être validé avant l'immatriculation.

Le jour venu :

1. Créer le compte Stripe au nom de la société.
2. Reprendre les six variables d'environnement dans Vercel :
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, et les quatre tarifs
   `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY`,
   `STRIPE_PRICE_ELITE_MONTHLY`, `STRIPE_PRICE_ELITE_YEARLY`.
   *(Les variantes sans `PRICE_` sont acceptées par le code, mais la forme
   longue est la référence — autant repartir propre.)*
3. Recréer les quatre tarifs dans le catalogue Stripe : **29,99 €** et
   **79,99 €**, mensuel et annuel.
4. Redéployer : les variables ne sont lues qu'au déploiement.
5. Vider les colonnes devenues fausses en base — voir §8.

> **Taper les valeurs à la main, ne pas les coller.** Les variables Vercel de ce
> projet ont déjà contenu des espaces invisibles collés depuis un iPad, et le
> symptôme est un 401 sans message.

---

## 8. Les données à nettoyer en base

Les identifiants Stripe enregistrés pointeront vers un compte qui n'est plus le
bon. Les laisser ferait échouer chaque paiement avec un message incompréhensible.

```sql
-- À passer APRÈS la bascule du compte Stripe, et pas avant.
UPDATE public.profiles
   SET stripe_customer_id     = NULL,
       stripe_subscription_id = NULL,
       stripe_account_id      = NULL,
       stripe_account_status  = NULL;
```

Vérifier d'abord ce qui sera effacé :

```sql
SELECT count(*) FILTER (WHERE stripe_customer_id     IS NOT NULL) AS clients,
       count(*) FILTER (WHERE stripe_subscription_id IS NOT NULL) AS abonnements,
       count(*) FILTER (WHERE stripe_account_id      IS NOT NULL) AS comptes_virement
  FROM public.profiles;
```

Si des abonnements payants existent à ce moment-là, **les résilier dans l'ancien
compte Stripe avant** : sinon ils continuent d'être prélevés sur un compte que
plus personne ne surveille.

---

## 9. La numérotation des factures — à décider

Deux factures d'essai ont été émises pendant les tests : `FAC-2026-000001` et
`FAC-2026-000002`. Elles ont été conservées volontairement (article L123-22 du
Code de commerce, dix ans), leurs prestations ayant été supprimées.

La première facture réelle portera donc `FAC-2026-000003`. **C'est régulier** :
la continuité d'une numérotation s'apprécie vers l'avant, pas depuis 1.

Si le comptable préfère repartir de 1, c'est possible — mais cela suppose de
supprimer les deux archives, donc de renoncer à la trace des documents émis.
**Cette décision lui appartient, pas à nous.**

---

## 10. ~~Les faux documents du back-office~~ — **fait le 24/08/2026**

`DemoDocPreview` fabriquait sept documents officiels à l'écran pour les comptes
de démonstration : extrait Kbis sous en-tête « Tribunal de commerce de Paris »,
attestation URSSAF avec son numéro, relevé d'identité bancaire « Crédit
Agricole », carte d'identité « République française », attestation d'assurance,
justificatif de domicile, photo. Le Kbis portait le code APE **7820Z — Activité
des agences de travail temporaire**, soit la qualification même que l'article
4.1 des CGPS s'emploie à écarter, et une identité de société inventée.

Ils sont remplacés par un encart qui dit ce qu'il est. Rien à faire de plus.

---

## Une fois tout fait

- `npm run cgps` puis `npm run cgps:verifier` — la version publique doit suivre.
- `npm run lint`, `npm run coherence`, `npx vitest run` — au vert.
- Relire les mentions légales **dans l'application**, pas dans le code :
  c'est là qu'un crochet oublié se voit.
- Mettre à jour `DOCUMENTATION.md` §8 si des variables d'environnement changent.
- Et cocher ce fichier, ou le supprimer s'il n'a plus d'objet.
