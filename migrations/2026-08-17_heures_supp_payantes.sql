-- ═══════════════════════════════════════════════════════════════════════════
-- Heures supplémentaires : tarif annoncé, et paiement avant effet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Les heures supplémentaires n'étaient facturées à personne. Le client
-- demandait, le prestataire acceptait, et le code augmentait simplement
-- `hours`. Aucun paiement complémentaire n'était réclamé.
--
-- À la clôture, la part du prestataire se calcule depuis les heures, et les
-- frais de service depuis ce qui reste du montant encaissé. Avec des heures
-- gonflées et un encaissement inchangé, les deux dérivent ensemble :
--
--   1 h à 15 €/h, client débité 19,90 € (15 € + 4,90 € de frais)
--   → +1 h acceptée
--   → dû au prestataire 30,00 €, frais de service 0,00 €
--   → ALANE verse 30 € pour 19,90 € encaissés.
--
-- Dix euros dix de perte sur une heure. Plus de cinquante sur une prestation
-- de 8 h prolongée de 2 h à 25 €/h.
--
-- CE QUE STOCKENT CES COLONNES
--
-- `extra_hours_tarif` — le tarif horaire que le PRESTATAIRE annonce pour la
-- prolongation. Il fixe librement son prix (CGPS art. 6.1), et une prolongation
-- qu'il n'avait pas prévue n'a pas de raison d'être vendue au tarif d'un
-- créneau réservé à l'avance. Le tarif de la prestation initiale reste dans
-- `tarif_horaire` : les deux coexistent, et la facture doit pouvoir les
-- distinguer.
--
-- `extra_hours_payment_intent` — le paiement du complément. C'est lui qui fait
-- basculer la prolongation : tant qu'il n'est pas confirmé auprès de Stripe,
-- `hours` n'est pas touché. Le conserver permet de vérifier a posteriori, et
-- d'empêcher qu'un même paiement serve deux fois.
--
-- LE NOUVEL ÉTAT
--
-- `extra_hours_status` gagne la valeur `accepte_presta` : le prestataire a
-- accepté et annoncé son tarif, le client n'a pas encore payé. C'est l'état où
-- rien ne s'applique — ni durée, ni montant.
--
--   pending         le client a demandé, le prestataire n'a pas répondu
--   accepte_presta  accepté et chiffré, en attente du paiement du client
--   accepted        payé et appliqué
--   refused         refusé par le prestataire
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS extra_hours_tarif          numeric(10,2),
  ADD COLUMN IF NOT EXISTS extra_hours_payment_intent text;

-- Un même paiement ne peut valoir que pour une prolongation.
CREATE UNIQUE INDEX IF NOT EXISTS missions_extra_hours_pi_idx
  ON public.missions (extra_hours_payment_intent)
  WHERE extra_hours_payment_intent IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions' AND column_name LIKE 'extra_hours%';
--    -- attendu : 4 lignes (requested, status, tarif, payment_intent)
--
-- Les prolongations en attente de paiement, et depuis quand :
--
--    SELECT id, date, extra_hours_requested, extra_hours_tarif, extra_hours_status
--    FROM missions WHERE extra_hours_status = 'accepte_presta'
--    ORDER BY date;
--
-- Les prestations dont la durée dépasse ce qui a été encaissé — le symptôme du
-- défaut ci-dessus, sur les prolongations acceptées AVANT cette correction :
--
--    SELECT id, date, hours, tarif_horaire, montant_total,
--           ROUND(hours * tarif_horaire, 2) AS du_prestataire
--    FROM missions
--    WHERE tarif_horaire IS NOT NULL AND montant_total IS NOT NULL
--      AND hours * tarif_horaire > montant_total
--    ORDER BY date;
--    -- attendu : 0 ligne. Toute ligne est une prestation où ALANE verse plus
--    -- qu'elle n'a encaissé.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS missions_extra_hours_pi_idx;
--    ALTER TABLE public.missions
--      DROP COLUMN IF EXISTS extra_hours_tarif,
--      DROP COLUMN IF EXISTS extra_hours_payment_intent;
--
-- Attention : sans ces colonnes, l'acceptation d'une prolongation échoue —
-- ce qui vaut mieux que de la voir s'appliquer sans paiement, mais bloque la
-- fonctionnalité. Ne le faire qu'en retirant le code correspondant.
-- ═══════════════════════════════════════════════════════════════════════════
