-- ═══════════════════════════════════════════════════════════════════════════
-- Le tarif des heures supplémentaires doit suivre jusqu'au versement
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Constaté le 18/08/2026, au premier parcours complet de la prolongation
-- payante. Le prestataire annonce 17 €/h pour une heure supplémentaire, le
-- client règle 17,34 €, la durée passe à 2 h — et le versement est calculé
-- 15 € × 2 h = 30 €, sur le seul `tarif_horaire`.
--
-- Le prestataire perd exactement l'écart de tarif × heures ajoutées, et ALANE
-- retient d'autant plus de frais de service qu'elle n'a pas encaissés. Sur cet
-- exemple : 2 € pris au prestataire, et des frais qui paraissent valoir 7,54 €
-- alors que 5,54 € seulement ont été perçus.
--
-- La cause est un raccourci : la confirmation augmentait `hours` sans conserver
-- COMBIEN d'heures relèvent du tarif négocié. `extra_hours_tarif` existait,
-- mais plus rien ne savait à quelle part des heures l'appliquer.
--
-- CE QUE PORTE LA COLONNE
--
-- `extra_hours_appliquees` — le nombre d'heures effectivement ajoutées et
-- réglées, cumulé si le client prolonge plusieurs fois. Avec
-- `extra_hours_tarif`, elle permet de scinder la durée en deux :
--
--     part = (heures − supplément) × tarif_horaire
--          +  supplément           × extra_hours_tarif
--
-- Le calcul vit dans `api/_cloture.js` (`partHoraire`), appelé par la clôture,
-- par la facture et recopié à l'identique dans l'écran prestataire — trois
-- endroits qui affichaient jusqu'ici trois montants différents du vrai.
--
-- POURQUOI PAS UN TARIF MOYEN
--
-- Écrire un tarif pondéré dans `tarif_horaire` aurait été plus court, et aurait
-- effacé le prix convenu à la commande. La facture du prestataire doit pouvoir
-- montrer les deux lignes : ce qui a été commandé, et ce qui a été prolongé. Un
-- tarif moyen ne se justifie devant personne.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS extra_hours_appliquees numeric NOT NULL DEFAULT 0;

ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_extra_hours_appliquees_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_extra_hours_appliquees_check
  CHECK (extra_hours_appliquees >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- Les droits d'écriture, rejoués avec la nouvelle colonne
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Elle décide de ce qui est versé : le navigateur n'a pas à pouvoir l'écrire.

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
    'extra_hours_payment_intent', 'extra_hours_appliquees',
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
-- LA PRESTATION DÉJÀ PROLONGÉE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une prolongation a été réglée le 18/08/2026 AVANT cette migration : sa durée
-- est passée à 2 h mais rien ne dit qu'une heure relève du tarif négocié. À
-- rattraper, faute de quoi le prestataire sera payé 30 € au lieu de 32 €.
--
--    SELECT id, hours, tarif_horaire, extra_hours_tarif, extra_hours_appliquees
--    FROM missions
--    WHERE extra_hours_status = 'accepted' AND extra_hours_appliquees = 0;
--
-- Pour chaque ligne, inscrire le nombre d'heures qui ont été ajoutées :
--
--    UPDATE missions SET extra_hours_appliquees = 1 WHERE id = '<identifiant>';
--
-- Fait à la main et non en masse : le nombre d'heures ajoutées ne se déduit
-- d'aucune colonne survivante — `extra_hours_requested` est remis à NULL à la
-- confirmation.
--
-- ATTENTION — le 18/08/2026, un rattrapage écrit `WHERE extra_hours_status =
-- 'accepted'` a touché TROIS prestations au lieu d'une. Deux relevaient de
-- l'ancien mécanisme, où l'acceptation ajoutait les heures au tarif de la
-- commande, sans tarif négocié. Elles portaient donc `extra_hours_appliquees = 1`
-- pour une prolongation dont personne ne connaît la durée réelle.
--
-- Sans conséquence sur l'argent — `partHoraire` retombe sur `tarif_horaire`
-- quand `extra_hours_tarif` est absent — mais c'est une donnée fausse, et une
-- donnée fausse finit toujours par être lue. À remettre à zéro :
--
--    UPDATE missions SET extra_hours_appliquees = 0
--    WHERE extra_hours_tarif IS NULL;
--
-- La leçon : ne cibler un rattrapage que sur les lignes dont on sait ce
-- qu'elles contiennent. `extra_hours_tarif IS NOT NULL` était le bon filtre.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT id, hours, tarif_horaire, extra_hours_tarif, extra_hours_appliquees,
--           (hours - extra_hours_appliquees) * tarif_horaire
--             + extra_hours_appliquees * COALESCE(extra_hours_tarif, tarif_horaire)
--             AS part_prestataire
--    FROM missions WHERE extra_hours_status = 'accepted';
--
-- Sur la prestation du 18/08 : 32,00 € attendus, et non 30,00 €.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS extra_hours_appliquees;
--
-- À n'accompagner que du retour arrière du code : sans elle, le calcul de la
-- part du prestataire retombe sur `tarif_horaire` seul, donc sur le défaut que
-- cette migration corrige.
-- ═══════════════════════════════════════════════════════════════════════════
