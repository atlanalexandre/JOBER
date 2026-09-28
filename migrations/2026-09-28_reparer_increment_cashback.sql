-- ═══════════════════════════════════════════════════════════════════════════
-- `increment_cashback` : la fonction échouait à CHAQUE appel depuis le 27/08/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- La migration 2026-08-27_separer_compteur_client_et_prestataire.sql a recréé
-- la fonction avec `RETURNS TABLE (cashback_balance numeric, commandes_mois
-- integer)`. En PL/pgSQL, ces noms de sortie deviennent des VARIABLES, qui
-- portent exactement le nom des colonnes de `profiles`. Toute exécution
-- échoue donc :
--
--   ERROR 42702: column reference "cashback_balance" is ambiguous
--
-- Constaté en recette le 28/09/2026, par un scénario qui attendait la
-- restitution d'un cashback. Conséquences, depuis le 27/08 :
--   • validation par le client (`complete`) : un PATCH de secours créditait
--     quand même — seul chemin qui fonctionnait ;
--   • validation automatique (tâche planifiée) : cashback JAMAIS crédité, et
--     palier de fidélité jamais avancé ;
--   • back-office « Valider de force » et « Ajuster le cashback » : rien
--     crédité, alors que l'écran annonçait le contraire ;
--   • tout remboursement (`restituerCashback`) : cashback du client jamais rendu.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Même signature, même type de retour — les appelants lisent
-- `cashback_balance` dans la réponse. La directive `#variable_conflict
-- use_column` lève l'ambiguïté au profit des colonnes, et les références sont
-- qualifiées par surcroît. `search_path` est fixé (fonction SECURITY DEFINER).
-- Le verrou S-02 est reposé : seul le service role peut l'appeler.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_cashback(
  p_user_id  uuid,
  p_delta    numeric,
  p_missions integer DEFAULT 1
)
RETURNS TABLE (cashback_balance numeric, commandes_mois integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.profiles AS pr
     SET cashback_balance = COALESCE(pr.cashback_balance, 0) + p_delta,
         commandes_mois   = COALESCE(pr.commandes_mois, 0) + p_missions
   WHERE pr.id = p_user_id;
  RETURN QUERY SELECT p.cashback_balance, p.commandes_mois
    FROM public.profiles p WHERE p.id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_cashback(uuid, numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_cashback(uuid, numeric, integer) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — sans effet (montant 0, transaction annulée) : doit renvoyer
-- une ligne, sans erreur.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
-- SELECT * FROM public.increment_cashback((SELECT id FROM public.profiles LIMIT 1), 0, 0);
-- ROLLBACK;
