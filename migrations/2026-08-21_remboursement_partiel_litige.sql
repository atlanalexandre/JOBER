-- ═══════════════════════════════════════════════════════════════════════════
-- Litige : pouvoir proposer un remboursement PARTIEL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le back-office n'offrait que deux issues à un litige : rembourser le client
-- de tout le prix de la prestation, ou verser l'intégralité au prestataire.
-- Rien entre les deux.
--
-- Or la plupart des litiges réels sont partiels : la prestation a été rendue,
-- mais incomplète ; deux heures sur trois ont été faites ; une partie du
-- travail est à refaire. Sans montant intermédiaire, l'arbitre n'a que deux
-- boutons dont aucun ne correspond à la situation — et il finit par choisir
-- celui qui lèse le moins mal, ce qui n'est pas une décision.
--
-- CE QUE PORTE LA COLONNE
--
-- `resolution_montant` — le montant, en euros, que la proposition de
-- remboursement porte réellement. `NULL` conserve le comportement d'avant :
-- le prix de la prestation, frais de service retenus.
--
-- Elle n'a de sens qu'avec `resolution_proposee = 'rembourser_client'`. Sur un
-- versement au prestataire, elle reste nulle.
--
-- POURQUOI ELLE N'EST PAS MODIFIABLE DEPUIS LE NAVIGATEUR
--
-- Elle décide de combien d'argent revient au client. Modifiable, elle
-- permettrait à une partie de fixer elle-même ce qu'elle récupère. Elle
-- rejoint donc les colonnes retirées à `authenticated` — le bloc ci-dessous
-- rejoue l'inventaire complet, sans effet de bord puisqu'il est reconstruit à
-- partir d'`information_schema`.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS resolution_montant numeric;

-- Un remboursement nul ou négatif n'est pas un remboursement. La borne HAUTE
-- n'est pas vérifiable ici — elle dépend de ce que la carte a réellement
-- supporté, cashback déduit — et reste à la charge de `proposer_resolution`
-- puis de `plafonnerRemboursement`.
ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_resolution_montant_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_resolution_montant_check
  CHECK (resolution_montant IS NULL OR resolution_montant > 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- Les droits d'écriture, rejoués avec la nouvelle colonne
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  interdites text[] := ARRAY[
    'id', 'client_id', 'prestataire_id', 'status',
    'montant_total', 'tarif_horaire', 'hours', 'actual_hours',
    'payout_status', 'payout_amount', 'payout_due_at',
    'payout_hold_reason', 'payout_hold_at', 'payout_hold_until',
    'payout_compensation', 'stripe_payment_intent', 'stripe_transfer_id',
    'cashback_credited', 'cancellation_reason',
    'cashback_applique', 'cashback_debite',
    'extra_hours_requested', 'extra_hours_status', 'extra_hours_tarif',
    'extra_hours_payment_intent',
    'resolution_proposee', 'resolution_motif', 'resolution_notifiee_at',
    'resolution_echeance_at', 'resolution_opposition_par',
    'resolution_opposition_at', 'resolution_executee_cause',
    -- La nouvelle : elle décide de combien revient au client.
    'resolution_montant',
    'arrived_at', 'started_at', 'acceptance_deadline',
    'delay_status', 'arrival_delay_minutes',
    'retractation_renonciation_at', 'retractation_version',
    'tiers_declaration', 'broadcast_sent_at', 'last_validation_reminder_at',
    'invoice_number',
    'contrat_client_signe_at', 'contrat_presta_signe_at',
    'date', 'date_debut', 'date_fin', 'heure_debut',
    'parent_mission_id',
    'facture_contestee_at', 'facture_contestee_motif',
    'end_notif_sent', 'cancelled_at', 'created_at'
  ];
  colonnes text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
    INTO colonnes
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'missions'
    AND NOT (c.column_name = ANY (interdites));

  EXECUTE 'REVOKE UPDATE ON public.missions FROM anon, authenticated';
  IF colonnes IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON public.missions TO authenticated', colonnes);
  END IF;
  RAISE NOTICE 'missions : mise à jour limitée à %', colonnes;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne existe et accepte NULL :
--
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='missions'
--      AND column_name='resolution_montant';
--    -- attendu : 1 ligne, numeric, YES
--
-- 2. Elle n'est pas modifiable depuis le navigateur :
--
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema='public' AND table_name='missions'
--      AND privilege_type='UPDATE' AND grantee='authenticated'
--      AND column_name='resolution_montant';
--    -- attendu : 0 ligne
--
-- 3. La contrainte refuse zéro et le négatif :
--
--    UPDATE public.missions SET resolution_montant = 0 WHERE false;  -- syntaxe
--    -- à éprouver sur une prestation de test uniquement.
--
-- CONTRÔLE DEPUIS LE BACK-OFFICE :
--
--   Proposer un remboursement partiel sur un litige de test, laisser courir le
--   délai d'opposition, et vérifier dans Stripe que le montant remboursé est
--   bien celui qui a été saisi — ni le prix entier, ni zéro.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS resolution_montant;
--
-- Sans risque tant qu'aucune proposition partielle n'est en cours : une
-- colonne absente ramène le comportement au remboursement du prix entier.
-- ═══════════════════════════════════════════════════════════════════════════
