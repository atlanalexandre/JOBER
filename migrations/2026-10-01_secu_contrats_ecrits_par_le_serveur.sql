-- ═══════════════════════════════════════════════════════════════════════════
-- secu_contrats_ecrits_par_le_serveur
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (audit « sécurité », 01/10/2026)
--
-- La règle `contracts_client_creation` laissait un client créer, depuis le
-- navigateur, une ligne de `contracts` avec le prestataire, le montant, et les
-- mentions « signé par le prestataire » de son choix : de quoi fabriquer un
-- contrat apparemment signé par quelqu'un qui n'a rien signé.
--
-- Le seul écran qui s'en servait (ContractScreen) n'y est jamais parvenu — il
-- envoyait une colonne inexistante, `hours`, et la table est vide en recette —
-- et ne s'en sert plus. La signature du client est désormais posée par le
-- serveur, au paiement, dans `missions.contrat_client_signe_at`.
--
-- La LECTURE de ses contrats reste permise (règle inchangée).
-- ORDRE : indifférent — le code déployé n'écrit plus dans cette table.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS contracts_client_creation ON public.contracts;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contracts FROM anon, authenticated;

-- VÉRIFICATION — attendu : aucune règle INSERT/UPDATE/DELETE/ALL sur contracts.
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'contracts';
