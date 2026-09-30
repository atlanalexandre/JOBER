-- ═══════════════════════════════════════════════════════════════════════════
-- Suppression d'un compte : les prestations restent, seul le lien est effacé
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (audit du domaine « comptes », 30/09/2026 — constaté en recette)
--
-- Deux clés étrangères décidaient de ce qui arrive aux prestations quand un
-- compte disparaît, et aucune ne faisait ce qu'il fallait :
--
--   • missions.client_id → profiles : ON DELETE CASCADE. Supprimer un client
--     effaçait TOUTES ses prestations, terminées comprises. Celle dont le
--     prestataire attendait encore son virement disparaissait avec : le
--     traitement des versements ne la retrouvait plus, et le prestataire
--     n'était jamais payé. L'historique servant à la déclaration DAC7 et aux
--     contestations disparaissait aussi.
--
--   • missions.prestataire_id → profiles : NO ACTION. Un prestataire ayant
--     déjà travaillé ne pouvait PAS être supprimé : la base refusait, mais le
--     serveur ne lisait pas la réponse, et l'écran annonçait « compte
--     supprimé ». Le compte restait ouvert, et on pouvait s'y reconnecter.
--
--   • contracts.client_id / prestataire_id → auth.users : NO ACTION, même
--     blocage pour tout compte ayant signé un contrat de prestation.
--
-- Désormais, la suppression d'un compte vide ces colonnes (SET NULL) : la
-- prestation, son montant, son virement et son contrat restent ; plus rien ne
-- désigne la personne. L'adresse et la description sont effacées par le
-- serveur à la suppression (api/_suppression.js). La facture, elle, est figée
-- dans `factures_archives` (conservation de dix ans, art. L.123-22 C. com.).
--
-- ORDRE : la migration AVANT le code, de préférence. Sans elle, le nouveau code
-- refuse proprement de supprimer un prestataire ayant déjà travaillé (message
-- clair au lieu d'un faux succès) ; la suppression d'un client efface encore
-- ses prestations, comme aujourd'hui.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_client_id_fkey;
ALTER TABLE public.missions ADD CONSTRAINT missions_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_prestataire_id_fkey;
ALTER TABLE public.missions ADD CONSTRAINT missions_prestataire_id_fkey
  FOREIGN KEY (prestataire_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_client_id_fkey;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_prestataire_id_fkey;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_prestataire_id_fkey
  FOREIGN KEY (prestataire_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- VÉRIFICATION — attendu : quatre lignes, toutes avec « n » (SET NULL)
--   SELECT conrelid::regclass, conname, confdeltype FROM pg_constraint
--    WHERE conname IN ('missions_client_id_fkey','missions_prestataire_id_fkey',
--                      'contracts_client_id_fkey','contracts_prestataire_id_fkey');
