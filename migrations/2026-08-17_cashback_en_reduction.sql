-- ═══════════════════════════════════════════════════════════════════════════
-- Le cashback devient dépensable : réduction sur le paiement par carte
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le cashback était crédité, affiché dans l'espace client, et dépensable nulle
-- part. Le seul code qui le consommait était `pay_mission` — le paiement depuis
-- le portefeuille — devenu inatteignable à la fermeture du portefeuille le
-- 16/08/2026.
--
-- L'article 5B.1 des CGPS promet pourtant « un crédit utilisable pour le
-- paiement total ou partiel de futures Prestations ». Promesse écrite, jamais
-- implémentée : le défaut ne se voit pas, et se découvre le jour où un client
-- la réclame.
--
-- CE QUE PORTENT LES DEUX COLONNES
--
-- `cashback_applique` — la part du prix réglée en cashback, en euros.
-- `cashback_debite`   — le solde du client a-t-il réellement été prélevé.
--
-- La seconde n'est pas une redondance de la première. Entre la création de
-- l'intention de paiement et sa confirmation, `cashback_applique` porte une
-- réduction PROMISE que rien n'a encore consommée : un client qui abandonne son
-- panier ne doit rien perdre. `cashback_debite` distingue les deux états, et
-- c'est lui qui rend le débit idempotent — `assign_after_payment` et le webhook
-- Stripe constatent tous deux le même paiement.
--
-- POURQUOI NE PAS SIMPLEMENT BAISSER `montant_total`
--
-- Parce que sept traitements le lisent comme le PRIX de la prestation : la
-- facture du prestataire, le calcul des frais de service, le cashback de la
-- prestation suivante, le chiffre d'affaires du backoffice, le plafond de
-- remboursement, la vérification de cohérence du montant, et la clôture.
--
-- Une remise commerciale consentie par ALANE serait devenue une baisse du prix
-- de vente : le prestataire aurait été payé moins, et les frais de service
-- auraient paru incohérents au contrôle de `_montant.js`.
--
-- Le prix reste le prix. Ce que la carte a supporté est la différence :
--
--     montant_total − cashback_applique
--
-- et c'est cette différence, et elle seule, qui borne un remboursement. Rendre
-- plus que ce qui a été prélevé est refusé par Stripe — après l'annulation de
-- la prestation, ce qui laisserait le client sans prestation et sans argent.
--
-- POURQUOI CES COLONNES NE SONT PAS MODIFIABLES DEPUIS LE NAVIGATEUR
--
-- `cashback_applique` détermine ce que le client paie. Modifiable, elle
-- permettrait de fixer soi-même sa réduction. Elle rejoint donc la liste des
-- colonnes retirées à `authenticated` par
-- `2026-08-17_colonnes_non_modifiables.sql`, dont ce fichier rejoue le bloc
-- complet — l'inventaire venant d'`information_schema`, le rejouer est sans
-- effet de bord.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS cashback_applique numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_debite   boolean NOT NULL DEFAULT false;

-- Une réduction négative rendrait le paiement supérieur au prix. Une réduction
-- sans prestation n'a pas de sens non plus, mais le prix n'est pas connu de
-- cette contrainte : la borne haute est vérifiée par `reductionCashback()`.
ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_cashback_applique_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_cashback_applique_check CHECK (cashback_applique >= 0);


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
    -- Les nouvelles : elles décident de ce que le client paie.
    'cashback_applique', 'cashback_debite',
    'extra_hours_requested', 'extra_hours_status', 'extra_hours_tarif',
    'extra_hours_payment_intent',
    'resolution_proposee', 'resolution_motif', 'resolution_notifiee_at',
    'resolution_echeance_at', 'resolution_opposition_par',
    'resolution_opposition_at', 'resolution_executee_cause',
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
-- 1. Les colonnes existent :
--
--    SELECT column_name, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'missions'
--      AND column_name IN ('cashback_applique', 'cashback_debite');
--    -- attendu : 2 lignes, defaults 0 et false
--
-- 2. Elles ne sont pas modifiables depuis le navigateur :
--
--    SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'missions'
--      AND privilege_type = 'UPDATE' AND grantee = 'authenticated'
--      AND column_name IN ('cashback_applique', 'cashback_debite');
--    -- attendu : 0 ligne
--
-- 3. Après une réservation par un client ayant du cashback :
--
--    SELECT id, montant_total, cashback_applique, cashback_debite,
--           montant_total - cashback_applique AS preleve_sur_la_carte
--    FROM missions ORDER BY created_at DESC LIMIT 3;
--
--    `preleve_sur_la_carte` doit correspondre au montant vu dans Stripe.
--
-- CONTRÔLES DEPUIS L'APPLICATION :
--
--   1. avec un solde de cashback nul → le tunnel ne montre aucune réduction et
--      le montant payé est inchangé ;
--   2. avec un solde non nul → la réduction s'affiche au récapitulatif, le
--      montant Stripe est diminué d'autant, et le solde tombe APRÈS le paiement,
--      pas avant ;
--   3. abandonner le tunnel après avoir vu la réduction, puis rouvrir son
--      espace → le solde doit être INTACT. C'est le contrôle le plus important :
--      il vérifie que rien n'est débité tant que le paiement n'a pas abouti.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS cashback_applique,
--      DROP COLUMN IF EXISTS cashback_debite;
--
-- À ne faire qu'accompagné du retour arrière du code : sans ces colonnes,
-- `stripe-intent` ne peut plus calculer de réduction, et les prestations déjà
-- payées perdraient la trace de ce qui a été réglé en cashback — donc le
-- plafond de leurs remboursements.
-- ═══════════════════════════════════════════════════════════════════════════
