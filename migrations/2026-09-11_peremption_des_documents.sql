-- ═══════════════════════════════════════════════════════════════════════════
-- Étendre la surveillance de péremption à TOUTES les pièces du dossier
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI EXISTAIT DÉJÀ, ET QU'IL NE FAUT SURTOUT PAS DOUBLER
--
-- `documents.expires_at` existe depuis le 14/08/2026, et un balayage quotidien
-- surveille déjà les attestations RC Pro : relance, puis suspension au terme
-- des trente jours de tolérance de l'article 19.1 des CGPS.
--
-- Ce mécanisme est bon. Il ne portait simplement que sur UN type de document.
--
-- L'attestation URSSAF vaut six mois, un titre de séjour expire, une carte
-- professionnelle CNAPS dure cinq ans — et rien ne les regardait. Un
-- prestataire pouvait donc intervenir avec une attestation de vigilance
-- caduque depuis un an.
--
-- CE QUE CETTE MIGRATION AJOUTE
--
-- Une seule colonne : l'horodatage de la dernière relance, PAR DOCUMENT. La
-- RC Pro se contentait de `profiles.rc_pro_relance_at`, une colonne par type —
-- ce qui n'est pas tenable pour huit types. Le balayage généralisé lit
-- désormais cette colonne pour tous, RC Pro comprise.
--
-- Et un rattrapage : les dates de validité qui se DÉDUISENT sont posées sur
-- les documents déjà en base. Celles qui ne se déduisent pas ne sont pas
-- inventées — voir plus bas.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS relance_expiration_at timestamptz;

COMMENT ON COLUMN documents.relance_expiration_at IS
  'Dernière relance envoyée au prestataire au sujet de l''expiration de CE '
  'document. Le balayage quotidien relance au plus une fois par semaine. '
  'Remplace profiles.rc_pro_relance_at, qui ne valait que pour un type.';

-- Une date d'expiration repoussée depuis le navigateur, c'est une assurance
-- périmée qui reste réputée valide.
REVOKE UPDATE (relance_expiration_at) ON public.documents FROM anon, authenticated;
REVOKE UPDATE (expires_at)            ON public.documents FROM anon, authenticated;

-- ── Rattrapage : seulement les dates qui se déduisent ───────────────────────
--
-- Une attestation URSSAF vaut six mois À COMPTER DE SON ÉMISSION : la date se
-- calcule. La période de garantie d'une RC Pro est écrite sur l'attestation et
-- n'a aucun rapport avec le jour du dépôt : la déduire donnerait une fausse
-- date — et une fausse date rassure à tort, ce qui est pire que pas de date.
--
-- On ne touche donc qu'à l'URSSAF, au KBIS et au justificatif de domicile, et
-- uniquement là où rien n'est renseigné.
--
-- Conséquence assumée : beaucoup seront immédiatement périmés, ayant été
-- déposés il y a plus de six mois. C'est la réalité, et c'est ce qu'on voulait
-- voir. Le balayage relancera avant de suspendre.
UPDATE documents
SET expires_at = (created_at + interval '6 months')::date
WHERE type = 'urssaf' AND expires_at IS NULL AND created_at IS NOT NULL;

UPDATE documents
SET expires_at = (created_at + interval '3 months')::date
WHERE type IN ('kbis', 'domicile') AND expires_at IS NULL AND created_at IS NOT NULL;

-- ── Relecture ───────────────────────────────────────────────────────────────
--
--   SELECT type,
--          count(*) FILTER (WHERE expires_at IS NULL)           AS sans_date,
--          count(*) FILTER (WHERE expires_at <  current_date)   AS perimes,
--          count(*) FILTER (WHERE expires_at >= current_date)   AS valides
--   FROM documents GROUP BY type ORDER BY type;
--
-- Et le détail de ce qui expire sous trente jours :
--
--   SELECT d.type, d.expires_at, d.verified, p.prenom, p.nom, p.missions_enabled
--   FROM documents d JOIN profiles p ON p.id = d.prestataire_id
--   WHERE d.expires_at IS NOT NULL AND d.expires_at <= current_date + 30
--   ORDER BY d.expires_at;
