-- ═══════════════════════════════════════════════════════════════════════════
-- Heures supplémentaires PAR JOURNÉE, et « Modifier la commande »
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DÉCISION D'ALEXANDRE (06/10/2026)
--
-- Sur une prestation de plusieurs jours, une heure supplémentaire porte sur
-- UNE journée — celle en cours. Pour changer le nombre d'heures de plusieurs
-- journées, le client « modifie la commande » : le nouvel horaire s'applique
-- aux journées PAS ENCORE COMMENCÉES, en hausse seulement (une baisse passe
-- par l'annulation et ses règles).
--
-- Jusqu'ici, une prolongation augmentait `hours` (durée PAR JOUR) et était
-- facturée autant de fois que la prestation comptait de jours — y compris
-- les journées déjà faites.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Des colonnes pour retenir la portée de la demande en cours, et ce qui a été
-- ajouté, indépendamment de `hours` :
--   • extra_hours_portee   — 'jour' ou 'commande' : la demande en cours ;
--   • extra_hours_jours    — nombre de journées qu'elle couvre (figé à la
--                            demande, pour que le prix annoncé, payé et appliqué
--                            soit le même) ;
--   • montant_heures_ajoutees     — part du prestataire ajoutée (€, cumul) ;
--   • heures_ajoutees_total       — heures ajoutées, toutes journées (cumul) ;
--   • heures_ajoutees_dernier_jour — heures ajoutées au DERNIER jour : elles
--                            reculent la fin de la prestation, donc l'échéance
--                            du versement ;
--   • heures_ajoutees_detail — le détail, journée par journée :
--                            [{ "jour", "heures", "tarif", "paiement" }]. Une
--                            série arrêtée en cours de route rend au client les
--                            heures ajoutées aux journées qui n'auront pas lieu,
--                            sur le paiement qui les avait réglées.
--
-- COMPATIBILITÉ : colonnes facultatives ou à zéro par défaut. L'ancien code les
-- ignore et continue de fonctionner ; une prestation d'un seul jour garde le
-- chemin actuel (`hours`, `extra_hours_appliquees`).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS extra_hours_portee text,
  ADD COLUMN IF NOT EXISTS extra_hours_jours integer,
  ADD COLUMN IF NOT EXISTS montant_heures_ajoutees numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heures_ajoutees_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heures_ajoutees_dernier_jour numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heures_ajoutees_detail jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_extra_hours_portee_check') THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_extra_hours_portee_check
      CHECK (extra_hours_portee IS NULL OR extra_hours_portee IN ('jour', 'commande'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_extra_hours_jours_check') THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_extra_hours_jours_check
      CHECK (extra_hours_jours IS NULL OR extra_hours_jours > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_heures_ajoutees_positives') THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_heures_ajoutees_positives
      CHECK (montant_heures_ajoutees >= 0 AND heures_ajoutees_total >= 0 AND heures_ajoutees_dernier_jour >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_heures_ajoutees_detail_check') THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_heures_ajoutees_detail_check
      CHECK (jsonb_typeof(heures_ajoutees_detail) = 'array');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — doit renvoyer les six colonnes.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'missions' AND column_name IN ('extra_hours_portee','extra_hours_jours',
--    'montant_heures_ajoutees','heures_ajoutees_total','heures_ajoutees_dernier_jour',
--    'heures_ajoutees_detail');

-- ═══════════════════════════════════════════════════════════════════════════
-- SÉCURITÉ — ce que le navigateur ne peut pas poser à la création
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La table est ouverte en INSERT au navigateur (réservation), pas en UPDATE.
-- `missions_creation_guard` filtrait le prestataire, le statut, le paiement et
-- le pointage, mais rien de ce qui fixe la PART DU PRESTATAIRE à la clôture :
-- un client pouvait créer, depuis la console, une prestation portant déjà
-- `actual_hours = 24` ou « 8 h supplémentaires à 500 €/h ». Il payait le prix
-- de la réservation (recalculé par le serveur), et la clôture versait au
-- prestataire ce qu'il avait écrit — aux frais d'ALANE (relecture du
-- 06/10/2026). Les nouvelles colonnes d'heures ajoutées auraient ouvert le
-- même trou.
--
-- Relevé avant d'ajouter la garde (CLAUDE.md 1.6) : aucune des deux créations
-- de l'application (App.jsx, client-screens.jsx) n'envoie ces colonnes, et
-- leurs valeurs par défaut en base sont nulles ou à zéro.

CREATE OR REPLACE FUNCTION public.missions_creation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  part_horaire numeric;
BEGIN
  -- Seuls les appels venus du NAVIGATEUR sont contrôlés : ceux qui portent le
  -- jeton d'un utilisateur (rôle `authenticated`) ou la clé publique (`anon`).
  -- Les fonctions /api (`service_role`) et l'éditeur SQL (aucun jeton) passent.
  --
  -- On lit le rôle du JETON, jamais `current_user` : la fonction étant
  -- SECURITY DEFINER, `current_user` y vaut toujours son propriétaire,
  -- `postgres` — l'ancienne exemption laissait donc TOUT passer.
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Une prestation ne peut être créée que pour le compte connecté.';
  END IF;

  IF NEW.prestataire_id IS NOT NULL THEN
    RAISE EXCEPTION 'L''affectation d''un prestataire relève du serveur, pas du navigateur.';
  END IF;

  IF COALESCE(NEW.status, 'open') NOT IN ('open', 'pending_acceptance') THEN
    RAISE EXCEPTION 'Statut interdit à la création : %', NEW.status;
  END IF;

  IF NEW.stripe_payment_intent IS NOT NULL THEN
    RAISE EXCEPTION 'Le paiement est rattaché par le serveur.';
  END IF;

  IF NEW.acceptance_deadline IS NOT NULL THEN
    RAISE EXCEPTION 'Le délai d''acceptation est posé par le serveur.';
  END IF;

  IF NEW.started_at IS NOT NULL OR NEW.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Le pointage ne peut pas être antidaté à la création.';
  END IF;

  -- Ce qui fixe la part du prestataire à la clôture (06/10/2026).
  IF NEW.actual_hours IS NOT NULL
     OR COALESCE(NEW.extra_hours_appliquees, 0) <> 0
     OR NEW.extra_hours_tarif IS NOT NULL
     OR NEW.extra_hours_requested IS NOT NULL
     OR NEW.extra_hours_status IS NOT NULL
     OR NEW.extra_hours_payment_intent IS NOT NULL
     OR NEW.extra_hours_portee IS NOT NULL
     OR NEW.extra_hours_jours IS NOT NULL
     OR COALESCE(NEW.montant_heures_ajoutees, 0) <> 0
     OR COALESCE(NEW.heures_ajoutees_total, 0) <> 0
     OR COALESCE(NEW.heures_ajoutees_dernier_jour, 0) <> 0
     OR COALESCE(NEW.heures_ajoutees_detail, '[]'::jsonb) <> '[]'::jsonb
     OR COALESCE(NEW.heures_perdues, 0) <> 0 THEN
    RAISE EXCEPTION 'Les heures effectuées et ajoutées sont fixées par le serveur.';
  END IF;

  IF NEW.payout_amount IS NOT NULL OR NEW.payout_status IS NOT NULL
     OR NEW.payout_due_at IS NOT NULL OR NEW.stripe_transfer_id IS NOT NULL
     OR NEW.invoice_number IS NOT NULL THEN
    RAISE EXCEPTION 'Le versement et la facture sont fixés par le serveur.';
  END IF;

  IF COALESCE(NEW.cashback_applique, 0) <> 0 OR COALESCE(NEW.cashback_debite, false)
     OR NEW.cashback_debite_montant IS NOT NULL THEN
    RAISE EXCEPTION 'Le cashback est appliqué par le serveur.';
  END IF;

  -- Cohérence du montant : les frais de service ne peuvent pas être négatifs.
  -- Volontairement une borne basse et non le calcul exact du tarif — reproduire
  -- la grille tarifaire ici finirait par diverger du tunnel de réservation et
  -- bloquerait des réservations légitimes.
  part_horaire := COALESCE(NEW.tarif_horaire, 0) * COALESCE(NEW.hours, 0);
  IF NEW.montant_total IS NOT NULL AND part_horaire > 0
     AND NEW.montant_total < part_horaire - 0.01 THEN
    RAISE EXCEPTION 'Montant total (%) inférieur à la part horaire (%).',
      NEW.montant_total, part_horaire;
  END IF;

  RETURN NEW;
END;
$function$;

-- VÉRIFICATION (navigateur) : une création avec `actual_hours` doit être
-- refusée — essai e2e/12 (verrou de création) et e2e/70.
