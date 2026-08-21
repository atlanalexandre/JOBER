-- ═══════════════════════════════════════════════════════════════════════════
-- Litige : pouvoir ACCEPTER une proposition, et pas seulement s'y opposer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'écran ne proposait qu'un bouton : « Je m'oppose à cette proposition ».
-- Accepter consistait à ne rien faire pendant 48 heures.
--
-- Trois défauts. Celui qui est d'accord n'a aucun moyen de le dire, et attend
-- deux jours pour un dénouement que les deux parties souhaitent. L'écran est
-- déséquilibré : un seul bouton, rouge, qui pousse au conflit. Et l'accord de
-- l'article 17.1 se déduit d'un silence, alors qu'un accord exprès est
-- infiniment plus solide à produire.
--
-- CE QUE PORTENT LES DEUX COLONNES
--
-- `resolution_acceptation_client_at`      — le client a accepté, et quand.
-- `resolution_acceptation_prestataire_at` — le prestataire a accepté, et quand.
--
-- Une seule acceptation ne dénoue rien : l'article 17.1 exige l'accord DES
-- PARTIES. Elle est enregistrée, l'autre partie en est informée, et le délai
-- continue de courir normalement.
--
-- Lorsque les DEUX ont accepté, l'accord est formé avant l'échéance :
-- `resolution_echeance_at` est ramenée à l'instant présent, et le traitement
-- automatique exécute la proposition à son passage suivant. Aucune logique
-- d'exécution n'est dupliquée — c'est le même chemin que l'accord tacite, ce
-- qui évite d'avoir deux façons de faire bouger l'argent.
--
-- POURQUOI ELLES NE SONT PAS MODIFIABLES DEPUIS LE NAVIGATEUR
--
-- Elles décident du déblocage des fonds. Modifiables, une partie pourrait
-- inscrire l'acceptation de l'AUTRE et emporter seule le dénouement. L'écriture
-- passe donc par `/api`, qui vérifie l'identité de l'appelant.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS resolution_acceptation_client_at      timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_acceptation_prestataire_at timestamptz;


-- ═══════════════════════════════════════════════════════════════════════════
-- Les droits d'écriture, rejoués avec les deux nouvelles colonnes
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
    -- Les nouvelles : elles décident du déblocage des fonds.
    'resolution_acceptation_client_at', 'resolution_acceptation_prestataire_at',
    'arrived_at', 'started_at', 'acceptance_deadline',
    'delay_status', 'arrival_delay_minutes',
    'retractation_renonciation_at', 'retractation_version',
    'tiers_declaration', 'broadcast_sent_at', 'last_validation_reminder_at',
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
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='missions'
--      AND column_name LIKE 'resolution_acceptation%';
--    -- attendu : 2 lignes
--
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema='public' AND table_name='missions'
--      AND privilege_type='UPDATE' AND grantee='authenticated'
--      AND column_name LIKE 'resolution_acceptation%';
--    -- attendu : 0 ligne
--
-- CONTRÔLE DEPUIS L'APPLICATION :
--
--   1. accepter côté client seul → l'écran indique que l'autre partie n'a pas
--      encore répondu, et le délai continue de courir ;
--   2. accepter ensuite côté prestataire → `resolution_echeance_at` tombe à
--      l'instant présent, et la proposition s'exécute au passage suivant du
--      traitement automatique (moins de deux heures) ;
--   3. s'opposer APRÈS avoir accepté → refusé : l'acceptation est définitive,
--      c'est ce qui lui donne sa valeur.
--
-- RETOUR ARRIÈRE :
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS resolution_acceptation_client_at,
--      DROP COLUMN IF EXISTS resolution_acceptation_prestataire_at;
-- ═══════════════════════════════════════════════════════════════════════════
