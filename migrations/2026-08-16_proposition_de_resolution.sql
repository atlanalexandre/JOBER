-- ═══════════════════════════════════════════════════════════════════════════
-- Résolution des litiges : proposition, opposition, accord (CGPS art. 17.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'article 17.1 annonçait une « proposition de résolution » sans caractère
-- contraignant, puis, quelques lignes plus loin, qu'ALANE pouvait « donner
-- instruction de verser, de rembourser ou de maintenir les fonds
-- indisponibles ». C'est-à-dire un pouvoir de décision sur des fonds qui ne
-- lui appartiennent pas — précisément ce qu'un examen prudentiel regarde en
-- premier, et ce qui rapproche la Plateforme de la fourniture de services de
-- paiement pour compte de tiers (art. L.521-1 et s. du Code monétaire et
-- financier).
--
-- Le code faisait pire que le texte : `resolve_dispute` tranchait
-- unilatéralement depuis le backoffice — remboursement Stripe immédiat ou
-- validation de la prestation — sans proposition, sans notification préalable,
-- et sans qu'aucune des deux parties puisse s'y opposer.
--
-- L'article 17.1 réécrit le 16/08/2026 ne connaît plus que trois causes de
-- déblocage : l'accord des parties, les procédures propres au prestataire de
-- services de paiement, une décision de justice. Ces colonnes portent la
-- première — la seule qu'ALANE outille.
--
-- CE QUE STOCKENT CES COLONNES
--
-- La proposition formulée et son motif ; la date de sa notification et
-- l'échéance de 48 heures qui en découle ; et, le cas échéant, l'opposition
-- de l'une des parties, avec son auteur et sa date.
--
-- L'auteur de l'opposition est conservé parce qu'il détermine la suite : une
-- opposition du Client et une opposition du Prestataire n'appellent pas le
-- même traitement, et parce qu'une décision qu'on ne sait plus justifier ne
-- se défend pas.
--
-- CE QUI EXÉCUTE
--
-- Le traitement des versements, toutes les deux heures : à l'échéance et à
-- défaut d'opposition, l'accord est réputé formé et l'instruction est
-- transmise à Stripe. En cas d'opposition, les fonds restent bloqués et rien
-- n'est transmis : le différend se poursuit entre les parties.
--
-- Aucun délai ne fait donc plus partir de l'argent sans qu'une partie au
-- moins ait été mise en mesure de s'y opposer.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS resolution_proposee      text,
  ADD COLUMN IF NOT EXISTS resolution_motif         text,
  ADD COLUMN IF NOT EXISTS resolution_notifiee_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_echeance_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_opposition_par uuid,
  ADD COLUMN IF NOT EXISTS resolution_opposition_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_executee_cause text;

-- Les deux seules propositions qu'ALANE sait formuler et exécuter.
--
-- Relevé au préalable de toutes les valeurs écrites par le code (CLAUDE.md
-- §1.6) : `api/bo-action.js` n'en produit pas d'autres, et une contrainte trop
-- étroite casserait la résolution des litiges sans message d'erreur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'missions_resolution_proposee_check'
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_resolution_proposee_check
      CHECK (resolution_proposee IS NULL
             OR resolution_proposee IN ('verser_prestataire', 'rembourser_client'));
  END IF;
END $$;

-- Le traitement cherche les propositions arrivées à échéance sans opposition.
CREATE INDEX IF NOT EXISTS missions_resolution_echeance_idx
  ON public.missions (resolution_echeance_at)
  WHERE resolution_proposee IS NOT NULL AND resolution_opposition_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- SÉCURITÉ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'opposition est un droit des parties, mais elle passe par `/api` :
-- l'écrire depuis le navigateur permettrait à un Client d'opposer à la place
-- du Prestataire, ou de rouvrir une échéance déjà close. Les policies
-- existantes sur `missions` n'autorisent pas la mise à jour de ces colonnes
-- par le front ; on ne les élargit donc pas.
--
-- La lecture, elle, doit être ouverte aux deux parties : chacune doit pouvoir
-- voir la proposition qui la concerne et le délai qui court. Les policies de
-- lecture de `missions` couvrent déjà le Client et le Prestataire de la
-- prestation, et ces colonnes en héritent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions'
--      AND column_name LIKE 'resolution_%';
--    -- attendu : 7 lignes
--
--    SELECT conname FROM pg_constraint
--    WHERE conname = 'missions_resolution_proposee_check';
--    -- attendu : 1 ligne
--
-- Les litiges en cours, et où ils en sont :
--
--    SELECT id, status, resolution_proposee, resolution_echeance_at,
--           resolution_opposition_par
--    FROM missions WHERE status = 'disputed'
--    ORDER BY resolution_echeance_at NULLS LAST;
--
-- Aucune proposition ne doit rester en souffrance longtemps après son terme :
-- si c'est le cas, le traitement des versements ne tourne pas.
--
--    SELECT count(*) FROM missions
--    WHERE resolution_proposee IS NOT NULL
--      AND resolution_opposition_at IS NULL
--      AND resolution_echeance_at < now() - interval '1 day'
--      AND status = 'disputed';
--    -- attendu : 0
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS missions_resolution_echeance_idx;
--    ALTER TABLE public.missions
--      DROP CONSTRAINT IF EXISTS missions_resolution_proposee_check;
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS resolution_proposee,
--      DROP COLUMN IF EXISTS resolution_motif,
--      DROP COLUMN IF EXISTS resolution_notifiee_at,
--      DROP COLUMN IF EXISTS resolution_echeance_at,
--      DROP COLUMN IF EXISTS resolution_opposition_par,
--      DROP COLUMN IF EXISTS resolution_opposition_at,
--      DROP COLUMN IF EXISTS resolution_executee_cause;
--
-- Attention : les litiges en cours perdraient la proposition notifiée aux
-- parties et le délai qui court. Il faudrait les reprendre un par un.
-- ═══════════════════════════════════════════════════════════════════════════
