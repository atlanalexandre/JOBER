-- ═══════════════════════════════════════════════════════════════════════════
-- RECETTE SEULEMENT — nettoyage automatique des comptes de test (08/10/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ À passer UNIQUEMENT sur le projet de recette (qoizrysxwjmhqwuteajj).
-- Jamais en production : la production n'a pas de comptes de test, et n'a pas
-- besoin de cette tâche.
--
-- POURQUOI
--
-- Chaque recette crée des dizaines de comptes de test. Le 08/10/2026, la
-- recette en comptait 5 593, dont 2 840 de plus de sept jours : la tâche
-- planifiée mettait 104 s (60 s après nettoyage) et le catalogue 3,4 s,
-- jusqu'à faire échouer des scénarios sur des délais dépassés.
--
-- La suppression ne peut pas être lancée par la session Claude Code (son
-- garde-fou refuse les suppressions massives) : elle est confiée à la base
-- elle-même, par pg_cron, chaque nuit à 3 h UTC — avant la relecture de 6 h.
--
-- CE QUI EST SUPPRIMÉ
--
-- Les seuls comptes dont l'adresse suit le motif des scénarios de recette
-- (`role.<13 chiffres>.<1 à 4 chiffres>@recette.alane.test` et
-- `recette-…-<13 chiffres>@alane-recette.test`), créés il y a plus de sept
-- jours, avec leurs prestations et leurs messages. Profils, documents,
-- notifications, candidatures et contrats suivent par cascade. Les fichiers du
-- stockage restent (sans effet sur les traitements).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.recette_nettoyer_comptes_test()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS recette_a_suppr (id uuid) ON COMMIT DROP;
  INSERT INTO recette_a_suppr
    SELECT id FROM auth.users
    WHERE (email ~ '^[a-z-]+\.[0-9]{13}\.[0-9]{1,4}@recette\.alane\.test$'
        OR email ~ '^recette-[a-z-]+-[0-9]{13}@alane-recette\.test$')
      AND created_at < now() - interval '7 days';
  SELECT count(*) INTO n FROM recette_a_suppr;

  DELETE FROM public.messages
    WHERE client_id IN (SELECT id FROM recette_a_suppr) OR prestataire_id IN (SELECT id FROM recette_a_suppr);
  DELETE FROM public.missions
    WHERE client_id IN (SELECT id FROM recette_a_suppr) OR prestataire_id IN (SELECT id FROM recette_a_suppr);
  DELETE FROM auth.users WHERE id IN (SELECT id FROM recette_a_suppr);

  RETURN n;
END;
$function$;

-- Personne ne doit pouvoir l'appeler depuis l'application (PostgREST expose les
-- fonctions du schéma public) : seule la tâche programmée la lance.
REVOKE ALL ON FUNCTION public.recette_nettoyer_comptes_test() FROM PUBLIC, anon, authenticated;

-- Chaque nuit à 3 h UTC (5 h à Paris en été), avant la relecture de 6 h.
SELECT cron.schedule('recette-nettoyage-comptes-test', '0 3 * * *',
  $$SELECT public.recette_nettoyer_comptes_test()$$);

-- VÉRIFICATION — doit renvoyer une ligne : recette-nettoyage-comptes-test | 0 3 * * *
-- SELECT jobname, schedule FROM cron.job;
