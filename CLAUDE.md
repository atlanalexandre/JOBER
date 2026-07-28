# CLAUDE.md — Règles de travail sur JOBER / ALANE

Ce fichier est lu automatiquement par Claude Code à chaque session. Il définit **comment**
travailler sur ce projet. La description du projet lui-même est dans [DOCUMENTATION.md](DOCUMENTATION.md).

> **Contexte important** : le propriétaire du projet (Alexandre) n'est pas développeur.
> Les demandes arrivent en langage courant. Ta responsabilité est donc double : faire ce qui
> est demandé, **et** protéger le projet des dégâts qu'une demande imprécise pourrait causer.
> Quand une demande est ambiguë ou risquée, pose la question avant d'agir.

---

## 1. Les règles non négociables

Ces règles viennent toutes de pannes réelles survenues en production. Chacune a coûté des
heures de diagnostic. Ne les enfreins pas, même si ça paraît plus simple sur le moment.

### 1.1 Ne jamais stocker de données volumineuses dans `user_metadata`

`user_metadata` (Supabase Auth) est **encodé dans le jeton d'authentification**, envoyé en
en-tête HTTP à chaque requête. Cloudflare plafonne les en-têtes à 16 Ko.

Une photo de profil y avait été stockée en base64 : 60 Ko. Résultat, **toutes** les requêtes
du compte étaient rejetées avec une erreur 520, y compris la déconnexion. Le compte était
totalement inutilisable, et l'erreur affichée dans la console parlait de CORS — sans aucun
rapport avec la vraie cause.

- `user_metadata` : uniquement des valeurs courtes (nom, ville, préférences). Vise < 2 Ko.
- Fichiers, images, documents → **Supabase Storage**, et on ne garde que le chemin.
- Une photo de profil va dans `profiles.avatar_url`, jamais dans `user_metadata`.

### 1.2 Ne jamais avaler une erreur en silence

C'est le défaut le plus coûteux de ce projet. Un `catch {}` vide transforme une panne franche
en comportement dégradé invisible, impossible à diagnostiquer.

Exemples réels : la suppression de compte ne supprimait aucun fichier (mauvaise casse dans un
nom de dossier, échec avalé) ; une liste restait vide parce qu'elle interrogeait une table
inexistante ; l'envoi d'un document échouait en laissant le bouton bloqué sur « Envoi… ».

```js
// ❌ jamais
try { await faireQuelqueChose(); } catch {}

// ✅ toujours : soit on remonte à l'utilisateur, soit on journalise avec le contexte
try {
  await faireQuelqueChose();
} catch (err) {
  console.error("[contexte] échec de X :", err.message);
  throw new Error("Message clair pour l'utilisateur");
}
```

Si un `catch` doit vraiment rester vide (cas légitime : `localStorage` indisponible en
navigation privée), **écris un commentaire expliquant pourquoi**. Sinon eslint le refuse.

### 1.3 Ne jamais appeler Supabase depuis `onAuthStateChange`

supabase-js détient un verrou pendant l'exécution de ce callback. Toute requête lancée
dedans part **sans en-tête d'authentification**, donc en rôle anonyme, et la RLS la rejette.

C'était la cause de la déconnexion à chaque rechargement de page.

```js
// ✅ sortir du callback
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "INITIAL_SESSION" && session?.user) {
    setTimeout(() => { supabase.from("profiles").select(/* … */); }, 0);
  }
});
```

### 1.4 Toujours nettoyer les variables d'environnement

Les variables Vercel de ce projet contiennent des espaces invisibles (collés depuis un iPad).
Un en-tête HTTP ne peut pas contenir de retour à la ligne : `fetch` lève une exception **avant
même d'émettre la requête**. Symptômes constatés : 401 sur `/api/missions`, 500 sur
`/api/prestataires`, le tout sans message exploitable.

```js
// ✅ dans TOUT nouveau fichier /api
const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
```

Exception : `RESEND_FROM` et `ADMIN_EMAIL` contiennent des espaces **significatifs**
(`JOBER <no-reply@…>`). Ne jamais leur appliquer ce nettoyage.

