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

**`platform_settings`** — les réglages modifiables depuis le backoffice, stockés en clé/valeur :
`commission_rate`, `cashback_rates`, `subscription_prices`, `plan_limits`, `frais_service`,
`urgency_surcharge`, `launch_phase`, `disabled_sectors`, `sector_min_prestataires`,
`invoice_sequence`.

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

Toutes suivent le même schéma : vérifier l'appelant avec `verifyUser`, contrôler ses droits,
puis agir en service role.

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
| `RESEND_FROM` | Expéditeur — **contient une espace significative** |
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
