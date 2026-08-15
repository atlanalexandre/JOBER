-- ═══════════════════════════════════════════════════════════════════════════
-- Mandat de facturation (art. 289, I-2 du CGI et art. L.216-35 du code des
-- impositions sur les biens et services)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La Plateforme émet, pour chaque prestation, un document intitulé « Facture »,
-- portant un numéro séquentiel continu, le SIRET des deux parties et un
-- archivage décennal. C'est une facture, émise AU NOM DU PRESTATAIRE.
--
-- L'article 6.3 des CGPS affirmait pourtant l'inverse : « ALANE n'émet pas de
-- facture […] une attestation de prestation à titre indicatif, qui ne constitue
-- pas un document comptable au sens légal ». Le texte et le produit se
-- contredisaient frontalement.
--
-- Le conseil juridique tranche pour assumer le mandat plutôt que d'appauvrir le
-- service. Facturer au nom d'un tiers suppose alors un mandat ÉCRIT ET
-- PRÉALABLE, et la faculté pour le mandant de contester la facture émise.
--
-- CE QUE STOCKENT CES COLONNES
--
-- La date d'acceptation du mandat par le prestataire, et la version du texte
-- accepté. Sans horodatage, le mandat n'est pas prouvable ; sans version, on ne
-- saura pas dans deux ans ce qui avait été accepté.
--
-- CONSÉQUENCE DANS LE PRODUIT
--
-- Tant que le mandat n'est pas accepté, aucune facture n'est émise au nom du
-- prestataire : le document devient une attestation de prestation, sans numéro
-- séquentiel. C'est la seule position tenable — un numéro tiré sans mandat
-- entamerait une numérotation qu'on ne pourrait plus justifier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mandat_facturation_at      timestamptz,
  ADD COLUMN IF NOT EXISTS mandat_facturation_version text;

-- Les prestataires à relancer : ceux qui exercent sans avoir accepté le mandat.
CREATE INDEX IF NOT EXISTS profiles_mandat_facturation_idx
  ON public.profiles (role)
  WHERE mandat_facturation_at IS NULL;

-- Contestation d'une facture par le prestataire. L'article impose que le
-- mandant puisse refuser ou contester ; sans trace, la faculté n'existe pas.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS facture_contestee_at    timestamptz,
  ADD COLUMN IF NOT EXISTS facture_contestee_motif text;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Les colonnes :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('mandat_facturation_at','mandat_facturation_version');
--    -- attendu : 2 lignes
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions'
--      AND column_name IN ('facture_contestee_at','facture_contestee_motif');
--    -- attendu : 2 lignes
--
-- 2. Les prestataires actifs n'ayant pas encore accepté le mandat — ils
--    n'obtiendront qu'une attestation tant qu'ils ne l'ont pas fait :
--
--    SELECT count(*) FROM profiles
--    WHERE role = 'prestataire' AND status = 'approved'
--      AND mandat_facturation_at IS NULL;
--
-- 3. Les factures contestées, à traiter :
--
--    SELECT id, prestataire_id, facture_contestee_at, facture_contestee_motif
--    FROM missions WHERE facture_contestee_at IS NOT NULL
--    ORDER BY facture_contestee_at DESC;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS profiles_mandat_facturation_idx;
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS mandat_facturation_at,
--      DROP COLUMN IF EXISTS mandat_facturation_version;
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS facture_contestee_at,
--      DROP COLUMN IF EXISTS facture_contestee_motif;
--
-- Attention : la preuve des mandats déjà acceptés serait perdue, et les
-- factures redeviendraient émises sans fondement.
-- ═══════════════════════════════════════════════════════════════════════════
