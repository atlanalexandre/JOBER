-- ═══════════════════════════════════════════════════════════════════════════
-- Avis : refermer la lecture publique sur les seules colonnes affichées
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le diagnostic RLS du 17/08/2026 a remonté deux règles sur `ratings` :
--
--   ratings | ratings are readable by all | SELECT | {public} | true
--   ratings | ratings_read                | SELECT | {public} | true
--
-- Deux fois la même chose, et toutes deux sans condition. `public` en
-- PostgreSQL ne veut pas dire « visible de tous » mais « tous les rôles », y
-- compris `anon` — la clé embarquée dans le navigateur, que n'importe qui peut
-- lire dans le code de la page.
--
-- CE QUE ÇA EXPOSAIT
--
-- La table entière, sans filtre, à qui la demande — sans compte :
--
--   • `reviewer_id`  — qui a écrit l'avis
--   • `mission_id`   — sur quelle prestation
--   • `reviewee_provider_id` et `reviewee_name` — sur qui
--   • `comment`      — le texte
--
-- Les trois premiers réunis dressent la carte de QUI a travaillé avec QUI, et
-- quand. Ce sont des données personnelles, et rien dans l'application n'en a
-- besoin : l'écran de profil n'affiche que la note, la date et le commentaire.
-- `reviewer_id` était sélectionné par le front sans jamais être utilisé.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- La lecture publique reste — les avis doivent être visibles d'un visiteur non
-- connecté, c'est leur raison d'être. Mais elle est ramenée aux colonnes
-- réellement affichées, par des droits de colonne : la RLS décide QUELLES
-- LIGNES sont lisibles, les GRANT décident QUELLES COLONNES.
--
-- `reviewer_id` reste donc invisible. La seule lecture qui en avait besoin —
-- « quelles prestations ai-je déjà notées ? » — est passée par /api, où le
-- serveur filtre pour l'appelant sans rien exposer.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Une seule règle, pas deux. Deux policies identiques, c'est une que
--    personne ne relit — et le projet a déjà appris ce que coûtent les règles
--    oubliées.
DROP POLICY IF EXISTS "ratings are readable by all" ON public.ratings;

-- 2. La lecture publique se limite aux colonnes affichées.
--
--    L'ordre compte : on retire tout, puis on rend le nécessaire.
REVOKE SELECT ON public.ratings FROM anon, authenticated;

GRANT SELECT (id, reviewee_provider_id, rating, comment, created_at, tags)
  ON public.ratings TO anon, authenticated;

-- `reviewer_id`, `mission_id` et `reviewee_name` ne sont volontairement PAS
-- rendus : le premier identifie l'auteur, le deuxième relie l'avis à une
-- prestation précise, le troisième duplique une information déjà lisible sur
-- le profil. Les écritures et les lectures qui en ont besoin passent par /api,
-- en service role.


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une seule règle doit rester :
--
--    SELECT policyname, cmd, roles::text, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'ratings';
--    -- attendu : 1 ligne (ratings_read)
--
-- Les colonnes réellement lisibles par le navigateur :
--
--    SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name) AS colonnes
--    FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'ratings'
--      AND privilege_type = 'SELECT' AND grantee IN ('anon', 'authenticated')
--    GROUP BY grantee;
--    -- attendu : comment, created_at, id, rating, reviewee_provider_id, tags
--    -- et SURTOUT : ni reviewer_id, ni mission_id, ni reviewee_name
--
-- Contrôle final, depuis l'application : ouvrir la fiche d'un prestataire.
-- Les avis doivent s'afficher normalement. Si la liste est vide, un GRANT
-- manque — la colonne concernée apparaîtra dans la console du navigateur.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    GRANT SELECT ON public.ratings TO anon, authenticated;
--
-- Cela rouvre la table entière, `reviewer_id` compris. À ne faire que le temps
-- de diagnostiquer, jamais durablement.
-- ═══════════════════════════════════════════════════════════════════════════
