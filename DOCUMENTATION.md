# JOBER / ALANE — Documentation du projet

Documentation de référence : à quoi sert le projet, comment il est construit, et comment
les données circulent. Les **règles de travail** (ce que Claude doit faire ou ne pas faire)
sont dans [CLAUDE.md](CLAUDE.md).

> **Source de vérité** : c'est la base Supabase elle-même. Les fichiers `.sql` à la racine
> sont d'anciens brouillons divergents, ils ne font pas autorité.

---

## 1. Le produit en deux phrases

ALANE est une place de marché qui met en relation des **clients** (entreprises ayant un besoin
ponctuel) et des **prestataires** indépendants (auto-entrepreneurs) dans la propreté, la
logistique, la restauration, l'hôtellerie et le commerce.

Le client publie ou commande une prestation, un prestataire l'accepte, la réalise, puis les
deux valident. Le paiement passe par Stripe, la plateforme prend une commission, et le client
cumule du cashback.

---

## 2. Architecture

| Brique | Technologie |
|---|---|
| Interface | React 19 + Vite, application monopage, styles en ligne |
| Base de données & authentification | Supabase (PostgreSQL + RLS) |
| Fichiers | Supabase Storage, bucket `Documents` (privé) |
| Fonctions serveur | Vercel Functions, dossier `/api` |
| Paiement | Stripe |
| Emails | Resend · SMS et emails de relance : Brevo |
| Hébergement | Vercel — `www.alane.fr`, backoffice sur `admin.alane.fr` |

**Ce n'est pas du Next.js**, malgré le dossier `/api`. C'est du React pur côté navigateur,
plus des fonctions serverless Vercel à côté. Il n'y a pas de rendu serveur.

### Organisation des fichiers

```
src/
  App.jsx                    ~1500 l. — état global, navigation, gardes d'accès
  lib/
    supabase.js              client Supabase
    routes.js                correspondance écran ↔ URL
  components/
    auth.jsx                 connexion + inscription (client et prestataire)
    client-screens.jsx       ~8000 l. — tout l'espace client
    presta-screens.jsx       ~3300 l. — tout l'espace prestataire
    backoffice.jsx           ~3100 l. — administration
    payment.jsx              tunnel de paiement Stripe
    ui.jsx                   composants partagés (boutons, badges, modales)
  constants/
    data.js                  secteurs, métiers, tarifs, documents requis
    plans.js                 abonnements, frais, paliers de cashback
    colors.js                charte graphique
api/                         27 fonctions serverless
```

Les fichiers d'écrans sont volumineux (8000 lignes pour l'espace client). C'est un choix
historique : **on ne le refond pas sans demande explicite**.

---

## 3. Les deux espaces

### Client
Cherche un prestataire dans le catalogue ou publie une demande, réserve, paie, suit la
prestation en direct (géolocalisation), valide, note. Dispose d'un portefeuille prépayé et
d'un cashback progressif.

### Prestataire
Dépose ses documents, attend la validation par l'administration, reçoit des propositions,
accepte ou refuse dans un délai imparti, pointe son arrivée, valide la fin. Peut souscrire un
abonnement pour dépasser le quota gratuit de prestations mensuelles.

### Backoffice
Sur `admin.alane.fr`, protégé par mot de passe et éventuellement par filtrage d'adresses IP.
Valide les comptes, consulte les documents, gère les litiges, les remboursements et les
réglages de la plateforme.

---

## 4. La base de données

### Tables principales

