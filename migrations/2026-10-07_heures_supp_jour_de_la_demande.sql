-- ═══════════════════════════════════════════════════════════════════════════
-- Heures supplémentaires : le JOUR de la demande est retenu (relecture du 07/10/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sur une prestation de plusieurs jours, des heures supplémentaires valent
-- pour la journée EN COURS au moment de la demande. Rien ne retenait ce jour :
-- au paiement, le serveur le recalculait — et une prolongation acceptée le
-- mardi, réglée le mercredi matin, était inscrite au MERCREDI. Les heures
-- réellement faites le mardi disparaissaient du détail ; écourter le mercredi
-- les rendait au client comme « non faites » ; et si le mercredi était le
-- dernier jour, la fin et l'échéance du versement reculaient pour rien.
--
-- CE QUE FAIT CETTE MIGRATION
--   • missions.extra_hours_journee (date) — la journée visée par la demande
--     en cours (portée « jour ») ; NULL sinon.
--   • la garde de création la refuse depuis le navigateur, comme les autres
--     colonnes de prolongation.
--
-- COMPATIBILITÉ : colonne facultative. L'ancien code l'ignore ; le nouveau la
-- lit et l'écrit — la migration doit donc passer AVANT la fusion du code.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS extra_hours_journee date;

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
     OR NEW.extra_hours_journee IS NOT NULL
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


-- VÉRIFICATION — doit renvoyer 1 | true :
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name = 'missions' AND column_name = 'extra_hours_journee') AS colonne,
--   (SELECT position('extra_hours_journee' in prosrc) > 0 FROM pg_proc
--     WHERE proname = 'missions_creation_guard') AS garde_a_jour;
