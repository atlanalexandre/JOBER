-- ═══════════════════════════════════════════════════════════════════════════
-- Droit de rétractation : garder la preuve de l'information et de la
-- renonciation (art. L.221-18 et suivants du Code de la consommation)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le Client particulier commande à distance : il dispose en principe de
-- quatorze jours pour se rétracter. Une exception existe pour certains services
-- fournis à une date déterminée (L.221-28, 12°), mais son énumération est
-- limitative et d'interprétation stricte — le conseil juridique demande
-- expressément de NE PAS la présumer applicable aux prestations de la
-- Plateforme.
--
-- Le mot « rétractation » n'apparaissait jusqu'ici dans aucun document ni dans
-- aucun écran. Or l'absence d'information ne supprime pas le droit : elle le
-- PROLONGE, jusqu'à douze mois après l'expiration du délai initial (L.221-20).
-- Un client aurait donc pu réclamer le remboursement intégral d'une prestation
-- commandée onze mois plus tôt, et exécutée.
--
-- La parade tient en trois actes, tous accomplis avant le paiement :
--
--   1. informer du droit ;
--   2. recueillir la demande expresse d'exécution avant la fin du délai ;
--   3. recueillir la reconnaissance que le droit s'éteint une fois la
--      prestation pleinement exécutée (L.221-25).
--
-- CE QUE STOCKENT CES COLONNES
--
-- L'instant où ces mentions ont été présentées et acceptées, et la version du
-- texte affiché. Sans horodatage, la renonciation n'est pas prouvable ; sans
-- version, on ne saura pas dans deux ans CE QUI avait été accepté.
--
-- Elles sont NULL sur les prestations antérieures : le droit n'y a pas été
-- purgé, et il faut que cela reste visible plutôt que d'être masqué par une
-- valeur par défaut.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS retractation_renonciation_at timestamptz,
  ADD COLUMN IF NOT EXISTS retractation_version         text;

-- Le contrôle « quelles prestations ont purgé le droit » doit rester instantané.
CREATE INDEX IF NOT EXISTS missions_retractation_idx
  ON public.missions (client_id)
  WHERE retractation_renonciation_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Les colonnes :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions'
--      AND column_name IN ('retractation_renonciation_at','retractation_version');
--    -- attendu : 2 lignes
--
-- 2. Après quelques réservations, la renonciation doit être présente sur
--    TOUTES les prestations payées après le déploiement :
--
--    SELECT count(*) FROM missions
--    WHERE stripe_payment_intent IS NOT NULL
--      AND created_at > '2026-08-15'
--      AND retractation_renonciation_at IS NULL;
--    -- attendu : 0 — sinon un chemin de paiement ne recueille pas la mention
--
-- 3. Les prestations antérieures, sur lesquelles le droit n'a pas été purgé :
--
--    SELECT count(*) FROM missions
--    WHERE stripe_payment_intent IS NOT NULL AND retractation_renonciation_at IS NULL;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS missions_retractation_idx;
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS retractation_renonciation_at,
--      DROP COLUMN IF EXISTS retractation_version;
--
-- Attention : la preuve des renonciations déjà recueillies serait perdue.
-- ═══════════════════════════════════════════════════════════════════════════