### 1.5 La clé service role ne sort jamais du dossier `/api`

`SUPABASE_SERVICE_ROLE_KEY` contourne toute la sécurité RLS. Elle n'apparaît que dans
`/api/*.js` (fonctions serverless). Jamais dans `src/`, jamais dans un composant, jamais
dans une variable préfixée `VITE_` (qui serait embarquée dans le bundle public).

### 1.6 Avant d'ajouter une contrainte, relever TOUTES les valeurs utilisées

Une contrainte `CHECK` sur `documents.type` avait été ajoutée en oubliant `photo`,
`diplomes` et `tva`. Conséquence : la photo de profil montait bien dans le storage, mais son
enregistrement en base était rejeté — sans message.

Avant tout `CHECK` ou `NOT NULL` : cherche dans `src/` **et** `api/` toutes les valeurs
réellement écrites. Une contrainte trop étroite casse la production silencieusement.

### 1.7 Une modification de schéma passe par une migration

Utilise l'outil de migration Supabase, jamais des modifications manuelles depuis le dashboard.
Les migrations sont tracées et relisables ; une modification manuelle est invisible et
irrattrapable. Nomme-les en français, explicitement :
`secu_fermer_documents_presta_insert`, `perf_index_fk_et_nettoyage`.

---

## 2. Comment on travaille

### 2.1 Toujours vérifier avant d'affirmer

Ne dis jamais « c'est corrigé » sans preuve. Les vérifications attendues, selon le cas :

- **Base** : rejouer une requête qui confirme l'état attendu.
- **API** : appeler l'endpoint et lire le code HTTP réel.
- **Front** : lancer le serveur local et regarder la page, ou vérifier que le bundle déployé
  contient bien la correction.
- **Déploiement** : attendre que Vercel passe au vert, et le confirmer.

Si une vérification est impossible, **dis-le explicitement** plutôt que de laisser croire que
c'est validé.

### 2.2 Diagnostiquer avant de corriger

Ce projet a beaucoup souffert de correctifs appliqués sur des symptômes. Un exemple : une
policy de sécurité a été ouverte en grand (`WITH CHECK (true)`) pour contourner un bug de
session — la faille est restée des semaines, et le vrai bug n'était pas corrigé.

Face à un symptôme : cherche la cause, prouve-la, corrige la cause. Si tu dois contourner
temporairement, écris-le en commentaire avec la raison et ce qu'il faudra faire ensuite.

### 2.3 Ne pas élargir le périmètre sans le dire

Si tu repères un problème en dehors de la demande, deux cas :
- **c'est bloquant ou dangereux** → corrige-le, et signale-le clairement dans ta réponse ;
- **sinon** → signale-le, et laisse Alexandre décider.

Ne fais jamais de refonte non demandée.

### 2.4 Actions destructrices : demander avant

Suppression de tables, de colonnes, de données, de fichiers du storage, ou toute modification
du schéma `auth` : **demander confirmation**, même si ça semble découler de la demande.

Sauvegarde d'abord quand c'est possible (exemple : copier une photo dans `profiles.avatar_url`
avant de la retirer de `user_metadata`).

### 2.5 Git et déploiement

- Une branche par sujet, jamais de commit direct sur `main` sans raison explicite.
- Messages de commit **en français**, expliquant le *pourquoi* et pas seulement le *quoi*.
- Un push sur `main` déclenche un déploiement en production. Vérifie que la CI est verte.
- `npm run lint` doit rester à **0 erreur**. La CI a été rouge en permanence pendant des
  semaines, ce qui l'a rendue inutile : ne recommence pas.

### 2.6 Répondre à un non-développeur

