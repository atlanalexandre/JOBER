-- ═══════════════════════════════════════════════════════════════════════════
-- Messagerie : un message ne se supprime pas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'article 17.1 des CGPS fait des échanges de la messagerie un ÉLÉMENT DE
-- PREUVE en cas de litige : « les parties fournissent leurs observations et
-- éléments de preuve (échanges via la messagerie de la Plateforme...) ».
--
-- Or la policy `messages_delete` autorisait chaque expéditeur à supprimer ses
-- propres messages — y compris pendant un litige en cours, y compris le message
-- qui lui était opposé. Une preuve qu'une partie peut effacer unilatéralement
-- n'en est pas une.
--
-- Aucun écran ne proposait cette suppression : le droit existait en base, sans
-- porte pour l'exercer. C'est le pire des cas — invisible à l'usage, disponible
-- à qui sait appeler l'API directement.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--
-- Elle ne touche ni à la lecture, ni à l'écriture. Le point relevé par ailleurs
-- — la clé de conversation n'est pas contrôlée à l'insertion, ce qui permet
-- d'écrire dans le fil de deux autres personnes — reste ouvert, sur décision.
--
-- CE QUI RESTE POSSIBLE
--
-- La suppression par le service role, depuis /api : modération d'un contenu
-- illicite, effacement lié à une demande RGPD examinée. Elle passe alors par une
-- décision tracée, et non par un appel du navigateur.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "messages_delete" ON public.messages;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'messages'
--    ORDER BY cmd;
--    -- attendu : aucune ligne DELETE
--
-- Contrôle fonctionnel : la messagerie doit continuer de fonctionner
-- normalement — envoyer et lire un message dans une conversation existante.
-- Aucun écran n'utilisait la suppression, rien ne doit donc changer à l'usage.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    CREATE POLICY messages_delete ON public.messages
--      FOR DELETE TO authenticated
--      USING (sender_id = (SELECT auth.uid()));
--
-- À n'envisager que si une obligation d'effacement l'impose — et alors plutôt
-- par /api, pour que la suppression laisse une trace.
-- ═══════════════════════════════════════════════════════════════════════════
