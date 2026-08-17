-- ═══════════════════════════════════════════════════════════════════════════
-- Colonnes non modifiables — ce que le premier passage avait laissé
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le relevé de ce qui restait modifiable après
-- `2026-08-17_colonnes_non_modifiables.sql` a montré que trois familles de
-- colonnes avaient été oubliées. La première migration visait l'argent et les
-- droits ; celle-ci vise la PREUVE et les DATES.
--
-- `invoice_number` — le numéro de facture.
--
--   `api/invoice.js` le décrit lui-même : « numérotation continue, sans
--   rupture, et un numéro qui identifie durablement la facture ». C'est une
--   obligation, pas une convention (article 289 du Code général des impôts).
--
--   Il était réécrivable depuis le navigateur, par le client comme par le
--   prestataire. Un numéro modifié après coup, c'est une facture dont la
--   séquence ne prouve plus rien — et le mandat de facturation qu'ALANE exerce
--   au nom du prestataire repose entièrement sur cette séquence.
--
-- `contrat_client_signe_at` / `contrat_presta_signe_at` — les signatures.
--
--   L'article 11 du contrat de prestation leur donne la valeur d'une signature
--   manuscrite (règlement eIDAS, article 1366 du Code civil). Ces deux dates
--   SONT la signature : il n'y a rien d'autre.
--
--   Chaque partie pouvait donc effacer la sienne — « je n'ai jamais signé » —
--   ou inscrire celle de l'autre. Une preuve que l'intéressé peut réécrire
--   n'est pas une preuve.
--
-- `date`, `date_debut`, `date_fin`, `heure_debut` — l'horaire.
--
--   Tout le reste en dépend : la fenêtre de pointage, celle des heures
--   supplémentaires, le délai de réclamation, l'échéance de versement calculée
--   à la clôture. Déplacer la date d'une prestation déjà réservée, c'est
--   déplacer toutes ces bornes d'un coup, sans que l'autre partie en sache
--   rien.
--
--   La création n'est pas concernée : elle relève de l'INSERT, laissé intact.
--   Un changement de date après réservation est une modification du contrat, et
--   passe donc par le serveur.
--
-- `parent_mission_id` — le rattachement d'une prestation à une autre, écrit
--   uniquement par /api lors d'un remplacement.
--
-- CE QUI RESTE VOLONTAIREMENT MODIFIABLE
--
-- `validation_client` et `validation_prestataire` : l'écran de validation les
-- écrit directement (`persistValidation`), en même temps que les notes et
-- commentaires. Les fermer casserait ce geste. Elles ne déplacent pas d'argent
-- par elles-mêmes — c'est l'action `complete` de /api qui programme le
-- versement, et elle refait ses propres contrôles.
--
-- À reprendre le jour où cet écran passera par /api comme le reste.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  interdites text[] := ARRAY[
    -- Déjà fermées au premier passage, reprises ici pour que ce fichier soit
    -- lisible seul : rejouer la liste complète est sans effet de bord.
    'id', 'client_id', 'prestataire_id', 'status',
    'montant_total', 'tarif_horaire', 'hours', 'actual_hours',
    'payout_status', 'payout_amount', 'payout_due_at',
    'payout_hold_reason', 'payout_hold_at', 'payout_hold_until',
    'payout_compensation', 'stripe_payment_intent', 'stripe_transfer_id',
    'cashback_credited', 'cancellation_reason',
    'extra_hours_requested', 'extra_hours_status', 'extra_hours_tarif',
    'extra_hours_payment_intent',
    'resolution_proposee', 'resolution_motif', 'resolution_notifiee_at',
    'resolution_echeance_at', 'resolution_opposition_par',
    'resolution_opposition_at', 'resolution_executee_cause',
    'arrived_at', 'started_at', 'acceptance_deadline',
    'delay_status', 'arrival_delay_minutes',
    'retractation_renonciation_at', 'retractation_version',
    'tiers_declaration', 'broadcast_sent_at', 'last_validation_reminder_at',
    -- Nouvelles : la preuve et les dates.
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
--    SELECT string_agg(column_name, ', ' ORDER BY column_name) AS modifiables
--    FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'missions'
--      AND privilege_type = 'UPDATE' AND grantee = 'authenticated';
--
-- Attendu, et rien de plus : adresse, client_comment, client_nom,
-- client_rating, description, metier, nb_heures, presta_comment, presta_rating,
-- recurrence, sector, stripe_transfer_id_col, titre, validation_client,
-- validation_prestataire, ville.
--
-- Contrôle applicatif : valider une prestation terminée en laissant une note et
-- un commentaire. C'est le seul geste qui écrit encore dans `missions` depuis
-- le navigateur.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DEUX COLONNES À EXAMINER, HORS SUJET DE CETTE MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le relevé a fait apparaître `nb_heures` et `stripe_transfer_id_col`.
-- AUCUNE des deux n'est référencée nulle part — ni dans `api/`, ni dans `src/`,
-- ni dans la documentation.
--
-- `nb_heures` ressemble à un ancien nom de `hours`, et `stripe_transfer_id_col`
-- à une colonne créée par erreur à côté de `stripe_transfer_id`. Deux colonnes
-- mortes, donc, dont l'une porte un nom si proche d'une colonne vivante qu'elle
-- finira par être écrite à sa place.
--
-- Vérifier avant de supprimer :
--
--    SELECT count(*) FILTER (WHERE nb_heures IS NOT NULL)             AS nb_heures_remplies,
--           count(*) FILTER (WHERE stripe_transfer_id_col IS NOT NULL) AS transfer_col_remplies
--    FROM missions;
--    -- attendu : 0 et 0
--
-- Si les deux comptes sont nuls :
--
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS nb_heures,
--      DROP COLUMN IF EXISTS stripe_transfer_id_col;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    GRANT UPDATE ON public.missions TO authenticated;
--
-- Rouvre tout, numéro de facture et signatures compris.
-- ═══════════════════════════════════════════════════════════════════════════
