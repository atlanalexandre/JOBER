-- ═══════════════════════════════════════════════════════════════════════════
-- Le client est validé d'office ; la suspension devient possible
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. UN CLIENT RESTAIT BLOQUÉ « EN ATTENTE »
--
-- La règle du produit (DOCUMENTATION.md §6) : seul le prestataire passe par une
-- validation manuelle, le client accède immédiatement à l'application.
--
-- Depuis le verrou `profiles_privileges_guard` (30/07/2026), c'est faux :
--   • `handle_new_user` crée le profil sans statut → défaut de colonne `pending` ;
--   • le navigateur tente ensuite de passer le client en `approved` : c'est une
--     MODIFICATION de statut, que le verrou refuse — à raison, un navigateur ne
--     doit jamais pouvoir s'accorder un statut.
-- Résultat : chaque client inscrit depuis le 30/07 est resté sur « Compte en
-- attente », sans que personne ne soit prévenu. Cinq comptes en production au
-- 23/09/2026, le dernier client validé datant du 22/06. Trouvé par les scénarios
-- Playwright de la recette.
--
-- Correction : c'est la BASE qui fixe le statut à la naissance du profil, selon
-- le rôle. Le verrou reste entier : un navigateur ne modifie toujours aucun statut.
--
-- 2. LA SUSPENSION ÉTAIT REFUSÉE EN SILENCE
--
-- Le backoffice écrit `status = 'suspended'`, que l'application traite à la
-- connexion et au démarrage. Mais `profiles_status_check` ne connaissait que
-- pending / approved / rejected : la base refusait, `api/bo-action.js` ne relisait
-- pas le résultat, et l'intéressé recevait « votre compte est suspendu » en
-- gardant tous ses accès. Valeurs relevées dans `src/` et `api/` avant d'élargir
-- la contrainte (CLAUDE.md §1.6) : pending, approved, rejected, suspended.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_role text := CASE WHEN NEW.raw_user_meta_data->>'role' = 'prestataire' THEN 'prestataire' ELSE 'client' END;
  BEGIN
    INSERT INTO profiles (id, role, prenom, nom, status)
    VALUES (
      NEW.id,
      v_role,
      COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
      COALESCE(NEW.raw_user_meta_data->>'nom', ''),
      -- Le client est validé d'office ; le prestataire attend l'administration.
      CASE WHEN v_role = 'client' THEN 'approved' ELSE 'pending' END
    );
    RETURN NEW;
  END;
  $function$;

-- `CREATE OR REPLACE` conserve les droits existants (pas de DROP) : la fonction
-- reste réservée au déclencheur. On le réaffirme malgré tout — leçon de S-02.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Le verrou, côté INSERT : un profil créé depuis le navigateur (chemin de secours,
-- si le déclencheur n'a pas créé la ligne) peut naître `approved` s'il est client,
-- jamais s'il est prestataire. Tout le reste du verrou est inchangé.
CREATE OR REPLACE FUNCTION public.profiles_privileges_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
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

REVOKE EXECUTE ON FUNCTION public.profiles_privileges_guard() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text]));

-- Les clients déjà bloqués ne sont PAS validés ici : ils le sont depuis le
-- backoffice (Comptes → « Valider les clients en attente et les prévenir »), qui
-- leur envoie en même temps un e-mail. Une validation silencieuse les laisserait
-- sans nouvelles.

-- ── Vérification ────────────────────────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'profiles_status_check';
--   -- → doit citer 'suspended'
--   SELECT prosrc LIKE '%approved%' FROM pg_proc WHERE proname = 'handle_new_user';
--   -- → true
--
-- ── Retour arrière ──────────────────────────────────────────────────────────
-- Recréer les deux fonctions telles que dans 2026-08-27_separer_compteur_client_et_prestataire.sql
-- et 2026-07-30_secu_verrou_champs_profil.sql, et la contrainte sans 'suspended'.
-- Déconseillé : cela rétablit les deux défauts ci-dessus.
