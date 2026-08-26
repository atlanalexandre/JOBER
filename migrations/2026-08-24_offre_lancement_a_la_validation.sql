-- ═══════════════════════════════════════════════════════════════════════════
-- L'offre de lancement s'attribue à l'ouverture de l'accès aux prestations
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI ÉTAIT EN PLACE, ET POURQUOI ÇA NE TENAIT PAS
--
-- Les 8 prestations mensuelles de l'offre revenaient aux 100 profils
-- prestataires les plus anciens PAR DATE D'INSCRIPTION, sans regarder ni le
-- statut du compte ni l'accès aux prestations. La place était donc prise au
-- moment où quelqu'un remplissait le formulaire, avant toute vérification.
--
-- Trois conséquences : un compte refusé gardait sa place ; un compte qui ne
-- déposait jamais ses documents la gardait aussi ; et cinquante inscriptions
-- fantômes auraient consommé la moitié de l'offre.
--
-- S'y ajoutait une incohérence d'affichage : le compteur « Plus que X places
-- sur 100 » se calculait sur les prestataires APPROUVÉS, pas sur les inscrits.
-- Les deux ne comptaient pas la même chose. Avec 150 inscrits et 40 validés,
-- l'écran annonçait « 60 places restantes » alors que les 100 places étaient
-- prises depuis longtemps — une promesse faite à des gens qui ne l'auraient
-- jamais eue (art. L121-2 du Code de la consommation).
--
-- CE QUE DÉCIDE CETTE MIGRATION
--
-- Décision d'Alexandre du 24/08/2026 : la place s'attribue à l'OUVERTURE DE
-- L'ACCÈS AUX PRESTATIONS. C'est le seul moment qui atteste d'un dossier
-- complet et vérifié, et il ne peut pas être forcé de l'extérieur.
--
-- POURQUOI UNE COLONNE PLUTÔT QUE `created_at`
--
-- Trier les prestataires ouverts par leur date d'INSCRIPTION rendrait le
-- classement instable : ouvrir l'accès à quelqu'un inscrit de longue date le
-- ferait entrer dans les 100 en en poussant un autre dehors, qui perdrait une
-- offre déjà accordée. `missions_enabled_at` fige l'ordre d'arrivée : une fois
-- dedans, on ne peut plus en sortir par l'entrée d'un autre.
--
-- REPRISE DE L'EXISTANT
--
-- Les prestataires déjà ouverts n'ont pas d'horodatage. On le reprend de leur
-- `created_at` : c'est l'approximation la plus fidèle — ils ont été ouverts
-- dans un ordre qui suit globalement celui des inscriptions — et elle ne
-- déclasse personne.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS missions_enabled_at timestamptz;

-- Reprise de l'existant. `WHERE … IS NULL` rend la migration rejouable sans
-- écraser un horodatage déjà posé.
UPDATE public.profiles
   SET missions_enabled_at = created_at
 WHERE role = 'prestataire'
   AND missions_enabled IS TRUE
   AND missions_enabled_at IS NULL;

-- Le classement des 100 premiers se lit à chaque contrôle de quota : sans
-- index, c'est un balayage complet de la table à chaque acceptation de
-- prestation.
CREATE INDEX IF NOT EXISTS profiles_offre_lancement_idx
  ON public.profiles (missions_enabled_at)
  WHERE role = 'prestataire' AND missions_enabled IS TRUE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Cette colonne n'est pas modifiable depuis le navigateur
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Elle décide de l'attribution d'une offre commerciale. Modifiable, un
-- prestataire s'antidaterait dans les 100 premiers.
--
-- `profiles_privileges_guard` protège déjà `role` et `status` ; on ferme ici
-- l'écriture de la colonne par les droits, ce qui est plus direct qu'un
-- déclencheur et se relit d'une requête.

REVOKE UPDATE (missions_enabled_at) ON public.profiles FROM anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne existe et l'existant est repris :
--
--    SELECT count(*) FILTER (WHERE missions_enabled_at IS NOT NULL) AS horodates,
--           count(*)                                                AS ouverts
--      FROM public.profiles
--     WHERE role = 'prestataire' AND missions_enabled IS TRUE;
--    -- attendu : les deux nombres sont égaux
--
-- 2. Les places prises, et celles qui restent :
--
--    SELECT count(*) AS places_prises, greatest(0, 100 - count(*)) AS places_restantes
--      FROM public.profiles
--     WHERE role = 'prestataire' AND missions_enabled IS TRUE;
--
-- 3. Elle n'est pas modifiable depuis le navigateur :
--
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema='public' AND table_name='profiles'
--      AND privilege_type='UPDATE' AND grantee='authenticated'
--      AND column_name='missions_enabled_at';
--    -- attendu : 0 ligne
--
-- RETOUR ARRIÈRE
--
--    DROP INDEX IF EXISTS public.profiles_offre_lancement_idx;
--    ALTER TABLE public.profiles DROP COLUMN IF EXISTS missions_enabled_at;
--
-- À ne faire qu'accompagné du retour arrière du code : sans la colonne, le
-- calcul du quota est refusé en bloc par PostgREST et plus aucun prestataire
-- ne peut accepter de prestation.
-- ═══════════════════════════════════════════════════════════════════════════
