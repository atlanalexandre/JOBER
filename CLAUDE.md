# JOBER — Documentation technique

App React/Vite connectant clients et prestataires. Supabase pour l'auth et la DB, Vercel pour le déploiement et les fonctions serverless.

## Stack

- **Frontend** : React (hooks), Vite, inline styles (pas de Tailwind ni CSS modules)
- **Auth + DB** : Supabase (anon key côté client, service role key côté serveur uniquement)
- **Serverless** : `/api/*.js` — fonctions Vercel (ES modules, `export default async function handler`)
- **Déploiement** : Vercel, branche `main` protégée → toujours passer par une PR

## Variables d'environnement Vercel (toutes requises)

| Variable | Usage |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé publique Supabase (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service Supabase (fonctions serverless uniquement) |
| `RESEND_API_KEY` | Clé API Resend pour les emails |
| `RESEND_FROM` | Adresse d'envoi ex: `JOBER <no-reply@domaine.fr>` (ou `onboarding@resend.dev` pour tests) |
| `ADMIN_EMAIL` | Email de l'admin pour recevoir les tickets support |
| `VITE_STRIPE_PUBLIC_KEY` | Clé publique Stripe (`pk_test_...` ou `pk_live_...`) — exposée côté client |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe — fonctions serverless uniquement |
| `STRIPE_WEBHOOK_SECRET` | Signing secret du webhook Stripe (`whsec_...`) |
| `BO_PASSWORD` | Mot de passe alphanumérique du backoffice admin |
| `BO_SESSION_SECRET` | Secret HMAC pour signer les tokens de session BO (CRITIQUE — doit être aléatoire, ne pas laisser la valeur par défaut) |
| `CRON_SECRET` | Secret optionnel pour protéger `/api/cron-reset-monthly` (header Authorization) |
| `APP_URL` | URL publique de l'app ex: `https://www.alane.fr` — fallback automatique si absent |
| `BREVO_API_KEY` | Clé API Brevo — SMS transactionnels (`missions.js`) et emails (`cron-reset-monthly.js`) |
| `VAPID_PUBLIC_KEY` | Clé publique VAPID pour les push notifications web (`missions.js`) |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID pour les push notifications web (`missions.js`) |
| `BO_ALLOWED_IPS` | IPs autorisées à accéder au backoffice, séparées par des virgules ex: `90.12.34.56,185.20.0.1` — si absent, pas de restriction IP (Edge Middleware `middleware.js`) |

## Base de données Supabase

Le schéma SQL complet est dans `supabase-schema.sql` à la racine du projet.

### Table `profiles`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | = auth.user.id |
| `role` | text | `"client"` ou `"prestataire"` |
| `prenom` | text | |
| `nom` | text | |
| `status` | text | `"pending"`, `"approved"`, `"rejected"` |
| `cashback_balance` | numeric | Solde cashback client, défaut 0 |
| `missions_completed_month` | integer | Missions validées ce mois (reset le 1er via cron) |
| `created_at` | timestamp | |

### Table `missions`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid | FK auth.users |
| `prestataire_id` | uuid | FK auth.users, nullable |
| `sector` | text | |
| `metier` | text | |
| `date` | text | |
| `hours` | numeric | |
| `ville` | text | |
| `tarif_horaire` | numeric | |
| `montant_total` | numeric | Calculé à la validation |
| `status` | text | `"open"`, `"pending_acceptance"`, `"assigned"`, `"completed"`, `"closed"`, `"rejected"`, `"refused"` |
| `stripe_payment_intent` | text | ID PaymentIntent Stripe |
| `created_at` | timestamp | |

### Table `candidatures`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `mission_id` | uuid | FK missions |
| `prestataire_id` | uuid | FK auth.users |
| `message` | text | nullable |
| `status` | text | `"pending"`, `"accepted"`, `"rejected"` |
| `created_at` | timestamp | |

### Table `notifications`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | FK auth.users |
| `type` | text | `"mission"`, `"cashback"`, `"system"` |
| `title` | text | |
| `body` | text | |
| `read` | boolean | défaut false |
| `created_at` | timestamp | |

### Table `documents`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `prestataire_id` | uuid | FK auth.users |
| `type` | text | `"kbis"`, `"rib"`, `"cni"`, `"autre"` |
| `storage_path` | text | Chemin dans le bucket Supabase Storage `documents` |
| `verified` | boolean | Validé par le BO, défaut false |
| `created_at` | timestamp | |

### Table `support_tickets`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `subject` | text | |
| `message` | text | |
| `user_email` | text | nullable |
| `user_name` | text | nullable |
| `user_id` | uuid | nullable |
| `status` | text | `"open"`, `"closed"` |
| `created_at` | timestamp | |

### Données auth (user_metadata — stockées dans Supabase Auth)
Champs stockés dans `user_metadata` lors du signUp :
`role`, `prenom`, `nom`, `telephone`, `type_compte`, `societe_nom`, `kbis`, `rib`

## Architecture App.jsx

Fichier unique ~11500 lignes. Tous les composants sont dans ce fichier.

### Composants clés et ce qu'ils font

**`AuthScreen`** (ligne ~715)
- Gère connexion ET inscription pour client et prestataire selon la prop `role`
- Inscription : prénom, nom, téléphone*, type compte, société+KBIS (si pro), IBAN*, email*, mot de passe*
- Après inscription : `signOut()` puis `onRegister()` — l'utilisateur doit se reconnecter manuellement après validation BO
- Connexion : vérifie que le rôle du compte = rôle de la page, vérifie le status (pending/rejected bloque)
- Checkbox "Rester connecté" : si cochée → `localStorage.setItem("jober_stay_logged_in","1")`, si non → `sessionStorage.setItem("jober_session_active","1")`

**`App` (export default)** (ligne ~6948)
- `handleSplashNext` : vérifie les flags `jober_stay_logged_in` (localStorage) et `jober_session_active` (sessionStorage). Si session Supabase existe mais aucun flag → `signOut()` + écran "role". C'est le mécanisme de déconnexion automatique à la fermeture.
- `onAuthStateChange SIGNED_OUT` : efface les deux flags + redirige vers "role"
- `navigate(to)` : bloque les clients sur `PRESTA_SCREENS` et les prestataires sur `CLIENT_SCREENS`

**`ResponsiveLayout`** (ligne ~6076)
- Mobile (`< 768px`) : `width:"100%"`, PAS de `maxWidth`, PAS de `margin:0 auto`, PAS de `boxShadow` — plein écran sur tous les téléphones
- Desktop : sidebar si connecté, contenu centré avec `maxWidth: 900` (avec sidebar) ou `480` (sans)

**`HomeScreen`** (ligne ~1283)
- Récupère le `prenom` depuis la table `profiles` via Supabase
- Affiche `{userName || "Mon espace"}` — JAMAIS de nom en dur

**`PendingApprovalScreen`** (ligne ~1114)
- Récupère l'email via `supabase.auth.getUser()`
- Affiche l'email de l'utilisateur sous le badge de statut

**`BackofficeDashboard`** (ligne ~4800)
- Tabs : `comptes` → `<BOComptes />`, `support` → `<BOSupport />`, puis KPIs, Secteurs, Utilisateurs, Finance, Modération

**`BOComptes`** (ligne ~4631)
- Appelle `/api/bo-action` action `"list"` qui fusionne `profiles` + `auth.users`
- Affiche : email, téléphone, IBAN, type_compte, societe_nom, KBIS
- Filtres : statut (pending/approved/rejected/all) + rôle (all/client/prestataire)
- Actions : approuver, refuser, supprimer

**`BOSupport`** (ligne ~4741)
- Appelle `/api/bo-action` action `"list_tickets"`
- Affiche les tickets support avec bouton "Fermer"

## Fonctions serverless (/api)

### `api/bo-action.js`
Actions disponibles :
- `list` : fusionne profiles + auth users, retourne email/rib/kbis/societe_nom/type_compte/telephone
- `approve` : PATCH status="approved" + email Resend à l'utilisateur
- `reject` : PATCH status="rejected" + email Resend à l'utilisateur
- `delete` : supprime profile + supprime auth user (admin API)
- `list_tickets` : retourne tous les tickets support
- `close_ticket` : PATCH status="closed" sur un ticket

**IMPORTANT** : Le `fetch` Resend est inliné directement dans ce fichier. Ne pas utiliser d'import relatif vers un fichier utilitaire — les imports relatifs ne fonctionnent pas de manière fiable dans les fonctions serverless Vercel.

### `api/support.js`
- Sauvegarde le ticket dans `support_tickets` (Supabase)
- Envoie email à `ADMIN_EMAIL` via Resend (fetch inliné)
- Logs `console.log` présents pour diagnostic (visibles dans Vercel → Functions → Logs)

### `api/missions.js`
Actions : `list_open`, `list_client`, `list_presta`, `postuler`, `accept`, `reject_candidature`, `complete`, `cancel`, `get_candidatures`
- Gère le cycle de vie complet des missions + candidatures + notifications + cashback

### `api/stripe-intent.js`
- Crée un `PaymentIntent` Stripe via REST, retourne `{ clientSecret, intentId }`
- Montant en euros converti en centimes (× 100)

### `api/stripe-webhook.js`
- Vérifie la signature HMAC-SHA256 (`STRIPE_WEBHOOK_SECRET`)
- Sur `payment_intent.succeeded` : PATCH `missions.stripe_payment_intent` + `status="assigned"`
- `export const config = { api: { bodyParser: false } }` — obligatoire pour lire le raw body

### `api/bo-verify-pin.js`
- Vérifie le mot de passe BO contre `BO_PASSWORD` (env)
- Retourne un token HMAC signé valable 24h (signé avec `BO_SESSION_SECRET`)
- **SECURITY** : `BO_SESSION_SECRET` doit être défini dans Vercel — la valeur par défaut est publique sur GitHub

### `api/welcome-email.js`
- Envoie un email de bienvenue après inscription via Resend
- Appelé depuis le frontend juste avant `signOut()` post-inscription

### `api/cron-reset-monthly.js`
- Mode par défaut : remet `missions_completed_month` à 0 sur tous les profiles (1er de chaque mois)
- Mode `?action=reminders` : envoie des emails de rappel (via Resend) pour les missions assignées le lendemain
- Protégé par header `Authorization: Bearer <CRON_SECRET>` si la variable est définie
- **NOTE** : les crons Vercel nécessitent le plan Pro — sur Hobby, les crons ne s'exécutent pas automatiquement

### `api/verify-docs.js`
- Valide le format IBAN (algorithme MOD-97)

## Règles importantes à ne pas casser

### Auth et sécurité
- Ne jamais utiliser `SUPABASE_SERVICE_ROLE_KEY` côté client (uniquement dans `/api/*.js`)
- La vérification `!profile?.role || profile.role !== role` dans `handleLogin` est intentionnelle — les deux conditions sont nécessaires (un role null doit aussi bloquer)
- Ne jamais supprimer le `await supabase.auth.signOut()` après l'inscription

### Session
- Les flags `jober_stay_logged_in` et `jober_session_active` sont le mécanisme de "Rester connecté". Ne pas les renommer ni supprimer la logique dans `handleSplashNext`
- `sessionStorage` est vidé automatiquement à la fermeture du navigateur — c'est voulu

### Layout
- `ResponsiveLayout` mobile doit rester `width:"100%"` sans `maxWidth` ni `margin:0 auto`
- `index.css` : `html, body { background: #050E20 }` et `#root { width: 100% }` — ne pas réintroduire de contraintes de largeur

### Emails
- Les appels `fetch("https://api.resend.com/emails", ...)` doivent rester inlinés dans chaque fichier API
- Ne pas réimporter depuis `./send-email.js`

### Navigation cross-role
- `PRESTA_SCREENS` et `CLIENT_SCREENS` dans `App` définissent la séparation des espaces
- La double vérification dans `navigate()` + dans les `onLogin` callbacks est intentionnelle

## Flux utilisateur complet

```
Splash → "Commencer" → handleSplashNext
  → session + flag présent → home/p_home
  → session sans flag → signOut → "role"
  → pas de session → "role"

"role" → choix client/prestataire
  → "auth_client" ou "auth_presta" → AuthScreen

AuthScreen (connexion)
  → vérif rôle + status → onLogin() → home/p_home

AuthScreen (inscription)
  → signUp + upsert profile + signOut → onRegister() → "pending_approval"

BO admin
  → approuve → status="approved" + email à l'utilisateur
  → l'utilisateur peut maintenant se connecter normalement
```
