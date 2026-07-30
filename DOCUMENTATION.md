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

Deux procédures stockées sont appelées depuis le code, et n'existent donc que dans la base :

- `check_prestataire_slot` — vérifie la disponibilité d'un prestataire sur un créneau.
- `increment_cashback` — crédite le cashback de façon atomique.

Comme elles ne sont pas visibles dans les fichiers SQL du dépôt, une modification de leur
signature casse le code sans que rien ne le signale. **La référence, c'est la base.**

**`platform_settings`** — les réglages modifiables depuis le backoffice, stockés en clé/valeur.
Chaque clé est listée avec **l'endroit qui l'applique réellement** : un réglage qu'aucun code
ne lit est un piège, l'administrateur croit agir alors que rien ne change.

| Clé | Appliquée par |
|---|---|
| `cashback_rates` | `api/missions.js` (action `complete`) |
| `subscription_prices` | `api/plans.js`, écrans d'abonnement |
| `plan_limits` | `api/missions.js` — helper `limitePlanMensuelle()` |
| `launch_phase` | badges de l'interface **et** `limitePlanMensuelle()` (10 prestations/mois aux 100 premiers prestataires) |
| `frais_service` | tunnel de réservation, `api/stripe-intent.js` |
| `urgency_surcharge` | écran de secteur (majoration affichée au client) |
| `disabled_sectors` | `api/missions.js` — `get_sector_status` (affichage) et `assign_after_payment` (refus de réservation) |
| `invoice_sequence` | `api/invoice.js` |
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

### Paiement

Le client paie via Stripe. Le webhook `stripe-webhook.js` confirme le paiement et fait passer
la mission en `assigned`. À la validation finale, la commission est retenue, le prestataire est
payé et le cashback client est crédité.

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
