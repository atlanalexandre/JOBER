-- ═══════════════════════════════════════════════════════════════════════════
-- conserver_creances_et_rechargements_apres_suppression
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (étude du 13/10/2026, décision D1, demande d'Alexandre du 14/10/2026)
--
-- `creances_prestataires.prestataire_id` et `wallet_topups.user_id` étaient
-- reliés au compte en ON DELETE CASCADE : supprimer un compte effaçait
--   - les sommes qu'il devait à ALANE (créances), sans trace comptable ;
--   - le registre de ses rechargements (paiements Stripe reçus).
--
-- Depuis la PR « une somme due ne part plus avec le compte », une créance
-- ACTIVE ou CONTESTÉE bloque la suppression. Restent les créances réglées
-- (éteintes, abandonnées) et les rechargements : ce sont des pièces comptables,
-- elles doivent survivre au compte. On garde la ligne et on vide seulement le
-- lien vers le compte (ON DELETE SET NULL) — comme les prestations, anonymisées
-- et non effacées.
--
-- Rien n'est supprimé ni modifié dans les données : la colonne accepte
-- désormais NULL, et la clé est recréée avec une autre règle de suppression.
-- Production, lecture seule le 14/10/2026 : 0 créance, 0 rechargement.
-- APPLIQUÉE : recette et production le 14/10/2026 (production passée par Alexandre),
-- vérifiée des deux côtés : les deux clés finissent par ON DELETE SET NULL.
--
-- ORDRE : indifférent (le code ne dépend pas de cette migration).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.creances_prestataires ALTER COLUMN prestataire_id DROP NOT NULL;
ALTER TABLE public.creances_prestataires
  DROP CONSTRAINT creances_prestataires_prestataire_id_fkey,
  ADD  CONSTRAINT creances_prestataires_prestataire_id_fkey
       FOREIGN KEY (prestataire_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.wallet_topups ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.wallet_topups
  DROP CONSTRAINT wallet_topups_user_id_fkey,
  ADD  CONSTRAINT wallet_topups_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- ── Vérification ───────────────────────────────────────────────────────────
-- ATTENDU : deux lignes, chacune finissant par « ON DELETE SET NULL ».
--
-- SELECT conrelid::regclass, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname IN ('creances_prestataires_prestataire_id_fkey', 'wallet_topups_user_id_fkey');
