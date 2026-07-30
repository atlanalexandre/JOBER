-- ═══════════════════════════════════════════════════════════════════════════
-- Verrou sur la création d'une prestation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le déclencheur existant `missions_field_tamper_guard` ne couvre que les UPDATE
-- (vérifié en base le 30/07/2026). Or une ligne `missions` est INSÉRÉE par le
-- navigateur du client : à la création, il choisissait donc librement chaque
-- colonne, y compris celles qui décident de l'argent et de l'affectation.
--
-- Deux contrôles applicatifs ferment déjà la faille du montant
-- (`api/stripe-intent.js` et `assign_after_payment`). Ce déclencheur les double
-- au niveau de la base : c'est le seul endroit qu'aucun chemin d'écriture ne peut
-- contourner.
--
-- CE QUI EST INTERDIT À LA CRÉATION, POUR UN COMPTE CONNECTÉ
--
--   1. créer une prestation au nom de quelqu'un d'autre ;
--   2. s'affecter un prestataire soi-même (cela relève de /api/missions, qui
--      contrôle le rayon d'intervention, l'accès aux prestations et le tarif) ;
--   3. naître dans un statut autre que « open » ou « pending_acceptance » ;
--   4. se rattacher un paiement, un délai d'acceptation ou un pointage ;
--   5. annoncer un montant total inférieur à la seule part horaire — autrement
--      dit des frais de service négatifs. C'est la signature du montant fabriqué :
--      112 € de travail déclarés 1 €.
--
-- CE QUI RESTE AUTORISÉ
--
-- Le flux de diffusion, où le client fixe lui-même son budget, passe sans
-- encombre : il crée en statut « open », sans prestataire ni montant.
--
-- Le rôle `service_role` (les fonctions /api) et les rôles d'administration sont
-- exemptés : ils appliquent déjà leurs propres contrôles, et les bloquer ici
-- casserait la création serveur.
--
-- VÉRIFICATION APRÈS APPLICATION — voir le bas du fichier.
-- RETOUR ARRIÈRE — une seule ligne, voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.missions_creation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  part_horaire numeric;
BEGIN
  -- Les fonctions serveur et l'administration ne sont pas concernées.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.missions_creation_guard() FROM anon, authenticated;

DROP TRIGGER IF EXISTS missions_creation_guard ON public.missions;

CREATE TRIGGER missions_creation_guard
  BEFORE INSERT ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.missions_creation_guard();


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Le déclencheur existe et porte bien sur INSERT :
--
--    SELECT tgname, pg_get_triggerdef(oid)
--    FROM pg_trigger
--    WHERE tgrelid = 'missions'::regclass AND NOT tgisinternal;
--
--    Deux lignes attendues : `missions_field_tamper_guard` (BEFORE UPDATE) et
--    `missions_creation_guard` (BEFORE INSERT).
--
-- 2. Le vrai test est applicatif : passer une réservation depuis un compte
--    client. Elle doit aboutir normalement. Si elle échoue avec l'un des
--    messages ci-dessus, le déclencheur est trop strict — appliquer le retour
--    arrière et me transmettre le message exact.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TRIGGER IF EXISTS missions_creation_guard ON public.missions;
--
-- Les contrôles applicatifs (stripe-intent, assign_after_payment) restent en
-- place : le retrait de ce déclencheur ne réouvre pas la faille du montant, il
-- retire seulement la seconde barrière.
-- ═══════════════════════════════════════════════════════════════════════════
