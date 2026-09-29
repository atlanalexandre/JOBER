-- ═══════════════════════════════════════════════════════════════════════════
-- Pointage d'arrivée : le serveur vérifie que le prestataire est sur place
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (29/09/2026)
--
-- Le téléphone du prestataire pointait automatiquement à moins de 150 m de
-- l'adresse, mais le serveur ne voyait jamais de position : un bouton de
-- secours permettait de pointer de n'importe où, sans que rien ne le
-- distingue d'un vrai pointage sur place. Question d'un traiteur sur le
-- sérieux des prestataires ; décision d'Alexandre : vérifier, sans bloquer.
--
-- CE QUE CES COLONNES STOCKENT
--
-- Un constat et une distance, JAMAIS les coordonnées. La position est lue une
-- fois, au pointage, comparée à l'adresse de la prestation, puis oubliée.
-- Aucun suivi continu (CGPS art. 10C.3 : ni décompte du temps de travail, ni
-- contrôle des horaires).
--
--   arrivee_localisation : 'sur_place'          à 300 m ou moins, précision du GPS déduite
--                          'eloignee'           au-delà
--                          'position_absente'   le téléphone n'a rien transmis (refus, GPS muet)
--                          'adresse_introuvable' l'adresse de la prestation n'a pas pu être localisée
--                          NULL                 pointage antérieur au 29/09/2026, ou pas encore d'arrivée
--   arrivee_distance_m   : distance brute en mètres, NULL si non mesurable
--
-- Règle 1.6 de CLAUDE.md : ces quatre valeurs sont les seules écrites par le
-- code (`CONSTATS_ARRIVEE` de `api/_localisation.js`, écrit par l'action
-- `checkin_mission` de `api/missions.js`).
--
-- ORDRE : cette migration (recette, puis production), PUIS le déploiement.
-- Le back-office lit ces colonnes dans sa liste des prestations : sans elles,
-- PostgREST refuserait toute la requête et la liste resterait vide. Le
-- pointage, lui, les écrit à part et passe même sans la migration.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS arrivee_localisation text,
  ADD COLUMN IF NOT EXISTS arrivee_distance_m   integer;

COMMENT ON COLUMN public.missions.arrivee_localisation IS
  'Constat du serveur au pointage d''arrivée : sur_place, eloignee, position_absente, '
  'adresse_introuvable. Une information pour le client et le back-office, pas un '
  'verdict : un GPS d''immeuble peut se tromper. Aucune coordonnée n''est conservée.';

COMMENT ON COLUMN public.missions.arrivee_distance_m IS
  'Distance en mètres entre la position relevée au pointage et l''adresse de la prestation.';

ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_arrivee_localisation_check;
ALTER TABLE public.missions ADD CONSTRAINT missions_arrivee_localisation_check
  CHECK (arrivee_localisation IS NULL
      OR arrivee_localisation IN ('sur_place', 'eloignee', 'position_absente', 'adresse_introuvable'));

-- Écrites par /api seul, en rôle service. Un prestataire capable de les écrire
-- se déclarerait « sur place » de chez lui.
REVOKE UPDATE (arrivee_localisation, arrivee_distance_m) ON public.missions FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Les deux colonnes existent — attendu : deux lignes
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'missions'
--       AND column_name IN ('arrivee_localisation', 'arrivee_distance_m');
--
-- 2. Le navigateur ne peut pas les modifier — attendu : aucune ligne
--    SELECT grantee, column_name FROM information_schema.column_privileges
--     WHERE table_name = 'missions' AND privilege_type = 'UPDATE'
--       AND column_name IN ('arrivee_localisation', 'arrivee_distance_m')
--       AND grantee IN ('anon', 'authenticated');
--
-- 3. Relecture, une fois en service — les pointages éloignés du mois :
--    SELECT id, prestataire_id, date, metier, arrivee_distance_m
--      FROM public.missions
--     WHERE arrivee_localisation = 'eloignee' AND date >= date_trunc('month', now())
--     ORDER BY arrivee_distance_m DESC;
