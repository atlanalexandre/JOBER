-- ═══════════════════════════════════════════════════════════════════════════
-- Messagerie : une règle par opération, et aucune suppression
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIQUÉE EN BASE LE 16/08/2026. Ce fichier consigne l'état obtenu.
--
-- ── ÉTAT PRÉCÉDENT ─────────────────────────────────────────────────────────
--
--   messages_insert  INSERT  public  with_check: sender_id = auth.uid()
--   messages_write   INSERT  public  with_check: auth.uid() = sender_id
--   messages_read    SELECT  public  qual: sender_id = auth.uid()
--                                          OR conversation_key LIKE '%'||auth.uid()||'%'
--   messages_select  SELECT  public  qual: sender_id = auth.uid()
--                                          OR split_part(conversation_key,'_',1) = auth.uid()
--                                          OR split_part(conversation_key,'_',2) = auth.uid()
--   messages_delete  DELETE  public  qual: sender_id = auth.uid()
--
-- Cinq règles pour trois opérations, dont trois défauts :
--
-- 1. LA SUPPRESSION. L'article 17.1 des CGPS fait des échanges un ÉLÉMENT DE
--    PREUVE en cas de litige. Chaque expéditeur pouvait pourtant effacer les
--    siens — y compris pendant un litige, y compris celui qu'on lui opposait.
--    Une preuve qu'une partie peut effacer unilatéralement n'en est pas une.
--    Aucun écran ne le proposait : le droit existait en base sans porte pour
--    l'exercer. Invisible à l'usage, disponible à qui appelle l'API.
--
-- 2. LA CLÉ DE CONVERSATION N'ÉTAIT PAS CONTRÔLÉE À L'INSERTION. Le `with_check`
--    vérifiait qui signe, jamais où l'on écrit. N'importe qui pouvait donc
--    poster dans le fil privé de deux autres personnes. L'expéditeur restait
--    correctement identifié — pas d'usurpation — mais le message s'affichait au
--    milieu de leur échange, dans une conversation qui sert de preuve.
--
-- 3. UNE RÈGLE MORTE. `messages_select` découpait la clé sur des underscores,
--    alors que le format est `prov<uuid>-user<uuid>` — avec des tirets. Ces
--    conditions ne correspondaient donc jamais à rien : vestige d'un ancien
--    format, laissé en place. Les policies se cumulant en OU, c'est toujours la
--    plus permissive qui compte, et personne ne relit celles qui ne servent plus.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_write"  ON public.messages;
DROP POLICY IF EXISTS "messages_read"   ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_delete" ON public.messages;

-- On écrit sous son propre nom, ET seulement dans une conversation dont on fait
-- partie. La seconde condition manquait.
CREATE POLICY messages_ecriture
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND conversation_key LIKE '%' || (SELECT auth.uid())::text || '%'
  );

-- On lit les conversations dont on fait partie.
CREATE POLICY messages_lecture
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    sender_id = (SELECT auth.uid())
    OR conversation_key LIKE '%' || (SELECT auth.uid())::text || '%'
  );

-- Aucune policy DELETE : un message ne se supprime pas. La suppression reste
-- possible par /api en service role — modération motivée, demande d'effacement
-- examinée au titre de l'article 14 — et laisse alors une trace.

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'messages' ORDER BY cmd;
--    -- attendu : messages_ecriture (INSERT) et messages_lecture (SELECT).
--    --           Aucune DELETE.
--
-- CONTRÔLE FONCTIONNEL — le seul qui compte vraiment. La clé de conversation
-- s'écrit `prov<id du prestataire>-user<id du client>` : elle contient donc
-- l'identifiant des deux participants, et chacun retrouve le sien. Mais c'est à
-- vérifier sur le terrain, pas sur la lecture du code :
--
--   1. côté client, ouvrir une conversation avec un prestataire et envoyer un
--      message ;
--   2. côté prestataire, vérifier qu'il le reçoit et peut répondre ;
--   3. côté client, vérifier que la réponse arrive.
--
-- Si l'envoi échoue, c'est que le format de clé diffère de celui décrit ici.
-- Rouvrir alors temporairement, et relever le format réel :
--
--   CREATE POLICY messages_ecriture_large ON public.messages
--     FOR INSERT TO authenticated
--     WITH CHECK (sender_id = (SELECT auth.uid()));
--
--   SELECT DISTINCT conversation_key FROM messages LIMIT 5;
--
-- ═══════════════════════════════════════════════════════════════════════════