- Explique en français courant ce que tu as fait et pourquoi c'était cassé.
- Donne le résultat concret (« la photo s'affiche à nouveau »), pas seulement la technique.
- Quand une action lui revient (réglage dans un dashboard), donne le chemin exact des clics.
- Signale les décisions qui lui appartiennent (produit, argent, données personnelles).

---

## 3. Conventions de code

### 3.1 Style

- React avec hooks, **styles en ligne** (pas de Tailwind, pas de CSS modules).
- Pas de TypeScript. Pas de nouvelle dépendance sans validation préalable.
- Nommage et commentaires **en français**, comme le reste du projet.
- On suit le style du fichier qu'on modifie, même s'il diffère de ses préférences.

### 3.2 Ajouter un écran

L'application n'a pas de routeur : l'écran affiché vient d'un état `screen` dans `App.jsx`,
et [`src/lib/routes.js`](src/lib/routes.js) le reflète dans l'URL.

Pour ajouter un écran, il faut **toujours** :
1. ajouter l'entrée dans `SCREEN_TO_PATH` (URL en anglais, minuscules, tirets) ;
2. le classer : `PUBLIC_SCREENS` s'il est accessible sans compte, `NEEDS_DATA` s'il reçoit un
   objet via `navigate(to, data)` ;
3. l'ajouter à `PRESTA_SCREENS` ou `CLIENT_SCREENS` dans `App.jsx` s'il est réservé à un rôle.

Oublier l'étape 3 crée une faille : l'URL contourne le contrôle de rôle.

### 3.3 Requêtes vers la base

- Depuis le front : `supabase.from(...)` avec la clé anonyme. **La RLS est la sécurité.**
- Depuis `/api` : `fetch` sur l'API REST avec la clé service role, après vérification de
  l'appelant via `verifyUser` (voir `api/_auth.js`).
- Toute opération sensible (argent, statut de mission, cashback) passe **obligatoirement**
  par `/api`. Jamais directement depuis le front.

### 3.4 Documents et fichiers

- Bucket unique : **`Documents`** — avec une majuscule, la casse compte. Une erreur de casse
  a empêché toute suppression de fichier pendant des mois.
- Chemin : `{user_id}/{type}` — **nom stable, sans horodatage ni extension**. Un remplacement
  écrase l'ancien fichier au lieu d'en accumuler.
- En base : un seul document par `(prestataire_id, type)`, garanti par une contrainte unique.
  Les écritures utilisent donc `upsert` avec `onConflict: "prestataire_id,type"`.
- Le bucket est **privé** : la lecture passe par une URL signée générée côté `/api`.

---

## 4. Pièges connus de ce projet

| Piège | Ce qu'il faut retenir |
|---|---|
| Bucket `Documents` | Majuscule obligatoire |
| Table des prestations | C'est `missions`, il n'existe pas de table `prestations` |
| Variables Vercel | Contiennent des espaces invisibles, toujours les nettoyer |
| `user_metadata` | Encodé dans le jeton, limite ~16 Ko |
| `onAuthStateChange` | Aucun appel Supabase à l'intérieur |
| `platform_settings` | Lecture restreinte par clé ; une clé absente provoque une erreur 406 |
| Réécriture Vercel | La destination doit être `/` et non `/index.html` (à cause de `cleanUrls`) |
| CI eslint | Doit rester à 0 erreur |

---

## 5. Ce qui reste ouvert

Voir [AUDIT-2026-07-28.md](AUDIT-2026-07-28.md) pour l'état détaillé. En résumé :

- **S-06** — l'insertion de notifications reste ouverte aux comptes connectés. Il faut router
  trois appels du front vers `/api` avant de fermer la policy.
- **Six tables mortes** conservées volontairement (`prestataires`, `metiers`, `disponibilites`,
  `abonnements`, `bookings`, `mission_responses`) : à zéro ligne, jamais lues par le code.
  **Ne pas s'appuyer dessus** pour de nouveaux développements.
- **`messages`** n'a pas de vrai modèle de conversation : les participants sont extraits d'une
  chaîne de caractères, y compris dans les règles de sécurité. À refondre avant montée en charge.
- **Trois fichiers de schéma SQL** divergents à la racine (`supabase-schema.sql`,
  `supabase_schema.sql`, `supabase_migration.sql`). Aucun ne fait autorité : **la référence,
  c'est la base**.
