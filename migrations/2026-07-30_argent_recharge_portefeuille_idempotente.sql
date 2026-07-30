-- ═══════════════════════════════════════════════════════════════════════════
-- Recharge du portefeuille : idempotence et traçabilité
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le webhook Stripe créditait `profiles.prepaid_balance` en lisant le solde puis
-- en le réécrivant, sans aucune protection contre un double traitement.
--
-- Stripe réémet un événement tant qu'il n'a pas reçu de réponse 2xx : sur un
-- dépassement de délai de la fonction — le crédit étant déjà écrit — la recharge
-- était rejouée et le solde crédité **deux fois**. Le chemin des prestations
-- disposait bien d'un contrôle d'idempotence ; celui du portefeuille en était
-- dépourvu et sortait avant de l'atteindre.
--
-- Deux recharges simultanées se perdaient par ailleurs mutuellement : lire puis
-- réécrire n'est pas atomique.
--
-- Enfin, aucune trace : de l'argent entrait dans le portefeuille sans qu'aucune
-- ligne ne l'enregistre. Impossible de justifier un solde, de rapprocher les
-- encaissements Stripe, ou d'instruire une réclamation.
--
-- CE QUE FAIT CETTE MIGRATION
--
--   1. `wallet_topups` — le registre des recharges. La clé primaire est
--      l'identifiant du paiement Stripe : une même recharge ne peut pas y entrer
--      deux fois, c'est la base est qui garantit l'idempotence, pas le code.
--
--   2. `crediter_portefeuille()` — enregistre la recharge et incrémente le solde
--      dans une seule transaction. Renvoie le nouveau solde, ou NULL si la
--      recharge avait déjà été traitée. L'incrément est atomique : deux recharges
--      simultanées s'additionnent au lieu de s'écraser.
--
-- COMPATIBILITÉ
--
-- Le code sait fonctionner sans cette migration : si la procédure est absente, il
-- retombe sur l'ancien comportement en le signalant dans les journaux. Appliquer
-- cette migration n'impose donc aucun ordre par rapport au déploiement.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_topups (
  stripe_payment_intent text PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount                numeric NOT NULL CHECK (amount > 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_user_created
  ON public.wallet_topups(user_id, created_at DESC);

-- Registre financier : lisible et modifiable par le seul service role, comme les
-- autres écritures d'argent. Aucune policy n'est créée, RLS refuse donc tout
-- accès aux rôles anon et authenticated.
ALTER TABLE public.wallet_topups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crediter_portefeuille(
  p_user_id        uuid,
  p_amount         numeric,
  p_payment_intent text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nouveau_solde numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Montant de recharge invalide : %', p_amount;
  END IF;

  INSERT INTO public.wallet_topups (stripe_payment_intent, user_id, amount)
  VALUES (p_payment_intent, p_user_id, p_amount)
  ON CONFLICT (stripe_payment_intent) DO NOTHING;

  -- Aucune ligne insérée : la recharge a déjà été traitée, ne pas créditer.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles
     SET prepaid_balance = ROUND(COALESCE(prepaid_balance, 0) + p_amount, 2)
   WHERE id = p_user_id
  RETURNING prepaid_balance INTO nouveau_solde;

  IF nouveau_solde IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable pour la recharge : %', p_user_id;
  END IF;

  RETURN nouveau_solde;
END;
$$;

-- Appelée exclusivement par le webhook Stripe, en service role.
REVOKE EXECUTE ON FUNCTION public.crediter_portefeuille(uuid, numeric, text) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La table et la procédure existent :
--
--    SELECT to_regclass('public.wallet_topups') AS table_creee;
--    SELECT proname FROM pg_proc WHERE proname = 'crediter_portefeuille';
--
-- 2. Après une recharge réelle, elle doit apparaître au registre :
--
--    SELECT stripe_payment_intent, amount, created_at
--    FROM wallet_topups ORDER BY created_at DESC LIMIT 5;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP FUNCTION IF EXISTS public.crediter_portefeuille(uuid, numeric, text);
--    -- Conserver `wallet_topups` : c'est un registre financier, il ne se supprime
--    -- pas à la légère. Le code repasse tout seul sur l'ancien comportement.
--
-- ═══════════════════════════════════════════════════════════════════════════
