-- ═══════════════════════════════════════════════════════════════════════════
-- secu_profils_garde_role_du_jeton
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (audit « sécurité », 01/10/2026)
--
-- `profiles_privileges_guard` exemptait les appels dont `current_user` vaut
-- `service_role`, `postgres` ou `supabase_admin`. Or la fonction est SECURITY
-- DEFINER : `current_user` y vaut TOUJOURS son propriétaire, `postgres`. La
-- garde laissait donc tout passer, quel que soit l'appelant — exactement le
-- défaut déjà corrigé dans `missions_creation_guard`, dont le commentaire le
-- décrit.
--
-- Rien n'en profitait en pratique : les droits par colonne bornent ce que le
-- navigateur peut modifier, et un profil existe dès l'inscription (créé par
-- `handle_new_user`), si bien que la création par le navigateur échoue. Mais
-- une garde qui ne garde rien est un piège pour la suite : on la croit active.
--
-- Corrections :
--  1. la garde lit le rôle du JETON (`auth.role()`), comme `missions_creation_guard` ;
--  2. le navigateur perd le droit de CRÉER un profil, qu'aucun écran n'utilise
--     (la création passe par `handle_new_user`, la réparation par
--     /api/reparer-profil en service role) : quarante-neuf colonnes, dont
--     `plan_abonnement`, `missions_enabled` et `cashback_balance`, y étaient
--     inscriptibles.
--
-- ORDRE : indifférent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.profiles_privileges_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Seuls les appels du NAVIGATEUR sont contrôlés (jeton `authenticated` ou
  -- clé `anon`). Le rôle est lu dans le JETON : `current_user` vaut toujours
  -- `postgres` dans une fonction SECURITY DEFINER.
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.status, 'pending') <> 'pending'
       AND NOT (NEW.role = 'client' AND NEW.status = 'approved') THEN
      RAISE EXCEPTION 'Un compte prestataire est toujours créé en attente de validation.';
    END IF;
    IF COALESCE(NEW.plan_abonnement, 'free') <> 'free' THEN
      RAISE EXCEPTION 'Un abonnement ne s''accorde qu''après paiement.';
    END IF;
    IF COALESCE(NEW.missions_enabled, false) IS TRUE THEN
      RAISE EXCEPTION 'L''accès aux prestations est accordé par l''administration.';
    END IF;
    IF COALESCE(NEW.cashback_balance, 0) <> 0 OR COALESCE(NEW.prepaid_balance, 0) <> 0 THEN
      RAISE EXCEPTION 'Un solde ne se déclare pas à la création du compte.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id                       IS DISTINCT FROM OLD.id
  OR NEW.role                     IS DISTINCT FROM OLD.role
  OR NEW.status                   IS DISTINCT FROM OLD.status
  OR NEW.missions_enabled         IS DISTINCT FROM OLD.missions_enabled
  OR NEW.plan_abonnement          IS DISTINCT FROM OLD.plan_abonnement
  OR NEW.trial_exhausted          IS DISTINCT FROM OLD.trial_exhausted
  OR NEW.missions_completed_month IS DISTINCT FROM OLD.missions_completed_month
  OR NEW.commandes_mois           IS DISTINCT FROM OLD.commandes_mois
  OR NEW.cashback_balance         IS DISTINCT FROM OLD.cashback_balance
  OR NEW.prepaid_balance          IS DISTINCT FROM OLD.prepaid_balance
  OR NEW.stripe_customer_id       IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.stripe_subscription_id   IS DISTINCT FROM OLD.stripe_subscription_id
  OR NEW.stripe_account_id        IS DISTINCT FROM OLD.stripe_account_id
  OR NEW.stripe_account_status    IS DISTINCT FROM OLD.stripe_account_status
  THEN
    RAISE EXCEPTION 'Ce champ du profil ne peut être modifié que par la plateforme.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
REVOKE INSERT ON public.profiles FROM anon, authenticated;

-- VÉRIFICATION
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles';
--     → plus de ligne INSERT
--   SELECT count(*) FROM information_schema.column_privileges
--    WHERE table_name = 'profiles' AND grantee IN ('anon','authenticated') AND privilege_type = 'INSERT';
--     → 0
