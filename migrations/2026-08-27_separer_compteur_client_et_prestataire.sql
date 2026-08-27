-- ═══════════════════════════════════════════════════════════════════════════
-- Séparer le compteur du CLIENT de celui du PRESTATAIRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- `profiles.missions_completed_month` servait deux choses sans rapport :
--
--   1. le QUOTA MENSUEL du prestataire — 2 prestations en Gratuit, 8 en
--      Premium — incrémenté quand il termine une prestation ;
--   2. le PALIER DE CASHBACK du client — 0,5 % à 1,5 % selon le nombre de
--      commandes du mois — incrémenté quand sa prestation est validée.
--
-- Un compte qui est les deux voyait donc son palier client gonflé par ses
-- prestations de prestataire. Constaté le 27/08/2026 : un compte à ZÉRO
-- commande affichait « Palier 🥈 Silver · 0,75 % ». Dans l'autre sens, une
-- commande passée par un prestataire consommait son propre quota mensuel.
--
-- Les deux compteurs n'ont ni le même fait générateur, ni la même signification,
-- ni le même bénéficiaire. Ils sont désormais deux colonnes.
--
-- CE QUI CHANGE
--
--   missions_completed_month  → reste le quota du PRESTATAIRE, inchangé.
--   commandes_mois            → nouvelle colonne, le palier du CLIENT.
--
-- Le report des valeurs existantes se fait depuis les prestations réellement
-- validées ce mois-ci, et non en recopiant l'ancien compteur : celui-ci mélange
-- les deux rôles, le recopier reconduirait l'erreur.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS commandes_mois integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN profiles.commandes_mois IS
  'Nombre de prestations commandées ET validées par ce compte EN TANT QUE CLIENT '
  'depuis le 1er du mois. Détermine le palier de cashback. Remis à 0 par le '
  'traitement mensuel. À ne pas confondre avec missions_completed_month, qui est '
  'le quota du prestataire.';

-- ── Report des valeurs, calculé et non recopié ──────────────────────────────
--
-- On compte les prestations dont ce compte est le CLIENT, validées, et passées
-- depuis le 1er du mois courant. `montant_total` n'entre pas dans le compte :
-- c'est le NOMBRE de commandes qui fait le palier.
--
-- C'est une approximation assumée : le compteur d'origine mélangeait les deux
-- rôles, il n'existe donc aucune valeur juste à recopier. Elle porte sur un
-- seul mois, et le traitement mensuel remettra tout le monde à zéro au 1er.
UPDATE profiles p
SET commandes_mois = COALESCE(c.n, 0)
FROM (
  SELECT client_id, COUNT(*)::int AS n
  FROM missions
  WHERE status IN ('completed', 'closed')
    AND validation_client = true
    AND created_at >= date_trunc('month', now())
  GROUP BY client_id
) c
WHERE p.id = c.client_id;

-- ── La colonne n'est pas modifiable depuis le navigateur ────────────────────
--
-- Même raison que `missions_completed_month` : un client capable d'écrire son
-- propre compteur s'attribuerait le palier à 1,5 % dès sa première commande.
--
-- Deux protections existent et sont toutes deux étendues.
--
-- 1) Les droits par colonne (2026-08-17_colonnes_non_modifiables.sql) accordent
--    UPDATE colonne par colonne. Une colonne créée après coup n'y figure pas et
--    n'est donc déjà pas modifiable — le REVOKE ci-dessous le rend explicite
--    plutôt que de reposer sur un effet de bord.
REVOKE UPDATE (commandes_mois) ON public.profiles FROM anon, authenticated;

-- 2) Le déclencheur `profiles_privileges_guard` (2026-07-30). Il est réécrit à
--    l'identique, avec la seule ligne `commandes_mois` ajoutée : ce corps est
--    la copie exacte de la migration d'origine, il ne faut RIEN y retirer.
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
$$;

REVOKE EXECUTE ON FUNCTION public.profiles_privileges_guard() FROM PUBLIC, anon, authenticated;

-- ── La fonction atomique du cashback vise la nouvelle colonne ───────────────
--
-- Elle incrémentait `missions_completed_month` du CLIENT — c'est-à-dire le
-- quota du prestataire, chez quelqu'un qui vient de commander. Elle incrémente
-- désormais `commandes_mois`.
--
-- `DROP` avant `CREATE` : le nom d'une colonne de sortie change, et PostgreSQL
-- refuse un CREATE OR REPLACE qui modifie le type de retour d'une fonction.
DROP FUNCTION IF EXISTS increment_cashback(uuid, numeric, integer);

CREATE OR REPLACE FUNCTION increment_cashback(
  p_user_id  uuid,
  p_delta    numeric,
  p_missions integer DEFAULT 1
)
RETURNS TABLE (cashback_balance numeric, commandes_mois integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles
  SET
    cashback_balance = COALESCE(cashback_balance, 0) + p_delta,
    commandes_mois   = COALESCE(commandes_mois, 0) + p_missions
  WHERE id = p_user_id;
  RETURN QUERY SELECT p.cashback_balance, p.commandes_mois
    FROM profiles p WHERE p.id = p_user_id;
END;
$$;

-- ── Relecture ───────────────────────────────────────────────────────────────
-- Les comptes dont les deux compteurs diffèrent : ce sont ceux que l'ancienne
-- colonne trompait.
--
--   SELECT id, prenom, nom, role, missions_completed_month, commandes_mois
--   FROM profiles
--   WHERE missions_completed_month <> commandes_mois
--   ORDER BY missions_completed_month DESC;
