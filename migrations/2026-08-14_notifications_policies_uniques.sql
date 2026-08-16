-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications : une règle par opération, au lieu de sept qui se recouvrent
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ÉTAT CONSTATÉ LE 14/08/2026, après la fermeture de S-06
--
--   notifications_own              ALL     public         user_id = auth.uid()
--   Users read own notifications   SELECT  public         auth.uid() = user_id
--   notifs_own_select              SELECT  public         auth.uid() = user_id
--   notifs_select                  SELECT  authenticated  auth.uid() = user_id
--   Users update own notifications UPDATE  public         auth.uid() = user_id
--   notifs_own_update              UPDATE  public         auth.uid() = user_id
--   notifs_update                  UPDATE  authenticated  auth.uid() = user_id
--
-- Sept règles pour trois opérations, toutes équivalentes, empilées au fil des
-- correctifs. Les policies se cumulent en OU : la plus permissive l'emporte
-- toujours. Sept endroits où une erreur peut se cacher, et que plus personne
-- ne relit — c'est exactement ce que l'audit de juillet reprochait aux tables
-- mortes : « une policy oubliée n'encombre pas, elle expose ».
--
-- CE QUI EST DÉJÀ SÛR, ET QUI NE CHANGE PAS
--
-- `notifications_own` porte cmd = ALL, donc INSERT compris. Son `with_check`
-- est nul, mais PostgreSQL retombe alors sur l'expression `USING` : une
-- insertion n'est acceptée que si `user_id = auth.uid()`. Personne ne peut donc
-- créer une notification destinée à quelqu'un d'autre. S-06 est bien clos.
--
-- CE QUE CETTE MIGRATION RESSERRE
--
-- 1. Plus AUCUNE policy d'insertion. Toutes les notifications sont créées par
--    /api en service role, qui contourne la RLS : le navigateur n'a jamais
--    besoin d'insérer. Se créer des notifications à soi-même n'a pas d'usage
--    légitime, seulement celui de remplir la table.
--
-- 2. Plus aucune policy de suppression. Vérifié dans le code : le front ne
--    supprime aucune notification, il les marque lues.
--
-- 3. `TO authenticated` au lieu de `TO public`. Le rôle `public` inclut `anon`.
--    La condition les écartait déjà — `auth.uid()` vaut NULL pour un visiteur,
--    et `NULL = user_id` n'est jamais vrai — mais une règle doit dire ce
--    qu'elle veut, pas compter sur une comparaison qui échoue.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "notifications_own"              ON public.notifications;
DROP POLICY IF EXISTS "Users read own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "notifs_own_select"              ON public.notifications;
DROP POLICY IF EXISTS "notifs_select"                  ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifs_own_update"              ON public.notifications;
DROP POLICY IF EXISTS "notifs_update"                  ON public.notifications;

-- Chacun lit ses notifications, et rien d'autre.
CREATE POLICY notifications_lecture
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Chacun marque les siennes comme lues. `WITH CHECK` est explicite : sans lui,
-- un UPDATE pourrait réattribuer la ligne à un autre utilisateur.
CREATE POLICY notifications_marquage
  ON public.notifications FOR UPDATE
  TO authenticated
  USING      (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Deux règles, et deux seulement :
--
--    SELECT policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'notifications'
--    ORDER BY cmd;
--    -- attendu : notifications_lecture (SELECT) et notifications_marquage (UPDATE),
--    --           toutes deux sur {authenticated}. Aucune ligne INSERT ni DELETE.
--
-- 2. La RLS est bien active — sans elle, les règles ne servent à rien :
--
--    SELECT rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename = 'notifications';
--    -- attendu : true
--
-- 3. À FAIRE APRÈS LE DÉPLOIEMENT — les notifications doivent continuer
--    d'arriver. Elles passent toutes par /api en service role, donc hors RLS.
--    Le contrôle concret : commander une prestation et vérifier que le
--    prestataire la reçoit, puis que la cloche se vide quand on la consulte.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Si des notifications légitimes cessaient d'apparaître, c'est que du code lit
-- ou écrit autrement que prévu. Rouvrir le strict nécessaire, jamais `ALL` :
--
--    CREATE POLICY notifications_own ON public.notifications
--      FOR ALL TO authenticated
--      USING (user_id = (SELECT auth.uid()));
--
-- puis chercher le chemin fautif avant de refermer.
-- ═══════════════════════════════════════════════════════════════════════════
