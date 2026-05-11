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

## Base de données Supabase

### Table `profiles`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | = auth.user.id |
| `role` | text | `"client"` ou `"prestataire"` |
| `prenom` | text | |
| `nom` | text | |
| `status` | text | `"pending"`, `"approved"`, `"rejected"` |
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

Fichier unique ~7100 lignes. Tous les composants sont dans ce fichier.

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

### `api/send-email.js`
Fichier utilitaire présent mais **non utilisé** (les appels Resend sont inlinés). Ne pas réactiver les imports vers ce fichier.

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
