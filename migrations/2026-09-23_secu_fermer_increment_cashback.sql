-- ═══════════════════════════════════════════════════════════════════════════
-- Fermer à nouveau `increment_cashback` (faille S-02 rouverte le 27/08/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI S'EST PASSÉ
--
-- `increment_cashback` est une fonction SECURITY DEFINER : elle s'exécute avec
-- les droits de son propriétaire et ne vérifie pas qui l'appelle. Exposée en
-- RPC, un simple POST sur `/rest/v1/rpc/increment_cashback` avec la clé anon —
-- publique, présente dans le bundle — crédite le montant de son choix sur
-- n'importe quel compte. C'est la faille S-02 de l'audit du 28/07/2026.
--
-- Elle avait été fermée. Mais la migration du 27/08/2026
-- (`separer_compteur_client_et_prestataire`) a fait `DROP` puis `CREATE` :
-- une fonction recréée reçoit le droit EXECUTE par défaut pour PUBLIC. Le
-- verrou a disparu avec l'ancienne fonction, sans que personne ne le voie.
-- Constaté le 23/09/2026 en lisant les droits de la production :
--   increment_cashback      → EXECUTE pour PUBLIC, anon, authenticated
--   missions_creation_guard → EXECUTE pour PUBLIC (la migration du 30/07 avait
--                             révoqué anon et authenticated, mais pas PUBLIC,
--                             dont ils héritent)
--
-- `missions_creation_guard` est une fonction trigger : PostgREST ne sait pas
-- l'appeler, elle n'est donc pas exploitable. On la ferme par cohérence (S-03).
--
-- QUI APPELLE `increment_cashback`
--
-- Uniquement `/api` (missions.js, bo-action.js, _cashback.js,
-- cron-reset-monthly.js), toujours avec la clé service role. Le rôle
-- `service_role` garde son droit : rien ne change pour l'application.
--
-- À RETENIR POUR LA SUITE
--
-- Toute migration qui fait `DROP FUNCTION` puis `CREATE` sur une fonction
-- SECURITY DEFINER doit REFAIRE son `REVOKE`. Le `CREATE OR REPLACE` seul
-- conserve les droits ; le `DROP` les perd.

REVOKE EXECUTE ON FUNCTION public.increment_cashback(uuid, numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_cashback(uuid, numeric, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.missions_creation_guard()
  FROM PUBLIC, anon, authenticated;

-- ── Vérification ────────────────────────────────────────────────────────────
-- Attendu : false, false, true sur les deux lignes.
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('increment_cashback', 'missions_creation_guard');
--
-- Et plus largement, aucune fonction SECURITY DEFINER ne doit rester
-- appelable par anon ou authenticated sans l'avoir décidé :
--
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef
--     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
--       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
--
-- ── Retour arrière ──────────────────────────────────────────────────────────
-- Aucun : rouvrir ces droits rouvrirait la faille.
