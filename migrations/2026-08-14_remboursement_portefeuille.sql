-- ═══════════════════════════════════════════════════════════════════════════
-- Portefeuille : tracer ce qui a déjà été remboursé
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le rechargement du portefeuille est suspendu, et un droit de remboursement du
-- solde inutilisé est ouvert au client. L'avocat relève que l'absence de tout
-- remboursement s'analyse mal — au regard du régime de la monnaie électronique
-- comme du droit des clauses abusives.
--
-- Le remboursement s'impute sur les recharges déjà enregistrées dans
-- `wallet_topups`, de la plus récente à la plus ancienne. Sans mémoire de ce qui
-- a déjà été rendu sur chacune, une seconde demande rembourserait une deuxième
-- fois la même recharge : Stripe refuserait le second remboursement, mais le
-- solde du client, lui, aurait été débité deux fois.
--
-- D'où cette colonne. Elle porte le montant déjà remboursé sur une recharge
-- donnée, jamais supérieur au montant de celle-ci.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallet_topups
  ADD COLUMN IF NOT EXISTS montant_rembourse numeric NOT NULL DEFAULT 0
    CHECK (montant_rembourse >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_topups_remboursement_plafond'
  ) THEN
    ALTER TABLE public.wallet_topups
      ADD CONSTRAINT wallet_topups_remboursement_plafond
      CHECK (montant_rembourse <= amount);
  END IF;
END $$;

-- Le traitement cherche les recharges encore remboursables d'un client.
CREATE INDEX IF NOT EXISTS wallet_topups_remboursables_idx
  ON public.wallet_topups (user_id, created_at DESC)
  WHERE montant_rembourse < amount;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'wallet_topups' AND column_name = 'montant_rembourse';
--    -- attendu : 1 ligne
--
-- Les soldes et les recharges d'un client, pour contrôle :
--
--    SELECT p.id, p.prepaid_balance,
--           coalesce(sum(w.amount), 0)            AS total_recharge,
--           coalesce(sum(w.montant_rembourse), 0) AS total_rembourse
--    FROM profiles p
--    LEFT JOIN wallet_topups w ON w.user_id = p.id
--    WHERE p.prepaid_balance > 0
--    GROUP BY p.id, p.prepaid_balance;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS wallet_topups_remboursables_idx;
--    ALTER TABLE public.wallet_topups
--      DROP CONSTRAINT IF EXISTS wallet_topups_remboursement_plafond,
--      DROP COLUMN IF EXISTS montant_rembourse;
--
-- Attention : la trace des remboursements déjà émis serait perdue, et une
-- nouvelle demande les rejouerait.
-- ═══════════════════════════════════════════════════════════════════════════
