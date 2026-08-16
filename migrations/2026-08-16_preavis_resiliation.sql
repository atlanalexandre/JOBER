-- ═══════════════════════════════════════════════════════════════════════════
-- Préavis de résiliation des comptes professionnels (CGPS art. 16.2, P2B)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'article 16.2, réécrit le 15/08/2026, prévoit un préavis de TRENTE JOURS
-- avant la résiliation du compte d'un utilisateur professionnel — c'est ce
-- qu'impose l'article 4 du règlement (UE) 2019/1150 dit P2B.
--
-- Le backoffice ne savait que supprimer IMMÉDIATEMENT. La clause promettait
-- donc un délai que l'outil ne permettait pas de tenir : une promesse sans
-- implémentation, exactement ce que ce projet passe son temps à éliminer.
--
-- CE QUE STOCKENT CES COLONNES
--
-- La date d'effet annoncée, le motif notifié, et la date de la notification.
-- Le motif est conservé parce que l'intéressé peut contester, et qu'une
-- décision qu'on ne sait plus justifier ne se défend pas.
--
-- CE QUI EXÉCUTE
--
-- Le traitement quotidien : à l'échéance, le compte est supprimé. Tant que la
-- date n'est pas atteinte, le compte fonctionne normalement — un préavis n'est
-- pas une suspension. Pour écarter quelqu'un immédiatement, c'est la suspension
-- conservatoire qui s'applique, et elle est déjà outillée.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS resiliation_prevue_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resiliation_motif       text,
  ADD COLUMN IF NOT EXISTS resiliation_notifiee_at timestamptz;

-- Le traitement cherche les résiliations arrivées à échéance.
CREATE INDEX IF NOT EXISTS profiles_resiliation_echue_idx
  ON public.profiles (resiliation_prevue_at)
  WHERE resiliation_prevue_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('resiliation_prevue_at','resiliation_motif','resiliation_notifiee_at');
--    -- attendu : 3 lignes
--
-- Les résiliations programmées, et leur échéance :
--
--    SELECT id, resiliation_prevue_at, resiliation_motif
--    FROM profiles WHERE resiliation_prevue_at IS NOT NULL
--    ORDER BY resiliation_prevue_at;
--
-- Aucune ne doit rester au-delà de son terme : si c'est le cas, le traitement
-- quotidien ne tourne pas.
--
--    SELECT count(*) FROM profiles
--    WHERE resiliation_prevue_at < now() - interval '2 days';
--    -- attendu : 0
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS profiles_resiliation_echue_idx;
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS resiliation_prevue_at,
--      DROP COLUMN IF EXISTS resiliation_motif,
--      DROP COLUMN IF EXISTS resiliation_notifiee_at;
--
-- Attention : les résiliations programmées seraient annulées sans que les
-- intéressés en soient informés.
-- ═══════════════════════════════════════════════════════════════════════════
