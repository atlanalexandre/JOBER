-- ═══════════════════════════════════════════════════════════════════════════
-- Mandat d'encaissement : le sortir des CGPS et le faire accepter à part
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- ALANE encaisse le prix de la Prestation au nom et pour le compte du
-- Prestataire. Ce mandat ne figurait que dans l'article 7.2 des CGPS, accepté
-- en bloc à l'inscription avec vingt-quatre autres articles.
--
-- Les deux conseils consultés convergent : un mandat d'encaissement suppose un
-- document DISTINCT, une acceptation EXPLICITE et une trace HORODATÉE. Noyé
-- dans des conditions générales, il se défend mal — et c'est précisément la
-- pièce sur laquelle repose la qualification de l'activité.
--
-- CE QUE STOCKENT CES COLONNES
--
-- La date d'acceptation et la version du texte accepté. Sans horodatage, le
-- mandat n'est pas prouvable ; sans version, on ne saura pas dans deux ans ce
-- qui avait été accepté.
--
-- CE QUE CE FICHIER NE RÈGLE PAS
--
-- La question réglementaire de fond — ALANE peut-elle encaisser et conserver —
-- reste posée à un avocat spécialisé en paiements. Ce mandat améliore la
-- position ; il ne la garantit pas.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mandat_encaissement_at      timestamptz,
  ADD COLUMN IF NOT EXISTS mandat_encaissement_version text;

-- Les prestataires à relancer : ceux qui exercent sans avoir signé le mandat.
CREATE INDEX IF NOT EXISTS profiles_mandat_encaissement_idx
  ON public.profiles (role)
  WHERE mandat_encaissement_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('mandat_encaissement_at','mandat_encaissement_version');
--    -- attendu : 2 lignes
--
-- Les prestataires actifs n'ayant pas encore accepté :
--
--    SELECT count(*) FROM profiles
--    WHERE role = 'prestataire' AND status = 'approved'
--      AND mandat_encaissement_at IS NULL;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS profiles_mandat_encaissement_idx;
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS mandat_encaissement_at,
--      DROP COLUMN IF EXISTS mandat_encaissement_version;
--
-- Attention : la preuve des mandats déjà acceptés serait perdue.
-- ═══════════════════════════════════════════════════════════════════════════
