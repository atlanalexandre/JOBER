-- ═══════════════════════════════════════════════════════════════════════════
-- `debiter_cashback_mission` : le débit du cashback en UNE transaction
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- `debiterCashback()` (api/_cashback.js) procède en trois écritures séparées :
--   1. réserver la prestation (`cashback_debite = true`, si pas encore posé) ;
--   2. débiter le solde du client (compare-and-swap) ;
--   3. noter le montant débité (`cashback_debite_montant`).
-- Une coupure entre 1 et 2 — fonction serverless interrompue, délai dépassé —
-- laissait la prestation « débitée » sans débit réel : le client gardait son
-- solde, et une annulation lui RESTITUAIT ensuite un cashback jamais pris.
-- Relevé à la relecture du 05/10/2026 ; correction demandée par Alexandre.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Une fonction qui fait les trois sous verrou de ligne, dans une transaction :
-- tout ou rien. Mêmes règles que le code :
--   • déjà débitée → rien (« deja_debite ») ;
--   • rien de prévu, ou pas de client → rien (« rien ») ;
--   • débit plafonné au solde réel ; solde nul → rien, et la prestation
--     n'est PAS marquée (aucune restitution d'un cashback jamais pris) ;
--   • `cashback_applique` n'est jamais réécrit (il borne les remboursements).
--
-- COMPATIBILITÉ : le code appelle la fonction et, si elle est absente ou en
-- erreur, garde son chemin actuel. Les deux respectent le même drapeau sous
-- verrou de ligne : ils peuvent coexister sans double débit.
--
-- Seul le service role peut l'appeler (comme `increment_cashback`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.debiter_cashback_mission(p_mission_id uuid)
RETURNS TABLE (etat text, debite numeric, solde numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_client   uuid;
  v_prevu    numeric;
  v_deja     boolean;
  v_solde    numeric;
  v_debit    numeric;
BEGIN
  SELECT m.client_id, COALESCE(m.cashback_applique, 0), COALESCE(m.cashback_debite, false)
    INTO v_client, v_prevu, v_deja
    FROM public.missions m
   WHERE m.id = p_mission_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'introuvable'::text, 0::numeric, NULL::numeric; RETURN;
  END IF;
  IF v_deja THEN
    RETURN QUERY SELECT 'deja_debite'::text, 0::numeric, NULL::numeric; RETURN;
  END IF;
  IF v_prevu <= 0 OR v_client IS NULL THEN
    RETURN QUERY SELECT 'rien'::text, 0::numeric, NULL::numeric; RETURN;
  END IF;

  SELECT COALESCE(p.cashback_balance, 0) INTO v_solde
    FROM public.profiles p
   WHERE p.id = v_client
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'profil_introuvable'::text, 0::numeric, NULL::numeric; RETURN;
  END IF;

  v_debit := round(LEAST(v_prevu, GREATEST(v_solde, 0)), 2);
  IF v_debit <= 0 THEN
    RETURN QUERY SELECT 'solde_nul'::text, 0::numeric, v_solde; RETURN;
  END IF;

  UPDATE public.profiles AS pr
     SET cashback_balance = round(COALESCE(pr.cashback_balance, 0) - v_debit, 2)
   WHERE pr.id = v_client;
  UPDATE public.missions AS mi
     SET cashback_debite = true,
         cashback_debite_montant = v_debit
   WHERE mi.id = p_mission_id;

  RETURN QUERY SELECT 'debite'::text, v_debit, round(v_solde - v_debit, 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.debiter_cashback_mission(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debiter_cashback_mission(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — sans effet (identifiant inexistant) : doit renvoyer
-- une ligne « introuvable », sans erreur.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT * FROM public.debiter_cashback_mission('00000000-0000-0000-0000-000000000000');
