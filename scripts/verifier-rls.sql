-- ═══════════════════════════════════════════════════════════════════════════
-- Diagnostic des règles de sécurité (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI CE FICHIER
--
-- Aucun contrôle du dépôt ne peut voir les policies : elles vivent dans la
-- base, pas dans le code. C'est la seule zone de la plateforme qu'un audit du
-- dépôt ne couvre pas — et c'est celle qui décide qui lit quoi.
--
-- Le précédent est documenté : six tables mortes portaient à elles seules
-- vingt-cinq règles que plus personne ne relisait, dont une ouverte au rôle
-- `public`. Une table oubliée avec une policy permissive n'encombre pas :
-- elle expose.
--
-- À passer dans l'éditeur SQL Supabase, et à relire ligne par ligne.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Tables SANS RLS ─────────────────────────────────────────────────────
--
-- Le plus grave, et le plus simple à voir. Sans RLS, la clé anonyme du
-- navigateur lit et écrit tout.
--
-- ATTENDU : 0 ligne.

SELECT c.relname AS table_sans_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY 1;


-- ── 2. Policies ouvertes à `public` ou `anon` ──────────────────────────────
--
-- `public` en PostgreSQL ne veut pas dire « visible de tous » mais « tous les
-- rôles », y compris `anon` — la clé embarquée dans le navigateur.
--
-- Chaque ligne doit être justifiable : une lecture de catalogue, oui ; une
-- écriture, presque jamais.

SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
ORDER BY tablename, cmd, policyname;


-- ── 3. Policies sans condition ─────────────────────────────────────────────
--
-- `USING (true)` ou `WITH CHECK (true)` : la règle existe, mais elle
-- n'exclut personne. Le projet en a déjà connu une, laissée des semaines pour
-- contourner un bug de session.
--
-- ATTENDU : 0 ligne, sauf justification écrite dans DOCUMENTATION.md §5.

SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (COALESCE(qual, '') IN ('true', '(true)') OR COALESCE(with_check, '') IN ('true', '(true)'))
ORDER BY tablename, policyname;


-- ── 4. Écritures autorisées sur les tables sensibles ───────────────────────
--
-- Toute écriture depuis le navigateur sur ces tables doit être une exception
-- réfléchie : l'argent, les statuts et les notifications passent par /api.

SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  AND tablename IN ('missions', 'profiles', 'notifications', 'messages',
                    'documents', 'creances_prestataires', 'platform_settings',
                    'bo_logs', 'account_blacklist', 'tracking_positions')
ORDER BY tablename, cmd, policyname;


-- ── 5. La messagerie ───────────────────────────────────────────────────────
--
-- `messages` n'a pas de modèle de participants : l'appartenance à une
-- conversation se prouve par une sous-chaîne de `conversation_key`. C'est le
-- point ouvert le plus ancien du projet.
--
-- Lire ces règles en entier : si l'une d'elles compare autrement qu'en
-- extrayant les deux identifiants de la clé, elle est probablement fausse.

SELECT policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'messages'
ORDER BY cmd, policyname;


-- ── 6. Tables sans aucune policy alors que la RLS est active ───────────────
--
-- RLS active + zéro policy = table inaccessible depuis le navigateur. Ce n'est
-- pas une faille, c'est un blocage : si l'application prétend lire cette
-- table, elle affiche une liste vide sans dire pourquoi.

SELECT c.relname AS table_verrouillee
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
  )
ORDER BY 1;


-- ── 7. Tables vides et oubliées ────────────────────────────────────────────
--
-- Le précédent des six tables mortes. Une table vide qui porte encore des
-- policies est une surface d'attaque que personne ne relit.
--
-- ⚠️ NE PAS SE FIER À `pg_class.reltuples` : PostgreSQL y écrit -1 tant que la
-- table n'a jamais été analysée. Une table jamais analysée n'est pas une table
-- vide, et la première version de ce contrôle confondait les deux — elle
-- aurait fait supprimer des tables pleines. Le compte est donc réel.
--
-- `query_to_xml` permet de compter les lignes de chaque table sans écrire une
-- requête par table.

SELECT c.relname                                        AS table_,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname),
                           false, true, '')))[1]::text::bigint AS lignes,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY lignes, policies DESC, 1;

-- Lecture du résultat :
--
--   lignes = 0 ET policies > 0  → table morte qui porte encore des règles.
--                                 C'est le cas des six tables supprimées le
--                                 05/08/2026, qui portaient 25 policies dont
--                                 une ouverte à `public`.
--
--   policies = 0                → table réservée au serveur. Ce n'est une
--                                 anomalie QUE si `src/` y accède : l'écran
--                                 afficherait alors une liste vide sans dire
--                                 pourquoi. Vérifié le 17/08/2026 pour
--                                 account_blacklist, bo_logs, bo_rate_limits,
--                                 booking_drafts, factures_archives et
--                                 wallet_topups : aucun accès depuis `src/`.
