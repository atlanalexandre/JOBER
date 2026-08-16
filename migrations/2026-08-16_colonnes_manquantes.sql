-- ═══════════════════════════════════════════════════════════════════════════
-- Six colonnes écrites par le code et absentes de la base
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Relevées le 16/08/2026 par `npm run colonnes`, écrit après la découverte de
-- `missions.cancellation_reason` — même famille, même cause, mais celles-ci
-- coûtent beaucoup plus cher.
--
-- PostgREST refuse l'INTÉGRALITÉ d'une requête qui mentionne une colonne
-- inconnue. Une écriture qui en contient une n'échoue donc pas « à moitié » :
-- elle n'écrit rien du tout.
--
-- CE QUE CHACUNE CASSAIT
--
-- `missions.payout_amount` et `missions.payout_due_at` — le versement différé
-- de 48 h, en place depuis le 12/08. Elles étaient déclarées dans
-- `2026-08-12_versement_differe_48h.sql`, qui n'a donc pas été appliqué en
-- entier : `payout_status` existe, ces deux-là non.
--
--   • à la validation par le client, la mise en attente du versement échoue.
--     Le code le journalise en erreur, mais AUCUN virement n'est jamais
--     programmé : le prestataire n'est pas payé, et rien ne le rattrape ;
--   • à l'auto-validation, c'est pire. Les deux colonnes sont écrites dans le
--     MÊME PATCH que `status = 'completed'`. Toute l'écriture échoue, donc la
--     prestation n'est même pas clôturée : elle reste `assigned` indéfiniment.
--
-- Depuis le 12/08, aucune prestation n'a donc été auto-validée, et aucune
-- rémunération n'a été programmée.
--
-- `missions.cashback_credited` — le garde-fou d'idempotence du cashback, écrit
-- dans ce même PATCH d'auto-validation. Il tombait avec lui.
--
-- `missions.last_validation_reminder_at` — l'horodatage qui empêche de
-- relancer le même client toutes les deux heures. L'écriture échouant, la
-- relance repartait à chaque passage du traitement.
--
-- `missions.broadcast_sent_at` — la remise à zéro de la diffusion lorsqu'une
-- prestation repart en recherche de prestataire.
--
-- `bo_logs.details` — le détail des actions du backoffice. Toute
-- journalisation qui en comportait échouait, en silence : `journaliser()`
-- n'attrape que les erreurs réseau, et un refus de PostgREST n'en est pas une.
-- Les actions les plus sensibles sont précisément celles qui transportent un
-- `details` — la justification d'une exécution de litige sans accord des
-- parties, le motif d'une suspension. Aucune n'était conservée.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bo_logs
  ADD COLUMN IF NOT EXISTS details jsonb;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS payout_amount               numeric(10,2),
  ADD COLUMN IF NOT EXISTS payout_due_at               timestamptz,
  ADD COLUMN IF NOT EXISTS cashback_credited           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_validation_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS broadcast_sent_at           timestamptz;

-- Le traitement des versements interroge les prestations dues toutes les deux
-- heures. L'index vient du fichier du 12/08, qui n'a pas été appliqué.
CREATE INDEX IF NOT EXISTS missions_payout_a_verser_idx
  ON public.missions (payout_due_at)
  WHERE payout_due_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Relancer `npm run colonnes` et repasser la requête produite : attendu 0 ligne.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CE QUE LA MIGRATION NE RÉPARE PAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Les colonnes existent désormais, mais les prestations traitées PENDANT la
-- panne restent en l'état. Deux populations à reprendre à la main.
--
-- 1. Les prestations clôturées sans versement programmé — le prestataire
--    attend un virement qui ne partira jamais :
--
--       SELECT id, date, prestataire_id, montant_total, tarif_horaire,
--              COALESCE(actual_hours, hours) AS heures
--       FROM missions
--       WHERE status = 'completed' AND payout_status IS NULL
--       ORDER BY date;
--
-- 2. Les prestations jamais auto-validées, restées `assigned` alors que leur
--    date est passée :
--
--       SELECT id, date, heure_debut, status, validation_prestataire,
--              validation_client, montant_total
--       FROM missions
--       WHERE status = 'assigned' AND date < current_date
--       ORDER BY date;
--
-- Ces deux listes se traitent depuis le backoffice — écran « Prestations »,
-- puis « Versements » — et non par un UPDATE : le montant dû au prestataire
-- dépend d'un plafonnement des heures que seul le code sait appliquer
-- (`montantsDeCloture`). Le recalculer en SQL en ferait une seconde version,
-- qui divergerait de la première.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS missions_payout_a_verser_idx;
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS payout_amount,
--      DROP COLUMN IF EXISTS payout_due_at,
--      DROP COLUMN IF EXISTS cashback_credited,
--      DROP COLUMN IF EXISTS last_validation_reminder_at,
--      DROP COLUMN IF EXISTS broadcast_sent_at;
--    ALTER TABLE public.bo_logs DROP COLUMN IF EXISTS details;
--
-- Ne le faire qu'en retirant le code correspondant : sans ces colonnes, les
-- écritures échouent de nouveau, et de nouveau sans bruit.
-- ═══════════════════════════════════════════════════════════════════════════
