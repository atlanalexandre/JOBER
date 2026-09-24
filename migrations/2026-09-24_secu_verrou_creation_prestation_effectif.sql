-- ═══════════════════════════════════════════════════════════════════════════
-- Verrou sur la création d'une prestation — le rendre effectif
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La migration 2026-07-30_secu_verrou_creation_prestation.sql avait créé la
-- fonction `missions_creation_guard`, mais elle ne bloquait RIEN, et son
-- déclencheur n'était de toute façon posé ni en production ni en recette.
--
-- Constaté le 24/09/2026 sur la recette, déclencheur posé : un client connecté
-- créait une prestation déjà affectée à un prestataire, une autre à 1 € pour
-- 104 € de travail, une troisième portant un faux identifiant de paiement —
-- trois réponses 201.
--
-- La cause : la fonction est SECURITY DEFINER, propriété de `postgres`. Dans
-- son corps, `current_user` vaut donc toujours `postgres`, et sa première
-- ligne exemptait `postgres`. Tout le monde était exempté.
--
-- CE QUI CHANGE
--
-- L'exemption se décide sur le rôle du JETON de l'appelant (`auth.role()`).
-- Les règles elles-mêmes sont inchangées — voir la migration d'origine. Elles
-- ont été confrontées aux deux seules créations faites par le navigateur
-- (App.jsx : réservation ; client-screens.jsx : diffusion) : aucune n'écrit
-- de prestataire, de paiement, de délai ou de pointage, et toutes deux créent
-- en « open » ou « pending_acceptance ».
--
-- VÉRIFICATION ET RETOUR ARRIÈRE — en bas du fichier.
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
-- 1. Deux déclencheurs sur `missions` :
--
--    SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.missions'::regclass AND NOT tgisinternal;
--
--    → missions_creation_guard, missions_field_tamper_guard
--
-- 2. Le vrai test : passer une réservation depuis un compte client, par
--    l'écran. Elle doit aboutir normalement. Sur la recette : scénarios 06 à 10.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE (retire la barrière, sans rouvrir les contrôles applicatifs)
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TRIGGER IF EXISTS missions_creation_guard ON public.missions;
-- ═══════════════════════════════════════════════════════════════════════════
