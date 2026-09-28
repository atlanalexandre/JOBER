-- ═══════════════════════════════════════════════════════════════════════════
-- Messagerie : des participants explicites, un « lu » partagé, le temps réel
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- 1. Aucun modèle de participants. Un message n'était rattaché à sa
--    conversation que par une chaîne, `conversation_key = 'prov{P}-user{C}'`,
--    et la règle de lecture cherchait l'identifiant de l'appelant DANS cette
--    chaîne (`LIKE '%' || auth.uid() || '%'`). Juste tant que le format de la
--    clé ne change pas — une convention de nommage, pas un modèle (point ouvert
--    depuis le 17/08/2026, DOCUMENTATION.md §5).
--
-- 2. Le « non lu » vivait dans le navigateur : un horodatage en localStorage,
--    remis à zéro à l'ouverture de l'écran de discussion. Propre à chaque
--    appareil, perdu en navigation privée, et faux dès qu'on a plusieurs
--    conversations : ouvrir l'une effaçait le badge de toutes.
--
-- 3. La table n'était pas publiée pour le temps réel (`supabase_realtime`) —
--    constaté en recette le 28/09/2026. L'écran de discussion s'y abonnait
--    pourtant : les messages de l'autre partie n'apparaissaient qu'en
--    rechargeant la page.
--
-- 4. `anon` et `authenticated` détenaient INSERT, UPDATE, DELETE et TRUNCATE.
--    La RLS bloque les trois premiers faute de policy, mais TRUNCATE n'est PAS
--    soumis à la RLS. Or l'article 17.1 des CGPS fait des messages une pièce :
--    « ils ne peuvent être supprimés par leurs auteurs ». Rien ne doit reposer
--    sur l'absence d'une policy.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- • Ajoute `client_id`, `prestataire_id` (les deux participants) et `lu_at`
--   (lu par le destinataire). Pas de clé étrangère, volontairement : un
--   message survit à la suppression du compte de son auteur, pour la preuve
--   (CGPS 17.1, conservation) — une clé étrangère l'empêcherait ou l'effacerait.
-- • Remplit les participants des messages existants à partir de la clé.
-- • Exige, pour tout NOUVEAU message, deux participants et un auteur qui en
--   soit un, du bon côté (`NOT VALID` : les messages antérieurs, dont le tag
--   pouvait être falsifié jusqu'au 17/08, ne sont pas réécrits — ce sont des
--   pièces, on ne les corrige pas).
-- • Remplace la règle de lecture par une comparaison de colonnes.
-- • Retire au navigateur tout droit autre que la lecture.
-- • Publie la table pour le temps réel.
--
-- ORDRE : cette migration PUIS le déploiement du code qui lit ces colonnes.
-- L'ancien code continue de fonctionner après elle (il lit par la clé, que le
-- serveur écrit toujours) ; le nouveau, lui, échouerait avant.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id      uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS prestataire_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS lu_at          timestamptz;

-- Participants des messages existants, depuis la clé « prov{P}-user{C} ».
UPDATE public.messages
   SET prestataire_id = (regexp_match(conversation_key, '^prov([0-9a-f-]{36})-user([0-9a-f-]{36})$'))[1]::uuid,
       client_id      = (regexp_match(conversation_key, '^prov([0-9a-f-]{36})-user([0-9a-f-]{36})$'))[2]::uuid
 WHERE (client_id IS NULL OR prestataire_id IS NULL)
   AND conversation_key ~ '^prov[0-9a-f-]{36}-user[0-9a-f-]{36}$';

-- Les messages déjà échangés sont considérés comme lus : l'ancien compteur,
-- propre à l'appareil, ne permet pas de savoir lesquels l'étaient. Sans cela,
-- chaque utilisateur verrait d'un coup tout son historique « non lu ».
UPDATE public.messages SET lu_at = created_at WHERE lu_at IS NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_participants_requis;
ALTER TABLE public.messages ADD CONSTRAINT messages_participants_requis
  CHECK (client_id IS NOT NULL AND prestataire_id IS NOT NULL AND client_id <> prestataire_id) NOT VALID;

-- L'auteur est l'un des deux participants, et son tag dit lequel.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_auteur_participant;
ALTER TABLE public.messages ADD CONSTRAINT messages_auteur_participant
  CHECK (
       (sender_tag = 'client'      AND sender_id = client_id)
    OR (sender_tag = 'prestataire' AND sender_id = prestataire_id)
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS messages_client_created_idx      ON public.messages (client_id, created_at);
CREATE INDEX IF NOT EXISTS messages_prestataire_created_idx ON public.messages (prestataire_id, created_at);

-- Lecture : l'appelant est l'un des deux participants. Plus aucune sous-chaîne.
DROP POLICY IF EXISTS messages_lecture ON public.messages;
CREATE POLICY messages_lecture ON public.messages
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = client_id OR (SELECT auth.uid()) = prestataire_id);

-- Le navigateur lit, c'est tout. L'envoi et le « lu » passent par /api
-- (`envoyer_message`, `marquer_messages_lus`), en service role.
REVOKE ALL ON public.messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.messages FROM authenticated;
GRANT SELECT ON public.messages TO authenticated;

-- Temps réel : sans publication, l'abonnement de l'écran de discussion ne
-- reçoit rien. Idempotent — la table peut déjà y figurer en production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Aucun message sans participants — attendu : 0
--    SELECT count(*) FROM public.messages WHERE client_id IS NULL OR prestataire_id IS NULL;
--
-- 2. La règle de lecture ne lit plus la clé — attendu : une ligne, sans « ~~ »
--    SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'messages';
--
-- 3. Le navigateur ne peut que lire — attendu : authenticated | SELECT, seul
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND table_name = 'messages' AND grantee IN ('anon', 'authenticated');
--
-- 4. Publiée pour le temps réel — attendu : une ligne
--    SELECT pubname FROM pg_publication_tables WHERE tablename = 'messages';
