-- S-06 — Fermer l'insertion de notifications aux comptes connectés
-- ============================================================================
--
-- Contexte
-- --------
-- Deux policies laissaient n'importe quel compte connecté créer une notification
-- destinée à n'importe qui, avec un titre et un corps libres :
--
--   notifs_insert                    INSERT / authenticated / WITH CHECK (true)
--   System can insert notifications  INSERT / authenticated / WITH CHECK (true)
--
-- C'est un vecteur de phishing in-app : un compte malveillant pouvait envoyer à
-- un prestataire une notification « Votre paiement a échoué, cliquez ici ».
--
-- Elles ne pouvaient pas être retirées tant que le front insérait lui-même des
-- notifications. Ces trois écritures sont désormais routées via /api, en service
-- role — donc hors RLS :
--
--   App.jsx (demande de prestation)   -> /api/missions  action notify_prestataire
--   client-screens.jsx (validation)   -> /api/missions  action complete
--   payment.jsx (délai expiré)        -> /api/missions  action acceptance_timeout
--
-- Appliquer cette migration APRÈS le déploiement du code correspondant, sinon
-- les notifications échoueront silencieusement le temps du décalage.
--
-- La lecture (SELECT) et la mise à jour (UPDATE, pour marquer comme lu) restent
-- inchangées : chacun ne voit et ne modifie que ses propres notifications.

BEGIN;

DROP POLICY IF EXISTS "notifs_insert"                   ON public.notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

COMMIT;

-- ── Vérification ────────────────────────────────────────────────────────────
-- Doit ne renvoyer AUCUNE ligne de commande INSERT :
--
--   SELECT policyname, cmd, roles, with_check
--   FROM   pg_policies
--   WHERE  schemaname = 'public' AND tablename = 'notifications'
--   ORDER  BY cmd;
--
-- Et ce test doit désormais échouer depuis un compte connecté (clé anon) :
--
--   INSERT INTO notifications (user_id, type, title, body, read)
--   VALUES ('<un autre user_id>', 'system', 'test', 'test', false);
--
-- ── Retour arrière ──────────────────────────────────────────────────────────
-- Si les notifications légitimes disparaissent, c'est que le code déployé est
-- antérieur à cette migration. Rouvrir temporairement :
--
--   CREATE POLICY "notifs_insert" ON public.notifications
--     FOR INSERT TO authenticated WITH CHECK (true);
--
-- puis déployer le code à jour et rejouer cette migration.
