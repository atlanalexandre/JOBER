-- ═══════════════════════════════════════════════════════════════════════════
-- Verrou sur les champs privilégiés du profil
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La ligne `profiles` est créée ET modifiée par le navigateur : quatre `upsert`
-- dans `auth.jsx`, plus des `update` dans les écrans de profil. Le navigateur y
-- choisit donc lui-même `role` et `status`.
--
-- Aujourd'hui l'application n'écrit jamais autre chose que `status = 'pending'`.
-- Mais rien ne l'y oblige : ce qui protège réellement ce champ, ce sont les règles
-- RLS de la base — invisibles depuis le dépôt. Si elles se limitent à
-- « id = auth.uid() », alors un compte peut se déclarer `approved`, s'accorder
-- `missions_enabled`, ou se créditer un portefeuille. Un prestataire apparaîtrait
-- au catalogue sans qu'aucun document n'ait été vérifié.
--
-- Ce déclencheur rend la question sans objet : quelles que soient les policies,
-- ces champs ne changent plus depuis un compte connecté.
--
-- CE QUI EST INTERDIT
--
-- À la création : un `status` autre que « pending », un abonnement autre que
-- « free », `missions_enabled` à vrai, un solde non nul.
--
-- À la modification : tout changement de `id`, `role`, `status`,
-- `missions_enabled`, `plan_abonnement`, `trial_exhausted`,
-- `missions_completed_month`, des soldes, ou des identifiants Stripe.
--
-- CE QUI RESTE LIBRE
--
-- Nom, prénom, adresse, ville, code postal, photo (`avatar_url`), IBAN — tout ce
-- qu'un utilisateur doit pouvoir corriger lui-même.
--
-- `service_role` (les fonctions /api, le webhook Stripe, le backoffice) et les
-- rôles d'administration sont exemptés : c'est par eux que passent les validations
-- et les abonnements.
--
-- AVANT D'APPLIQUER — le diagnostic, pour savoir si le trou est réel aujourd'hui :
--
--    SELECT policyname, cmd, qual, with_check
--    FROM pg_policies WHERE tablename = 'profiles';
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.profiles_privileges_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Les fonctions serveur et l'administration accordent précisément ces droits.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'Un compte est toujours créé en attente de validation.';
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
$$;

REVOKE EXECUTE ON FUNCTION public.profiles_privileges_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_privileges_guard ON public.profiles;

CREATE TRIGGER profiles_privileges_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_privileges_guard();


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Le déclencheur est en place :
--
--    SELECT tgname, pg_get_triggerdef(oid)
--    FROM pg_trigger
--    WHERE tgrelid = 'profiles'::regclass AND NOT tgisinternal;
--
-- 2. Le vrai test est applicatif, et il faut LES DEUX :
--    • créer un compte — l'inscription doit aboutir normalement ;
--    • modifier son nom depuis l'écran de profil — l'enregistrement doit passer.
--    Si l'un des deux échoue avec « Ce champ du profil… » ou « Un compte est
--    toujours créé… », appliquer le retour arrière et me transmettre le message.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TRIGGER IF EXISTS profiles_privileges_guard ON public.profiles;
--
-- ═══════════════════════════════════════════════════════════════════════════
