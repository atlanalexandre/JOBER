-- ═══════════════════════════════════════════════════════════════════════════
-- Ce que le navigateur n'a pas à pouvoir modifier
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le relevé des écritures autorisées, le 17/08/2026, montre trois règles de
-- mise à jour sans AUCUNE restriction de colonne :
--
--   missions  | missions_update  | UPDATE | {public}
--             | USING (client_id = auth.uid() OR prestataire_id = auth.uid())
--   profiles  | profiles_update  | UPDATE | {authenticated}
--             | USING (auth.uid() = id)
--   documents | docs_update      | UPDATE | {authenticated}
--             | USING (auth.uid() = prestataire_id)
--
-- Ces règles décident correctement QUELLES LIGNES chacun peut modifier : les
-- siennes. Elles ne disent rien de QUELLES COLONNES — et c'est là que tout se
-- joue, parce qu'une ligne « à soi » contient aussi ce qu'on se doit à
-- soi-même.
--
-- CE QUE ÇA PERMETTAIT
--
-- Sur `missions`, un prestataire assigné pouvait écrire :
--
--   payout_amount = 9999, payout_status = 'pending',
--   payout_due_at = <hier>, status = 'completed'
--
-- Le traitement des versements, qui tourne toutes les deux heures, lit
-- exactement ces colonnes et vire `payout_amount`. C'est un chemin direct vers
-- un virement de montant choisi.
--
-- Un client pouvait, symétriquement, réécrire `montant_total`, `hours` ou
-- `actual_hours` — donc le prix de la prestation et ce qui reste de frais de
-- service après la clôture.
--
-- Sur `profiles`, chacun pouvait s'accorder :
--
--   plan_abonnement = 'elite'   → prestations illimitées, sans payer
--   missions_enabled = true     → accès aux prestations sans vérification
--   status = 'approved'         → compte validé sans passer par le backoffice
--   cashback_balance = 500      → de l'argent
--
-- Sur `documents`, un prestataire pouvait passer ses propres pièces à
-- `verified = true` : le badge « vérifié » sans qu'aucune pièce ait été
-- regardée. C'est l'obligation de vigilance qui tombe, pas seulement un badge.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Elle ne touche pas aux règles : les lignes restent les bonnes. Elle retire
-- l'écriture sur les colonnes qui ne regardent que le serveur.
--
-- La méthode est volontairement INVERSE d'une liste blanche : on autorise
-- toutes les colonnes de la table SAUF celles nommées ci-dessous. Une liste
-- blanche écrite à la main aurait cassé la première écriture légitime oubliée —
-- et il y en a beaucoup, réparties dans l'inscription, l'édition de profil, le
-- dépôt de documents. L'inventaire vient d'`information_schema`, donc de la
-- base elle-même, jamais d'une liste recopiée qui divergerait.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  cible record;
  colonnes text;
BEGIN
  FOR cible IN
    SELECT * FROM (VALUES
      -- Tout ce qui décide d'un mouvement d'argent ou d'un état de la
      -- prestation. Le reste — description, adresse — n'a pas d'enjeu.
      ('missions', ARRAY[
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
        'tiers_declaration', 'broadcast_sent_at', 'last_validation_reminder_at'
      ]),
      -- Les droits, l'argent et l'identité vérifiée. Prénom, nom, adresse,
      -- IBAN, SIRET restent modifiables : ce sont ses propres données.
      ('profiles', ARRAY[
        'id', 'role', 'status', 'plan_abonnement', 'missions_enabled',
        'cashback_balance', 'prepaid_balance', 'trial_exhausted',
        'missions_completed_month', 'docs_verified',
        'stripe_customer_id', 'stripe_account_id', 'stripe_account_status',
        'stripe_subscription_id', 'subscription_end_date',
        'referral_count', 'referral_rewards_granted', 'referred_by',
        'resiliation_prevue_at', 'resiliation_motif', 'resiliation_notifiee_at',
        'mandat_facturation_at', 'mandat_facturation_version',
        'mandat_encaissement_at', 'mandat_encaissement_version',
        'contrat_cadre_pro', 'rc_pro_relance_at', 'recapitulatif_annuel_at'
      ]),
      -- La vérification d'une pièce appartient au backoffice, jamais à celui
      -- qui la dépose.
      ('documents', ARRAY[
        'id', 'prestataire_id', 'verified', 'verified_at',
        'expires_at', 'purged_at'
      ])
    ) AS t(nom, interdites)
  LOOP
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
      INTO colonnes
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = cible.nom
      AND NOT (c.column_name = ANY (cible.interdites));

    EXECUTE format('REVOKE UPDATE ON public.%I FROM anon, authenticated', cible.nom);
    IF colonnes IS NOT NULL THEN
      EXECUTE format('GRANT UPDATE (%s) ON public.%I TO authenticated', colonnes, cible.nom);
    END IF;
    RAISE NOTICE '% : mise à jour limitée à %', cible.nom, colonnes;
  END LOOP;
END $$;

-- Doublon relevé au passage : deux règles d'insertion identiques sur
-- `documents`. Une règle en double est une règle que personne ne relit.
DROP POLICY IF EXISTS "Users insert own documents" ON public.documents;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Les colonnes que le navigateur peut encore écrire :
--
--    SELECT table_name, string_agg(column_name, ', ' ORDER BY column_name)
--    FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND privilege_type = 'UPDATE'
--      AND grantee = 'authenticated'
--      AND table_name IN ('missions', 'profiles', 'documents')
--    GROUP BY table_name;
--
-- Aucune des colonnes listées plus haut ne doit y figurer. En particulier :
-- ni `payout_amount`, ni `plan_abonnement`, ni `verified`.
--
-- CONTRÔLES DEPUIS L'APPLICATION — à faire dans cet ordre :
--
--   1. modifier son prénom dans le profil client → doit fonctionner ;
--   2. modifier ses informations dans le profil prestataire (SIRET, IBAN,
--      numéro fiscal) → doit fonctionner ;
--   3. déposer un document → doit fonctionner, et rester « en attente » ;
--   4. créer une réservation → doit fonctionner ;
--   5. valider une prestation terminée → doit fonctionner.
--
-- Si l'un de ces gestes échoue, une colonne légitime a été exclue par erreur :
-- la console du navigateur nomme laquelle, il suffit de la retirer de la liste
-- correspondante et de repasser le bloc.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    GRANT UPDATE ON public.missions, public.profiles, public.documents
--      TO authenticated;
--
-- Cela rouvre tout, y compris `payout_amount` et `plan_abonnement`. À ne faire
-- que le temps de diagnostiquer un blocage, jamais durablement.
-- ═══════════════════════════════════════════════════════════════════════════
