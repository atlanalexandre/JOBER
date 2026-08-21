-- ═══════════════════════════════════════════════════════════════════════════
-- Prévenir le client AVANT l'annulation automatique
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Une prestation que personne n'accepte est annulée et remboursée à l'heure
-- prévue. Jusqu'ici, le client l'apprenait au moment de l'annulation : il avait
-- réservé, payé, organisé sa journée, et découvrait à 08 h 30 que personne ne
-- viendrait — sans avoir jamais eu l'occasion de s'organiser autrement.
--
-- Un avertissement quelques heures avant ne change rien à la règle, mais change
-- tout pour lui : il peut relancer ailleurs, décaler, ou attendre en connaissant
-- l'échéance.
--
-- CE QUE PORTE LA COLONNE
--
-- `alerte_sans_prestataire_at` — l'instant où cet avertissement a été envoyé.
-- Elle sert uniquement à ne l'envoyer qu'UNE FOIS : le traitement automatique
-- repasse toutes les deux heures, et sans elle le client recevrait la même
-- alerte trois fois avant l'échéance.
--
-- Elle n'est pas modifiable depuis le navigateur : un client pourrait sinon
-- l'effacer et se faire alerter en boucle, ou la remplir pour ne jamais l'être.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS alerte_sans_prestataire_at timestamptz;


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
    'resolution_proposee', 'resolution_motif', 'resolution_montant',
    'resolution_notifiee_at', 'resolution_echeance_at',
    'resolution_opposition_par', 'resolution_opposition_at',
    'resolution_executee_cause',
    'arrived_at', 'started_at', 'acceptance_deadline',
    'delay_status', 'arrival_delay_minutes',
    'retractation_renonciation_at', 'retractation_version',
    'tiers_declaration', 'broadcast_sent_at', 'last_validation_reminder_at',
    -- La nouvelle : elle décide si le client est prévenu, et combien de fois.
    'alerte_sans_prestataire_at',
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
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='missions'
--      AND column_name='alerte_sans_prestataire_at';
--    -- attendu : 1 ligne, timestamp with time zone, YES
--
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema='public' AND table_name='missions'
--      AND privilege_type='UPDATE' AND grantee='authenticated'
--      AND column_name='alerte_sans_prestataire_at';
--    -- attendu : 0 ligne
--
-- CONTRÔLE : publier une prestation pour dans 4 h sans qu'aucun prestataire ne
-- l'accepte. Le client doit recevoir UN avertissement, et un seul, quel que
-- soit le nombre de passages du traitement automatique d'ici l'échéance.
--
-- RETOUR ARRIÈRE :
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS alerte_sans_prestataire_at;
-- ═══════════════════════════════════════════════════════════════════════════
