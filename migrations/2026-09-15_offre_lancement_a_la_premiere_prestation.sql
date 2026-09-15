-- ═══════════════════════════════════════════════════════════════════════════
-- L'offre de lancement se déclenche à la PREMIÈRE PRESTATION ACCEPTÉE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI ÉTAIT EN PLACE, ET CE QUI NE TENAIT TOUJOURS PAS
--
-- La place s'est d'abord attribuée à l'INSCRIPTION : un compte refusé la
-- gardait, un compte sans documents aussi.
--
-- Le 24/08/2026 elle est passée à l'OUVERTURE DE L'ACCÈS AUX PRESTATIONS
-- (`missions_enabled_at`). C'était mieux — le dossier est alors complet et
-- vérifié — mais le défaut de fond restait : un prestataire validé qui ne
-- travaille jamais consommait une place, et l'offre s'épuisait sans avoir
-- produit une seule prestation.
--
-- CE QUE DÉCIDE CETTE MIGRATION
--
-- Décision d'Alexandre du 15/09/2026, en deux temps :
--
--   • L'ÉLIGIBILITÉ tient à l'ANCIENNETÉ. L'offre reste réservée aux 100
--     premiers prestataires dont l'accès aux prestations est ouvert, classés
--     par leur date d'inscription. C'est la promesse faite depuis le début, et
--     le filtre sur l'accès ouvert la protège des inscriptions fantômes.
--
--   • LE DÉCLENCHEMENT tient au TRAVAIL. L'offre ne s'active qu'à la première
--     prestation acceptée, et dure jusqu'à la fin du mois civil de cette date.
--     Passé ce mois, retour au quota Gratuit — sauf abonnement souscrit.
--
-- L'éligibilité n'est évaluée qu'UNE FOIS, au déclenchement : c'est ce qui rend
-- le classement stable. La réévaluer à chaque lecture ferait perdre en cours de
-- mois une offre déjà accordée à celui que l'arrivée d'un inscrit plus ancien
-- pousse hors des 100.
--
-- `missions_enabled_at` N'EST PAS SUPPRIMÉE
--
-- Elle garde son sens propre — la date d'ouverture de l'accès aux prestations —
-- et sert au suivi. Elle ne commande simplement plus l'offre.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS offre_lancement_at timestamptz;

COMMENT ON COLUMN public.profiles.offre_lancement_at IS
  'Instant où le prestataire a accepté sa PREMIÈRE prestation, et donc où '
  'l''offre de lancement s''est déclenchée. Fige sa place parmi les 100 ; '
  'l''offre elle-même ne vaut que jusqu''à la fin du mois civil de cette date. '
  'NULL tant qu''aucune prestation n''a été acceptée. Voir api/_offre.js.';

-- ── Reprise de l'existant ───────────────────────────────────────────────────
--
-- Les prestataires qui ont DÉJÀ accepté une prestation reçoivent la date de la
-- plus ancienne. On ne dispose pas de la date d'acceptation elle-même : on
-- retient la création de la prestation, qui la précède de peu et respecte
-- l'ordre d'arrivée — ce qui est tout ce que le classement demande.
--
-- Ceux qui n'ont jamais accepté restent à NULL : ils déclencheront l'offre en
-- travaillant, ce qui est exactement la nouvelle règle. Leur éligibilité, elle,
-- ne dépend que de leur ancienneté et reste acquise tant qu'ils figurent parmi
-- les 100 premiers comptes ouverts.
--
-- La reprise ne vérifie PAS l'éligibilité : ceux qui ont déjà travaillé
-- bénéficiaient de l'offre sous l'ancienne règle, et la leur retirer
-- rétroactivement serait leur reprendre quelque chose d'acquis. Le contrôle
-- d'ancienneté ne vaut donc que pour les déclenchements à venir.
--
-- ⚠️ CONSÉQUENCE À CONNAÎTRE AVANT DE LANCER
--
-- Un prestataire dont la première prestation date d'un mois révolu n'est plus
-- dans le mois de son déclenchement : il repasse donc à 2 prestations par mois.
-- C'est la règle voulue, appliquée honnêtement à l'existant plutôt que
-- rétroactivement adoucie.
--
-- Pour voir QUI est concerné AVANT d'exécuter, passer d'abord ceci :
--
--   SELECT p.id, p.prenom, p.nom, p.plan_abonnement,
--          min(m.created_at) AS premiere_prestation,
--          to_char(min(m.created_at) AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS mois
--   FROM profiles p
--   JOIN missions m ON m.prestataire_id = p.id
--   WHERE p.role = 'prestataire'
--     AND m.status IN ('assigned','completed','closed','disputed')
--   GROUP BY p.id, p.prenom, p.nom, p.plan_abonnement
--   ORDER BY premiere_prestation;
UPDATE public.profiles p
SET offre_lancement_at = s.premiere
FROM (
  SELECT prestataire_id, min(created_at) AS premiere
  FROM missions
  WHERE prestataire_id IS NOT NULL
    AND status IN ('assigned', 'completed', 'closed', 'disputed')
  GROUP BY prestataire_id
) s
WHERE p.id = s.prestataire_id
  AND p.role = 'prestataire'
  AND p.offre_lancement_at IS NULL;

-- Le classement des 100 premiers lit cette colonne à chaque calcul de quota.
CREATE INDEX IF NOT EXISTS profiles_offre_lancement_at_idx
  ON public.profiles (offre_lancement_at)
  WHERE offre_lancement_at IS NOT NULL;

-- ── La colonne n'est pas modifiable depuis le navigateur ────────────────────
--
-- Un prestataire capable de l'écrire s'attribuerait l'offre, ou se replacerait
-- en tête des 100 en repoussant quelqu'un d'autre dehors.
REVOKE UPDATE (offre_lancement_at) ON public.profiles FROM anon, authenticated;

-- ── Relecture ───────────────────────────────────────────────────────────────
--
-- Les places prises, dans l'ordre, et qui en bénéficie CE MOIS-CI :
--
--   SELECT prenom, nom, offre_lancement_at,
--          to_char(offre_lancement_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM')
--            = to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS offre_active
--   FROM profiles
--   WHERE offre_lancement_at IS NOT NULL
--   ORDER BY offre_lancement_at
--   LIMIT 100;
--
-- Et le décompte des places restantes :
--
--   SELECT 100 - count(*) AS places_restantes
--   FROM profiles WHERE offre_lancement_at IS NOT NULL;
