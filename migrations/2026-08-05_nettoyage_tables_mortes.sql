-- ═══════════════════════════════════════════════════════════════════════════
-- Suppression des six tables mortes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI — l'encombrement n'est pas la vraie raison
--
-- Six tables héritées d'une version antérieure du modèle ne sont lues ni écrites
-- par aucune ligne de code : `prestataires`, `metiers`, `disponibilites`,
-- `abonnements`, `bookings`, `mission_responses`. Vérifié le 05/08/2026 par
-- recherche exhaustive dans `api/` et `src/` : zéro référence.
--
-- Elles ont été conservées « par prudence ». C'est l'inverse de la prudence.
--
--   1. Une table morte porte des règles RLS que plus personne ne relit. L'audit du
--      28/07/2026 a précisément trouvé sur `prestataires` une policy `presta_insert`
--      ouverte au rôle `public` : un visiteur non connecté pouvait y créer une fiche.
--      Une table oubliée avec une policy permissive n'encombre pas, elle expose.
--
--   2. Elle égare. La documentation doit déjà avertir qu'il n'existe pas de table
--      `prestations` ; laisser traîner une table `prestataires` inutilisée à côté de
--      `profiles` produit exactement la même confusion, et une session future
--      finira par y écrire.
--
--   3. Elle voyage dans chaque sauvegarde et chaque restauration, sans jamais servir.
--
-- ⚠️ ACTION DESTRUCTRICE — LANCER D'ABORD LA VÉRIFICATION
--
-- Le bloc de vérification ci-dessous doit être exécuté AVANT la suppression. Deux
-- points sont à contrôler, et le second est le plus important : une clé étrangère
-- peut encore pointer vers `prestataires`. Les fichiers SQL du dépôt contiennent
-- d'ailleurs une note à ce sujet — `documents.prestataire_id` a pu référencer
-- `prestataires` au lieu de `auth.users`. Si c'est le cas, NE PAS supprimer sans
-- avoir d'abord corrigé cette clé.
--
-- La suppression est volontairement écrite SANS `CASCADE` : si quelque chose
-- dépend encore de ces tables, l'ordre échoue au lieu de détruire silencieusement
-- ce qui en dépendait.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── VÉRIFICATION 1 : les tables sont-elles vides, et que portent-elles ? ────
--
--    SELECT c.relname                                             AS table_morte,
--           COALESCE(s.n_live_tup, 0)                             AS lignes_estimees,
--           (SELECT count(*) FROM pg_policies p
--             WHERE p.tablename = c.relname)                      AS policies_rls
--    FROM pg_class c
--    LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname
--    WHERE c.relkind = 'r'
--      AND c.relname IN ('prestataires','metiers','disponibilites',
--                        'abonnements','bookings','mission_responses')
--    ORDER BY 1;
--
-- Toutes les lignes doivent afficher 0 dans `lignes_estimees`. Une valeur non nulle
-- impose de regarder le contenu avant toute suppression.


-- ── VÉRIFICATION 2 : quelque chose pointe-t-il encore vers elles ? ──────────
--
--    SELECT conrelid::regclass AS table_qui_reference,
--           conname            AS contrainte,
--           confrelid::regclass AS table_referencee
--    FROM pg_constraint
--    WHERE contype = 'f'
--      AND confrelid::regclass::text IN ('prestataires','metiers','disponibilites',
--                                        'abonnements','bookings','mission_responses');
--
-- Aucune ligne attendue. S'il en apparaît une — typiquement
-- `documents_prestataire_id_fkey` pointant vers `prestataires` — corriger la clé
-- AVANT de supprimer :
--
--    ALTER TABLE documents DROP CONSTRAINT documents_prestataire_id_fkey;
--    ALTER TABLE documents ADD CONSTRAINT documents_prestataire_id_fkey
--      FOREIGN KEY (prestataire_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ── SUPPRESSION — uniquement si les deux vérifications sont bonnes ─────────

DROP TABLE IF EXISTS public.mission_responses;
DROP TABLE IF EXISTS public.bookings;
DROP TABLE IF EXISTS public.abonnements;
DROP TABLE IF EXISTS public.disponibilites;
DROP TABLE IF EXISTS public.metiers;
DROP TABLE IF EXISTS public.prestataires;


-- ═══════════════════════════════════════════════════════════════════════════
-- APRÈS
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT relname FROM pg_class
--    WHERE relkind = 'r'
--      AND relname IN ('prestataires','metiers','disponibilites',
--                      'abonnements','bookings','mission_responses');
--
-- Aucune ligne attendue.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aucun. Une table supprimée ne se restaure que depuis une sauvegarde Supabase.
-- C'est précisément pourquoi la vérification d'emptiness précède la suppression :
-- si les tables sont vides, il n'y a rien à restaurer.
-- ═══════════════════════════════════════════════════════════════════════════
