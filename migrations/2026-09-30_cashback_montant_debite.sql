-- ═══════════════════════════════════════════════════════════════════════════
-- Cashback : noter ce qui a RÉELLEMENT été débité, pour ne rendre que cela
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (relecture du 30/09/2026)
--
-- Deux réservations presque simultanées affichent chacune la réduction du même
-- solde. À la seconde confirmation, le solde ne suffit plus : on débite ce qui
-- reste (1 € au lieu de 5 €), la réduction promise restant honorée — l'écart
-- est à la charge d'ALANE. Mais `cashback_applique` garde 5 € (il borne les
-- remboursements Stripe et ne doit pas bouger), et une annulation avant le
-- début RENDAIT 5 € : le client gagnait 4 € qu'il n'avait jamais eus.
--
-- `cashback_debite_montant` porte ce qui a quitté le solde ; la restitution
-- rend ce montant, borné par la réduction. NULL (lignes antérieures, ou
-- migration pas encore passée) → la réduction, comme avant : c'est le cas
-- normal, où les deux sont égaux.
--
-- ORDRE : indifférent. Le code écrit cette colonne à part et la lit en
-- tolérant son absence : avant la migration, il se comporte comme hier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS cashback_debite_montant numeric(10,2);

COMMENT ON COLUMN public.missions.cashback_debite_montant IS
  'Cashback réellement retiré du solde du client à la confirmation du paiement (peut être '
  'inférieur à cashback_applique si le solde ne suffisait plus). C''est ce que rend une '
  'restitution. Écrit par le serveur seul.';

REVOKE UPDATE (cashback_debite_montant) ON public.missions FROM anon, authenticated;

-- VÉRIFICATION — attendu : une ligne
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions' AND column_name = 'cashback_debite_montant';