**`profiles`** — le compte applicatif, un par utilisateur, avec le même identifiant que dans
Supabase Auth.
Champs clés : `role` (`client` ou `prestataire`), `status` (`pending`, `approved`, `rejected`,
`suspended`), `missions_enabled` (accès aux prestations accordé par l'administration),
`plan_abonnement`, `cashback_balance`, `prepaid_balance`, `avatar_url`.

**`missions`** — la prestation. C'est l'objet central. Attention : **il n'existe pas de table
`prestations`**, malgré le vocabulaire employé dans l'interface.
Statuts autorisés : `open`, `pending_acceptance`, `assigned`, `needs_replacement`,
`completed`, `closed`, `cancelled`, `disputed`, `rejected`, `refused`.

**`documents`** — les pièces justificatives des prestataires.
Types : `photo`, `kbis`, `urssaf`, `cni`, `domicile`, `rib`, `rc_pro`, `diplomes`, `tva`,
`autre`. **Un seul document par prestataire et par type** (contrainte unique).

**`candidatures`** — les prestataires qui postulent à une mission ouverte.

**`notifications`**, **`messages`**, **`support_tickets`**, **`ratings`**,
**`tracking_positions`** (géolocalisation en cours de prestation), **`favorites`**,
**`push_subscriptions`**.

**`visits`** — compteur de visites anonymes. Une ligne est insérée au premier chargement de
chaque session (`App.jsx:1103`), avec un simple `session_id` et aucune donnée personnelle.

**`booking_drafts`** — réservations abandonnées en cours de tunnel. Écrites par
`booking-draft.js` à l'entrée du tunnel et effacées à la fin ; `cron-abandon.js` les relit
pour envoyer les relances.

**`contracts`** — contrats de prestation générés et signés (`client-screens.jsx:4756`).

### Fonctions SQL (RPC)

**Le déclencheur `missions_field_tamper_guard` ne couvre que les `UPDATE`.** Vérifié en base
le 30/07/2026 : `CREATE TRIGGER missions_field_tamper_guard BEFORE UPDATE ON public.missions`.
Une ligne `missions` est **insérée par le navigateur du client** (`App.jsx`,
`client-screens.jsx`) : à la création, il choisit donc librement `tarif_horaire` et
`montant_total`. Ne jamais considérer ces deux champs comme fiables. Ils sont contrôlés
côté serveur à deux endroits, et il faut les deux :

- `api/stripe-intent.js` — le total moins la part horaire doit correspondre à l'un des trois
  frais de service du barème, sinon le paiement est refusé ;
- `api/missions.js` (`assign_after_payment`) — le tarif horaire payé ne peut pas être
  inférieur au `tarif_net` réellement annoncé par le prestataire affecté.

**`missions_creation_guard`** (migration `2026-07-30_secu_verrou_creation_prestation.sql`)
double ces contrôles au niveau de la base, seul endroit qu'aucun chemin d'écriture ne peut
contourner. Pour un compte connecté, il interdit à la création : un `client_id` autre que
soi-même, un `prestataire_id` renseigné, un statut hors `open`/`pending_acceptance`, un
`stripe_payment_intent`, un `acceptance_deadline`, un pointage antidaté, et un
`montant_total` inférieur à la seule part horaire (frais de service négatifs). `service_role`
et les rôles d'administration sont exemptés. Il pose une **borne basse** sur le montant, pas
le calcul exact du tarif : reproduire la grille tarifaire en base finirait par diverger du
tunnel de réservation et bloquerait des réservations légitimes.

**`wallet_topups`** — le registre des recharges de portefeuille. La clé primaire est
l'identifiant du paiement Stripe : c'est la base, et non le code, qui empêche qu'une même
recharge soit créditée deux fois. Lisible par le seul service role. Avant elle, l'argent
entrait dans le portefeuille sans laisser aucune trace — un solde ne pouvait être ni
justifié, ni rapproché des encaissements Stripe.

Trois procédures stockées sont appelées depuis le code, et n'existent donc que dans la base :

- `check_prestataire_slot` — vérifie la disponibilité d'un prestataire sur un créneau.
- `increment_cashback` — crédite le cashback de façon atomique.
- `crediter_portefeuille` — enregistre une recharge et incrémente le solde dans une seule
  transaction ; renvoie `NULL` si la recharge avait déjà été traitée. Le webhook sait
  fonctionner sans elle (repli sur l'ancien crédit, non protégé, signalé dans les journaux).

Comme elles ne sont pas visibles dans les fichiers SQL du dépôt, une modification de leur
signature casse le code sans que rien ne le signale. **La référence, c'est la base.**

**`platform_settings`** — les réglages modifiables depuis le backoffice, stockés en clé/valeur.
Chaque clé est listée avec **l'endroit qui l'applique réellement** : un réglage qu'aucun code
ne lit est un piège, l'administrateur croit agir alors que rien ne change.

| Clé | Appliquée par |
|---|---|
| `cashback_rates` | `api/missions.js` (action `complete`) |
| `subscription_prices` | `api/plans.js`, écrans d'abonnement |
| `plan_limits` | `api/missions.js` — helper `limitePlanMensuelle()`, appliqué au plan lu dans **`profiles`** |
| `launch_phase` | badges de l'interface **et** `limitePlanMensuelle()` (10 prestations/mois aux 100 premiers prestataires) |
| `frais_service` | tunnel de réservation, `api/stripe-intent.js` |
| `urgency_surcharge` | écran de secteur (majoration affichée au client) |
| `disabled_sectors` | `api/missions.js` — `get_sector_status` (affichage) et `assign_after_payment` (refus de réservation) |
| `invoice_sequence` | `api/invoice.js` — compteur incrémenté **une fois par facture**, à sa première consultation, jamais aux suivantes |
| `commission_rate` | **personne** — vestige : la plateforme se rémunère sur les frais de service, `prixClient()` applique 0 % de commission. Ne pas s'y fier. |

`sector_min_prestataires` a été retirée : elle fermait automatiquement tout secteur comptant
moins de 30 prestataires, ce qui aurait verrouillé la plateforme entière. L'ouverture d'un
secteur relève désormais de la seule décision explicite de l'administrateur
(`disabled_sectors`). La clé peut rester en base, plus rien ne la lit.

**`account_blacklist`** — empreintes des comptes supprimés, pour empêcher qu'on recrée un
compte afin de récupérer l'essai gratuit. **Ne contient que des empreintes**, jamais de
données en clair.

**`bo_logs`**, **`bo_rate_limits`** — traçabilité et limitation du backoffice.

### Tables inutilisées

`prestataires`, `metiers`, `disponibilites`, `abonnements`, `bookings`, `mission_responses`
sont **vides et jamais lues par le code**. Elles doublonnent des données qui vivent
aujourd'hui dans `profiles`, `missions` et `candidatures`. Conservées par choix — **ne pas
les utiliser pour de nouveaux développements**.

### Où vivent les données

C'est le point le plus déroutant du projet, et la source de plusieurs pannes.

| Emplacement | Contenu | Limite |
|---|---|---|
| `auth.users.user_metadata` | Infos saisies à l'inscription : téléphone, adresse, secteur, métier, tarif, disponibilités, compétences | **Encodé dans le jeton, ~16 Ko max** |
| `profiles.rib` | IBAN du prestataire | **Jamais dans `user_metadata`** — voir ci-dessous |
| Table `profiles` | Rôle, statut, soldes, abonnement, photo | Aucune |
| Storage `Documents` | Les fichiers justificatifs | 10 Mo par fichier |

Beaucoup d'informations métier sont dans `user_metadata` plutôt que dans une table. C'est un
héritage. **La règle absolue : rien de volumineux dans `user_metadata`** — voir CLAUDE.md §1.1.

---

## 5. La logique Supabase

### Deux clés, deux niveaux de confiance

**La clé anonyme** est publique, embarquée dans le code envoyé au navigateur. N'importe qui
peut la lire. Elle ne donne aucun privilège : c'est la **RLS** (sécurité au niveau des lignes)
qui décide de ce qui est lisible.

**La clé service role** contourne toute la sécurité. Elle n'existe que dans les variables
d'environnement Vercel et n'est utilisée que dans `/api`. Si elle fuitait, toute la base
serait exposée.

### La RLS, en pratique

Chaque table a des règles décrivant qui peut lire et écrire quoi. Le principe général :

- **`profiles`** : chacun ne voit et ne modifie que sa propre ligne.
- **`missions`** : visibles par le client concerné, le prestataire assigné, et tout le monde
  si la mission est ouverte (pour que les prestataires puissent postuler).
- **`documents`** : chaque prestataire ne voit que les siens. Le backoffice y accède via `/api`.
- **`platform_settings`** : seules les clés nécessaires avant connexion sont publiques
  (tarifs, phase de lancement). La commission et les taux de cashback sont privés.
- **`notifications`** : chacun lit et marque comme lues **ses** notifications, mais
  **personne ne peut en créer** depuis le navigateur. Toutes les notifications sont
  insérées par `/api/missions` en service role. Cette écriture était ouverte à tout
  compte connecté jusqu'au 29/07/2026 — c'était un vecteur de phishing in-app.
- **Storage** : chacun n'écrit que dans son dossier `{user_id}/`.

Deux conséquences pratiques :

1. **Une requête qui ne renvoie rien n'est pas forcément une erreur** — ce peut être la RLS
   qui filtre. Vérifier le rôle avant de conclure à un bug.
2. **Toute opération sensible passe par `/api`**, qui vérifie l'appelant puis agit en service
   role. Le front ne doit jamais pouvoir modifier un montant ou un statut de mission.

### Les fonctions serveur

Les 27 fichiers de `/api`. Les principaux :

| Fichier | Rôle |
|---|---|
| `missions.js` | Cycle de vie complet des prestations (le plus gros) |
| `bo-action.js` | Toutes les actions du backoffice |
| `prestataires.js` | Catalogue des prestataires |
| `stripe-*.js` | Paiement, remboursement, abonnement, portefeuille, webhook |
| `upload-document.js`, `save-document.js`, `get-documents.js` | Documents |
| `support.js` | Tickets, emails, suppression de compte |
| `cron-*.js` | Tâches planifiées (remise à zéro mensuelle, relances) |
| `_auth.js`, `_email.js` | Fonctions partagées — `verifyUser`, envoi d'emails, hachage |

### Comment l'appelant est vérifié

Il n'y a **pas** un seul schéma d'authentification mais quatre, selon la nature de l'appel.
Le confondre conduit à ajouter la mauvaise vérification dans un nouveau fichier.

| Mécanisme | Fichiers | Principe |
|---|---|---|
| `verifyUser` | `missions`, `support`, `wallet`, `stripe-intent`, `stripe-wallet-topup`, `booking-draft`, `get-documents`, `notify-doc` | Jeton Supabase de l'utilisateur, validé auprès de `/auth/v1/user` |
| Vérification inline équivalente | `save-document`, `update-profile`, `upload-document`, `stripe-subscription` | Même principe, mais avec une copie locale du code au lieu de `_auth.js` |
| Token backoffice | `bo-action`, `bo-verify-pin`, `invoice`, `stripe-refund`, `reset-password`, `forgot-password`, `seed-demo` | Session BO signée en HMAC avec `BO_SESSION_SECRET` |
| `CRON_SECRET` / signature Stripe | `cron-abandon`, `cron-reset-monthly` / `stripe-webhook` | Appels machine, jamais déclenchés par un utilisateur |

`missions.js` utilise une version **étendue** de `verifyUser` qui contrôle en plus le `status`
du profil. C'est volontaire : ne pas la remplacer par celle de `_auth.js`.

### Deux endpoints sans aucune authentification

Ce sont les seules exceptions, et elles méritent d'être connues avant d'être copiées comme
modèle :

- **`get-profile.js`** — reçoit un `userId` dans le corps de la requête et renvoie `role`,
  `status`, `missions_enabled` et `plan_abonnement` de ce compte, en service role, donc
  **hors RLS**. Quiconque connaît un identifiant peut lire ces champs. Les données restent
  limitées (ni nom, ni email, ni téléphone) mais la lecture n'est pas contrôlée.
- **`prestataires.js`** — sert le catalogue complet des prestataires approuvés (identifiant,
  prénom, nom, photo) sans vérifier l'appelant. À noter : cela **contourne la décision S-11**
  de l'audit, qui avait fermé ce catalogue aux comptes connectés en retirant les policies RLS
  publiques. La restriction porte sur l'accès direct à la table, pas sur cet endpoint.
  La route allégée `?action=count`, elle, doit rester publique : l'écran d'accueil s'en sert
  avant toute connexion.

Refermer ces deux points est une décision produit, pas une correction évidente : `get-profile`
est appelé pendant la connexion, et le catalogue sert aussi les liens de partage `?profil=`
qui fonctionnent aujourd'hui sans compte.

### Ce que le front n'a plus le droit d'écrire

Trois écritures sensibles se faisaient directement depuis le navigateur. Elles passent
toutes par `/api/missions` depuis le 29/07/2026, et **rien ne doit les y ramener** :

| Écriture | Action serveur | Pourquoi |
|---|---|---|
| Notification | `notify_prestataire` | Un compte pouvait notifier n'importe qui, avec un texte libre |
| Clôture de mission + cashback | `complete` | Le client écrivait son propre solde ; taux de `plans.js` au lieu de la base, et lecture-écriture non atomique |
| Refus après délai expiré | `acceptance_timeout` | Le serveur revérifie que `acceptance_deadline` est réellement dépassée |

La règle générale reste celle de `CLAUDE.md` §3.3 : **argent, statut de mission et cashback
ne s'écrivent jamais depuis `src/`.**

### Migrations

Le dossier `migrations/` contient les changements de schéma et de policies, datés et
nommés en français. Ils ne sont **pas appliqués automatiquement** : il faut les jouer dans
l'éditeur SQL Supabase. Chaque fichier porte ses requêtes de vérification et sa procédure
de retour arrière.

Les trois fichiers `*.sql` à la racine (`supabase-schema.sql`, `supabase_schema.sql`,
`supabase_migration.sql`) sont des reliquats divergents — **aucun ne fait autorité**.

Cette divergence a déjà coûté une panne complète : `supabase-schema.sql` annonce
`documents.id uuid`, `supabase_schema.sql` annonce `documents.id BIGSERIAL`. Le backoffice
avait été écrit sur la première hypothèse et exigeait un uuid, si bien que **la validation
et le refus d'un document répondaient toujours « docId invalide »** — les boutons n'ont
jamais fonctionné. Avant d'écrire un contrôle de format sur une clé primaire, **relever son
type dans la base** (`SELECT pg_typeof(id) FROM <table> LIMIT 1;`), jamais dans ces fichiers.

---

## 6. Parcours utilisateur

### Inscription et validation

**Les deux rôles ne suivent pas le même chemin.** C'est une source de confusion fréquente.

```
CLIENT
Inscription → status "approved" directement (auth.jsx:826)
           → email de bienvenue
           → accès immédiat à l'application, aucune validation backoffice

PRESTATAIRE
Inscription → status "pending" (auth.jsx:131)
           → email de bienvenue
           → écran d'attente, l'application est inaccessible
Backoffice → validation → status "approved" → email de confirmation
           → il faut EN PLUS missions_enabled = true pour accéder aux prestations
```

Autrement dit : **seuls les prestataires passent par une validation manuelle.** Un client
créé à l'instant peut réserver immédiatement.

**L'IBAN vit dans `profiles.rib`, jamais dans `user_metadata`.** Il y était stocké, donc
encodé dans le jeton d'authentification, transmis en en-tête HTTP à chaque requête et
conservé dans le navigateur. Ce n'est pas un problème de taille — 27 caractères — mais
d'exposition : une coordonnée bancaire atteignait ainsi chaque point d'entrée de la
plateforme, y compris ceux qui n'en ont aucun besoin (minimisation, RGPD art. 5.1.c). Les
quatre lectures (liste du backoffice, approbation, suppression, contrôle anti-recréation à
l'inscription) lisent `profiles.rib` en priorité et retombent sur l'ancien emplacement tant
que l'étape 2 de la migration `2026-07-30_rgpd_iban_hors_du_jeton` n'a pas été passée.

**`profiles.plan_abonnement` fait seule foi pour l'abonnement.** `user_metadata` en contient
une copie, mais elle n'est **jamais** opposable : à l'inscription, le prestataire choisit son
plan d'un simple appui, sans paiement, et cette valeur y atterrit. Tant que le repli sur
user_metadata existait, il suffisait de sélectionner Elite en créant son compte pour obtenir
999 prestations par mois, le badge et la première place dans les résultats — sans rien régler.
`user_metadata.plan_souhaite` conserve désormais ce choix comme simple intention.

Seuls trois chemins accordent un plan payant : le webhook Stripe, la vérification directe de
l'abonnement dans `refresh_plan`, et le forçage manuel depuis le backoffice.

`status` et `missions_enabled` sont deux choses différentes : un prestataire peut avoir un
compte validé tout en n'ayant pas encore accès aux prestations, tant que son dossier
documentaire n'est pas complet.

`missions_enabled` vaut **`false` par défaut** (colonne créée avec `DEFAULT false`). Le verrou
est appliqué à trois endroits, et il faut les trois : l'interface du prestataire masque la
liste des prestations, `api/prestataires.js` l'exclut du catalogue client, et
`api/missions.js` (`assign_after_payment`) refuse de lui affecter une prestation. Tant que
l'administrateur n'a pas cliqué « ✅ Activer l'accès aux prestations » dans le backoffice, un
prestataire approuvé **n'apparaît pas** aux clients — c'est voulu, mais c'est aussi la première
chose à vérifier si le catalogue paraît vide.

Quatre statuts existent : `pending`, `approved`, `rejected`, `suspended`. Le dernier est
traité à la connexion (`auth.jsx:1175`) et au démarrage (`App.jsx:1391`) : la session est
fermée et l'utilisateur renvoyé à l'écran de choix de rôle.

### Cycle d'une prestation

```
open                 publiée, les prestataires peuvent postuler
pending_acceptance   un prestataire est sollicité, il a un délai pour répondre
assigned             accepté, prestation à venir ou en cours
completed            terminée et validée des deux côtés
closed               clôturée
```

Chemins de sortie : `cancelled` (annulation), `disputed` (litige),
`needs_replacement` (le prestataire se désiste, retour au marché), `rejected` / `refused`.

**`needs_replacement` signifie « déjà payée ».** C'est ce qui la distingue d'une prestation
réouverte en `open` : le prestataire s'est désisté après paiement, l'argent du client est
conservé le temps de trouver un remplaçant. Si la date passe sans remplaçant, le cron
mensuel **rembourse intégralement** puis passe la prestation en `cancelled` — le contrat le
promet, et rien ne l'appliquait : la prestation était clôturée et l'argent restait acquis à
la plateforme. Un remboursement qui échoue **diffère la clôture** plutôt que de la masquer :
la prestation est reprise au passage suivant.

**`profiles_privileges_guard`** (migration `2026-07-30_secu_verrou_champs_profil.sql`) protège
les champs privilégiés du profil. La ligne `profiles` est créée **et** modifiée par le
navigateur — quatre `upsert` dans `auth.jsx`, des `update` dans les écrans de profil — qui y
choisit donc lui-même `role` et `status`. L'application n'écrit jamais autre chose que
`status = 'pending'`, mais rien ne l'y obligeait : seule la RLS protégeait ces champs. Le
déclencheur rend la question sans objet. Restent libres : nom, prénom, adresse, ville, code
postal, `avatar_url`, `rib`.

**`META_EXPOSE` dans `api/bo-action.js` liste les champs `user_metadata` renvoyés au
backoffice.** C'est une liste blanche volontaire — un champ sensible ajouté plus tard ne fuite
pas par accident — mais elle doit être **étendue en même temps que l'inscription**. Elle datait
d'avant le formulaire prestataire actuel : le backoffice affichait « Secteur », « Métier »,
« Tarif net », « Adresse » et « Langues » sans jamais les recevoir, et la fiche d'un candidat
se résumait à son email, son téléphone et son IBAN — alors que c'est sur ces informations que
repose la décision de validation.

**Le SIRET d'un prestataire est dans `user_metadata.siret`**, pas dans `kbis`, qui n'est
renseigné que pour les clients professionnels. Le contrôle à l'approbation et le bouton
« Vérifier IBAN / SIRET » ne lisaient que `kbis` : aucun SIRET de prestataire n'était vérifié.

**`api/update-profile.js` filtre ce que le navigateur peut écrire dans `user_metadata`.**
Il fusionnait sans aucun filtre l'objet reçu : un compte pouvait donc s'attribuer un
abonnement, se valider lui-même ou se créditer un portefeuille en modifiant son profil. Une
liste de champs privilégiés est refusée (`plan_abonnement`, `status`, `missions_enabled`,
`prepaid_balance`, les identifiants Stripe…). Deux garde-fous de taille s'y ajoutent, la
fonction écrivant précisément le champ visé par la règle 1.1 : toute valeur commençant par
`data:` est refusée, et l'ensemble est plafonné à 6 Ko — bien en deçà des 16 Ko de l'en-tête,
qui doit aussi porter la signature du jeton.

**Les avis passent par `/api/missions` (`submit_rating`), jamais par le navigateur.**
L'insertion s'y faisait directement : le contrôle d'éligibilité était une requête du front,
contournable, et côté prestataire il n'existait pas du tout — on pouvait noter n'importe qui,
autant de fois que voulu, alors que la note pilote le classement du catalogue. Le serveur
vérifie que l'auteur a pris part à la prestation, qu'elle est terminée, et qu'il n'a pas déjà
donné son avis ; le destinataire est déduit de la prestation. `reviewee_provider_id` porte
selon le sens le prestataire **ou** le client — le nom de la colonne est trompeur.

**Les frais de service sont dus sur toute annulation à l'initiative du client**, quel que
soit le délai — CGPS art. 8.1, « en principe retenus et non remboursables car ils couvrent des
coûts déjà engagés ». Le serveur les remboursait pourtant au-delà de 24 h, alors que l'écran
de confirmation annonçait déjà « hors frais de service ». Unique exception, CGPS art. 8.2 :
la défaillance du prestataire, où le remboursement est intégral.

**Retard du prestataire : le client peut annuler sans aucun frais.** Le seuil est
proportionnel à la durée — `min(60 min, max(20 min, 25 % de la durée))`, soit 20 min pour une
prestation d'une heure, 30 min pour deux heures, 60 min au-delà de quatre. Un retard se juge
en proportion : 30 minutes sur une heure, c'est la moitié du service perdu ; sur huit heures,
un contretemps. Le droit **se referme dès le démarrage** — le prestataire est alors à l'œuvre
et c'est l'arbitrage du décalage qui rééquilibre ; annuler le ferait travailler pour rien.
Le remboursement est **intégral, frais de service compris**, comme le promet le contrat en cas
de défaillance du prestataire. Le retard est recalculé par `cancel_client` et jamais lu depuis
la requête. Le seuil est dupliqué dans `seuilAnnulationRetardMin()` côté front pour
n'afficher le bouton qu'à bon escient : les deux doivent rester alignés.

**Article 5.2 des CGPS — l'affectation est faite par ALANE dès qu'un tiers est en jeu.** Le
choix libre d'un prestataire nommément désigné a été identifié comme le principal point de
vulnérabilité de la plateforme : il est exactement le critère que l'article 10B.2 interdit.
Le choix reste libre quand le client commande pour lui-même ; il disparaît dès qu'il déclare
intervenir chez un tiers. Le code doit suivre : voir « affectation automatique » ci-dessous.

**Affectation automatique chez un tiers** — `candidatsPourMission()` et l'action
`affecter_tiers` dans `api/missions.js`. Dès qu'une prestation porte une
`tiers_declaration`, le prestataire consulté par le client n'est **pas** transmis :
`affecter_tiers` remplace `assign_after_payment` et la plateforme sélectionne elle-même.

Les critères sont **objectifs et uniquement objectifs** : métier (principal ou secondaire),
secteur, tarif — jamais en dessous du `tarif_net` du prestataire —, jour de disponibilité
déclaré, rayon d'intervention, quota restant. L'ordre est la distance puis la charge du mois.
**Ni note, ni abonnement, ni ancienneté** : un classement fondé sur le comportement donnerait
prise au reproche d'un pouvoir de direction déguisé. Ne pas en ajouter.

`affecterCandidatSuivant()` fait la cascade : un refus (`respond_mission`) ou un délai dépassé
(`acceptance_timeout`) passe au candidat suivant au lieu de rembourser — le client n'a désigné
personne, sa commande tient. À court de candidats, la prestation bascule en `open`, donc en
diffusion : c'est alors le prestataire qui se propose, ce qui rend son autonomie visible et
horodatée.

**Articles 10B.5 à 10B.8** — garanties du client professionnel, droit d'audit sur le contrat
conclu avec le bénéficiaire final, clause d'indemnisation (civile uniquement : elle ne couvre
pas le pénal, qui reste personnel), et fondement contractuel des mécanismes de détection avec
conservation des vérifications.

**Le contrat de prestation ne prétend plus interdire une requalification.** Il affirmait
« Aucune requalification en contrat de travail ne saurait résulter du présent accord » — une
clause qu'un juge ignore, et qui donne l'impression de vouloir neutraliser une règle d'ordre
public. Elle est remplacée par la reconnaissance que la qualification dépend des conditions
réelles d'exécution et relève de l'appréciation souveraine des juridictions.

**Article 10C des CGPS — horaires, décalage et durée facturée.** Le mécanisme de décalage
modifie le montant dû : il devait donc figurer dans les conditions, et y être qualifié. Le
10C.3 énonce que l'ajustement détermine le prix du service réellement exécuté et **n'est ni
une pénalité, ni une sanction**, sans conséquence sur l'accès à la plateforme, le classement
ou le quota — ce qui doit rester vrai dans le code. Le 10C.4 ouvre un réexamen contradictoire
sous quinze jours, le 10C.5 décrit l'annulation sans frais pour retard substantiel.

**La grille de cashback des CGPS doit suivre `CASHBACK_TIERS`.** Elle annonçait une grille qui
n'a jamais existé — 0,5 % sous 10 prestations, 1 % de 10 à 29, 1,5 % au-delà de 30 — alors que
la grille réelle est 0,5 / 0,75 / 1 / 1,5 % aux paliers 0-2, 3-5, 6-9 et 10+. Trois endroits à
garder alignés : `plans.js`, `platform_settings.cashback_rates` et l'article 5B.1.

**`missions.tiers_declaration`** (migration `2026-08-05_declaration_intervention_tiers.sql`)
conserve la déclaration de l'article 10B : bénéficiaire final, service vendu, périmètre et
critères, livrable attendu, et identité de la personne qui organise le travail sur place.
Elle n'est demandée qu'aux **comptes professionnels** qui cochent « exécutée au bénéfice ou
dans les locaux d'un tiers », et les cinq champs conditionnent alors la réservation.

Le point de droit qui justifie ce formulaire : **il n'existe aucun seuil de durée ni de
récurrence**. Une mission d'une journée peut être requalifiée, une prestation récurrente peut
rester licite. Ce qui distingue les deux, c'est l'objet de ce qui est vendu — un livrable, ou
la présence d'une personne. Le formulaire force la première formulation.

La déclaration est envoyée par l'action `declarer_tiers`, **après** la création de la
prestation et sans bloquer : elle a une valeur probatoire, pas opérationnelle, et perdre une
réservation payante parce que la colonne manque serait un remède pire que le mal. Un échec est
journalisé en erreur, avec le contenu déclaré.

**Détection des schémas de mise à disposition** — action `signaux_mise_a_disposition` de
`api/bo-action.js`, affichée dans l'onglet Modération. Elle croise le lieu d'intervention des
prestations avec la ville déclarée par le client et ne retient que la **récurrence au même
endroit** (au moins trois fois, sur au moins trois prestations). Aucun signal ne prouve quoi
que ce soit : il désigne les comptes à qui poser une question, première marche de l'escalade
du 10B.4. Les seuils sont volontairement bas et la ville de compte est cherchée dans
`profiles.ville` puis dans `user_metadata` — sans elle, rien n'est signalé plutôt que
d'accuser à tort.

**Article 10B des CGPS — intervention au bénéfice d'un tiers.** La sous-traitance n'est pas
interdite : un client professionnel peut faire exécuter une prestation chez son propre client,
c'est licite. Ce qui est prohibé est le schéma précis — fournir à un tiers un prestataire
nommément désigné ou un volume d'heures, ce tiers exerçant directement sur lui le pouvoir de
direction. Une interdiction plus large aurait bloqué la vraie sous-traitance. Le client
professionnel déclare le bénéficiaire final, le lieu réel, la nature du service vendu et
l'identité de la personne qui organise le travail. L'engagement figure aussi dans le contrat
signé à la commande, seul document opposable aux deux parties.

**Le décalage est un ajustement de prix, jamais une sanction.** La distinction n'est pas
cosmétique : un ajustement automatique décidé par le seul client, appliqué en silence et sans
droit de réponse, constitue un indice de pouvoir disciplinaire — ce qu'une plateforme ne peut
exercer sur un indépendant sans risquer la requalification. Trois règles en découlent, à
préserver : les textes parlent de **durée facturée** et de **temps réalisé**, jamais de
pénalité ni de refus ; le prestataire est **notifié avec les chiffres** et une voie de
contestation (`direction@alane.fr`) ; et le retard **n'alimente ni suspension, ni classement,
ni quota** — vérifié le 05/08/2026, `arrival_delay_minutes` et `delay_status` ne servent qu'au
calcul du prix.

**Un démarrage tardif ne décale pas la fin sans l'accord du client.** Le décalage est
mesuré à deux moments — au pointage d'arrivée (`checkin_mission`) **et** au démarrage
(`start_mission`), le plus défavorable au client étant retenu — au-delà de 15 minutes. Il est
inscrit dans `arrival_delay_minutes` avec `delay_status = "pending"`, et le client est
notifié. Trois issues :

| `delay_status` | Fin de la prestation | Heures facturées |
|---|---|---|
| `approved` | repoussée du retard | heures prévues |
| `rejected` | heure initiale | réduites par `respond_delay` |
| `pending` (sans réponse) | heure initiale | plafonnées à la validation, dans `complete` |

La règle vit à trois endroits qui doivent rester alignés : `api/missions.js` (mesure et
plafonnement), et les deux comptes à rebours — client dans `client-screens.jsx`, prestataire
dans `presta-screens.jsx` — qui s'ancraient auparavant sur `started_at` seul.

**Le passage en `disputed` est borné à 48 h après la fin effective de la prestation**, délai
imposé par les CGPS art. 17.1 (« au-delà de 48 heures sans signalement, la Prestation est
réputée définitivement validée »). Le point de départ est le pointage réel (`started_at`)
s'il existe, sinon l'horaire prévu (`date` + `heure_debut` + `hours`). La règle vit à deux
endroits qui doivent rester alignés : `api/missions.js` (action `dispute`, seul juge) et
`contestationOuverte()` dans `client-screens.jsx`, qui masque le bouton pour ne pas envoyer
l'utilisateur dans un mur. Sans date exploitable, aucun des deux ne bloque.

### Paiement

Le client paie via Stripe. Le webhook `stripe-webhook.js` confirme le paiement et fait passer
la mission en `assigned`. À la validation finale, le prestataire est payé et le cashback client
est crédité.

**Ce que reçoit le prestataire** (décision du 30/07/2026) : `tarif_horaire × heures × jours`,
soit la part horaire seule. Les frais de service restent acquis à ALANE — c'est sa
rémunération, et c'est ce qu'annonce le contrat signé par les deux parties (« Montant net dû
au Prestataire »). Les heures retenues sont les heures réelles (`actual_hours`) quand elles
existent, sinon les heures prévues.

**Côté interface, `montantPrestataire()` dans `presta-screens.jsx` calcule la même chose** et
doit rester alignée : six copies d'une formule privilégiant `montant_total` surévaluaient tous
les montants montrés au prestataire — revenu du mois, fiche de fin de prestation, historique,
totaux et export comptable. Une prestation d'1 h à 15 €/h s'affichait « 19,90 € gagnés ».

Deux chemins émettent ce virement et **doivent rester alignés** : `api/missions.js` (action
`complete`, cas normal) et `api/stripe-webhook.js` (`account.updated`, rattrapage des
virements en attente quand le compte Stripe du prestataire devient opérationnel). Ils
calculaient auparavant deux montants différents, tous deux faux : le premier omettait le
nombre de jours, le second versait `montant_total` frais compris.

**La facture** (`api/invoice.js`) est celle du prestataire au client : son montant HT est
donc le même que ce qui lui est versé, `tarif_horaire × heures × jours`.

Les frais de service **n'entrent pas dans ce total** et ne doivent jamais y entrer : le
prestataire ne les encaisse pas, et les porter sur sa facture gonflerait son chiffre
d'affaires déclaré — donc ses cotisations URSSAF et son plafond de micro-entreprise — sur un
argent qu'il n'a jamais reçu. Ils apparaissent dans un bloc distinct, « Récapitulatif de
votre paiement », qui montre au client la prestation, les frais et le total réglé. Ce bloc
**ne vaut pas facture** pour les frais : leur facturation par ALANE suppose son SIRET et son
adresse, encore absents (voir §8, `VITE_ALANE_SIRET`). Les frais y sont déduits de
`montant_total` moins le TTC de la prestation ; un écart aberrant n'affiche rien plutôt qu'un
chiffre faux, et le journalise.

`missions.invoice_number` conserve le numéro **attribué une seule fois**, à la première
consultation. La facture étant produite à la volée, un numéro était auparavant tiré à chaque
affichage : la même prestation en changeait à chaque ouverture et le compteur grimpait à
chaque coup d'œil, ce qu'interdit l'article 242 nonies A de l'annexe II au CGI (numérotation
continue et sans rupture).

`montant_total` porte **ce que le client a payé**, frais de service inclus. `complete` le
recalcule si la durée réelle diffère de la durée prévue, en conservant les frais d'origine.
Ne jamais y écrire la part du prestataire : la facture, le cashback et les remboursements en
dépendent.

Le client peut aussi alimenter un **portefeuille prépayé**, débité à chaque prestation.

---

## 7. Navigation et URLs

L'application n'utilise pas de bibliothèque de routage. L'écran affiché vient d'un état
`screen` dans `App.jsx`, et [`src/lib/routes.js`](src/lib/routes.js) le reflète dans l'URL,
dans les deux sens.

Principales adresses :

| URL | Écran |
|---|---|
| `/` | Accueil |
| `/auth/signin` | Choix du profil, puis `/auth/signin/client` ou `/auth/signin/provider` |
| `/dashboard` | Espace client |
| `/provider/dashboard` | Espace prestataire |
| `/providers` | Catalogue |
| `/missions` | Historique des prestations |
| `/booking` | Réservation |
| `/settings`, `/notifications`, `/support` | Communs aux deux espaces |
| `/admin` | Backoffice |

Trois gardes s'appliquent automatiquement : sans session sur un écran protégé, on est renvoyé
vers `/auth/signin` ; avec une session sur un écran de connexion, vers son espace ; et un
compte non validé est renvoyé vers l'écran d'attente.

Certains écrans reçoivent un objet en mémoire (le prestataire, la mission). Ils ont une URL et
alimentent l'historique du navigateur, mais **ouvrir leur lien directement ramène à l'accueil** :
un identifiant dans l'URL ne suffit pas encore à les reconstruire. C'est une évolution
identifiée, pas un bug.

---

## 8. Variables d'environnement

Toutes configurées dans Vercel. **Attention** : elles contiennent des espaces invisibles, tout
fichier `/api` doit les nettoyer (CLAUDE.md §1.4).

| Variable | Usage |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé publique — exposée au navigateur |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé privilégiée — `/api` uniquement |
| `VITE_STRIPE_PUBLIC_KEY` | Clé publique Stripe |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Signature du webhook Stripe |
| `VITE_SENTRY_DSN` | Remontée d'erreurs — si absente, Sentry est désactivé |
| `VITE_VAPID_PUBLIC_KEY` | Contrepartie navigateur des clés VAPID, requise pour l'abonnement push |
| `VITE_ALANE_SIRET` | SIRET affiché sur les factures — **vide = ligne masquée** |
| `VITE_ALANE_ADRESSE` | Adresse affichée sur les factures — **vide = ligne masquée** |
| `VITE_ALANE_FORME` | Forme juridique sur les factures (défaut `SAS`) |
| `RESEND_API_KEY` | Envoi d'emails |
| `RESEND_FROM` | Expéditeur — **contient une espace significative**. Le nom affiché doit être `ALANE`, comme le contenu des emails et le domaine : un nom d'expéditeur qui ne correspond ni au domaine ni à la marque est lu comme une tentative d'usurpation par les filtres anti-spam. |
| `RESEND_REPLY_TO` | Adresse de réponse (`support@alane.fr`). Facultative, mais son absence combinée à un expéditeur `no-reply@` pénalise la délivrabilité. Si elle n'est pas renseignée, aucun `Reply-To` n'est envoyé. |
| `ADMIN_EMAIL` | Destinataire des tickets support |
| `BREVO_API_KEY` | SMS et emails de relance |
| `BO_PASSWORD` | Accès au backoffice |
| `BO_SESSION_SECRET` | Signature des sessions backoffice — doit être aléatoire |
| `BO_ALLOWED_IPS` | Filtrage IP du backoffice (optionnel) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notifications push |
| `CRON_SECRET` | Protection des tâches planifiées |
| `APP_URL` | URL publique |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Limitation de débit (optionnel) |

Les variables préfixées `VITE_` sont **embarquées dans le code envoyé au navigateur** : elles
sont publiques par construction. N'y mettre aucun secret. Les autres ne sont lisibles que
depuis `/api`.

À ce jour `VITE_ALANE_SIRET` et `VITE_ALANE_ADRESSE` ne sont pas renseignées : les factures
sont donc émises **sans SIRET ni adresse d'émetteur**, ce qui ne satisfait pas les mentions
légales obligatoires d'une facture française. Les renseigner dans Vercel suffit à les faire
apparaître, aucun changement de code n'est nécessaire.

---

## 9. Développement en local

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint     # doit rester à 0 erreur
npm run build
```

Le développement local nécessite un fichier `.env.local` contenant au minimum
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` et `VITE_STRIPE_PUBLIC_KEY`. Ce fichier est
ignoré par git.

Les fonctions `/api` ne s'exécutent pas avec `npm run dev` — elles n'existent qu'une fois
déployées sur Vercel, ou via la commande `vercel dev`.

Tout push sur `main` déclenche un déploiement en production.
