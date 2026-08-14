-- ═══════════════════════════════════════════════════════════════════════════
-- Versement différé à la fermeture de la fenêtre de contestation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'article 17.1 des CGPS accorde au Client quarante-huit heures après la fin
-- de la Prestation pour signaler un problème. Le code, lui, émettait le virement
-- au prestataire À L'INSTANT de la validation par le client.
--
-- Ces quarante-huit heures n'existaient donc pas. Un client qui valide de bonne
-- foi en fin de service, puis constate un défaut l'après-midi même, n'avait plus
-- rien à bloquer : l'argent était parti. Le seul recours restant était
-- l'annulation du virement, qui échoue dès que Stripe a versé les fonds sur le
-- compte bancaire du prestataire.
--
-- Le choix retenu par Alexandre est de différer le versement jusqu'à la
-- fermeture réelle de la fenêtre. Il coûte deux jours d'attente au prestataire ;
-- il rend au client la protection que le contrat lui promet.
--
-- CE QUE STOCKE LA COLONNE
--
-- L'instant à partir duquel le virement devient émissible : fin effective de la
-- prestation + 48 heures. Renseignée à la clôture, quel que soit le chemin —
-- validation par le client, ou validation automatique par le cron.
--
-- NULL sur les prestations clôturées avant cette migration : elles ont déjà été
-- versées, et le traitement les ignore.
--
-- CE QUI DÉCLENCHE LE VIREMENT
--
-- Le cron `cron-reset-monthly?action=reminders`, toutes les deux heures. Il ne
-- retient que les prestations dont `payout_status = 'pending'`, dont
-- `payout_due_at` est échu, et dont le statut est `completed` — un litige les
-- fait passer en `disputed` et les exclut donc automatiquement.
--
-- COMPATIBILITÉ
--
-- Sans cette migration, la colonne est absente : l'écriture échoue, la clôture
-- le signale en erreur, et aucun virement n'est émis. Il faut donc l'appliquer
-- avant de déployer, sous peine de bloquer les paiements aux prestataires.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS payout_due_at timestamptz;

-- Montant exact revenant au prestataire, figé à la clôture.
--
-- Il ne peut pas être recalculé au moment du virement : la clôture applique un
-- plafonnement des heures quand le client n'a jamais arbitré un décalage
-- d'horaire (api/missions.js, `delay_status = 'pending'`), et ce plafonnement
-- n'est pas réécrit dans `actual_hours`. Un traitement différé qui referait le
-- calcul depuis les heures verserait donc PLUS que ce que le client a payé.
--
-- C'est le défaut récurrent du projet : une règle recopiée à un second endroit,
-- qui diverge du premier. On stocke le résultat plutôt que de le refaire.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS payout_amount numeric(10,2);

-- Le traitement interroge les prestations à verser toutes les deux heures :
-- l'index lui évite de parcourir toute la table à chaque passage.
CREATE INDEX IF NOT EXISTS missions_payout_a_verser_idx
  ON public.missions (payout_due_at)
  WHERE payout_status = 'pending';


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne et l'index :
--
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'missions'
--      AND column_name IN ('payout_due_at', 'payout_amount');
--    -- attendu : 2 lignes
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'missions' AND indexname = 'missions_payout_a_verser_idx';
--
-- 2. Une fois des prestations clôturées, les versements en attente :
--
--    SELECT id, date, payout_status, payout_amount, payout_due_at,
--           payout_due_at <= now() AS exigible
--    FROM missions
--    WHERE payout_status = 'pending'
--    ORDER BY payout_due_at;
--
-- 3. Aucune prestation ne doit rester en attente au-delà de quelques heures
--    après son échéance. Si c'est le cas, le cron ne tourne pas :
--
--    SELECT count(*) FROM missions
--    WHERE payout_status = 'pending' AND payout_due_at < now() - interval '6 hours';
--    -- attendu : 0
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS missions_payout_a_verser_idx;
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS payout_due_at;
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS payout_amount;
--
-- Attention : les prestations en attente de versement perdraient leur échéance.
-- Les relever avant, et les verser manuellement depuis le backoffice.
-- ═══════════════════════════════════════════════════════════════════════════
