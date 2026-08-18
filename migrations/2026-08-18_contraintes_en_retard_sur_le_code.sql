-- ═══════════════════════════════════════════════════════════════════════════
-- Trois contraintes qui refusent des valeurs que le code écrit
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le 18/08/2026, un prestataire accepte une prolongation d'une heure et reçoit
-- « Votre réponse n'a pas pu être enregistrée ». Le relevé des contraintes de
-- `missions` montre la cause, et deux autres du même genre :
--
--   missions_extra_hours_status_check : pending, accepted, refused
--   missions_delay_status_check       : approved, rejected
--   missions_payout_status_check      : pending, processing, transferred, failed
--
-- Or le code écrit aussi `accepte_presta`, `pending` et `held`. Ces trois
-- valeurs ont été introduites avec des fonctionnalités récentes, dont les
-- migrations ont créé les colonnes nécessaires sans jamais vérifier qu'une
-- contrainte plus ancienne acceptait la nouvelle valeur.
--
-- La règle 1.6 de CLAUDE.md dit « avant d'ajouter une contrainte, relever
-- TOUTES les valeurs utilisées ». Elle se lit ici par l'autre bout : avant
-- d'ajouter une VALEUR, vérifier ce que la contrainte accepte. C'est le même
-- défaut, et il est trois fois plus discret — rien ne change au déploiement, la
-- panne attend le premier usage réel.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QUE CHACUNE CASSAIT
-- ─────────────────────────────────────────────────────────────────────────
--
-- `extra_hours_status` — `accepte_presta`
--
--   L'état « le prestataire a fixé son tarif, le client n'a pas encore réglé »,
--   introduit avec la prolongation payante le 17/08. Sans lui, AUCUNE
--   prolongation ne peut être acceptée : le prestataire voit un message
--   d'erreur, le client n'est jamais sollicité, et les heures supplémentaires
--   ne se vendent pas.
--
-- `delay_status` — `pending`
--
--   Le plus grave des trois. Cette valeur est écrite par `checkin_mission` et
--   `start_mission` quand le prestataire a plus de quinze minutes de retard,
--   DANS LE MÊME PATCH que `arrived_at` et `started_at`.
--
--   Une contrainte qui refuse une colonne fait échouer TOUTE l'écriture. Le
--   pointage lui-même échouait donc — mais uniquement en cas de retard, c'est
--   pourquoi personne ne l'a vu : un prestataire ponctuel n'écrit pas
--   `delay_status`. Le mécanisme d'arbitrage du décalage (CGPS art. 10C) n'a
--   ainsi jamais pu se déclencher une seule fois.
--
-- `payout_status` — `held`
--
--   La retenue de l'article 7.4, outillée le 14/08. Le backoffice l'écrit
--   (`bo-action`, retenue manuelle) et l'exécution d'une résolution de litige
--   aussi. Refusée, la prestation restait dans la file des versements
--   automatiques : une retenue décidée ne retenait rien.
--
-- ─────────────────────────────────────────────────────────────────────────
-- MÉTHODE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Les listes ci-dessous viennent d'un relevé exhaustif des valeurs écrites et
-- comparées dans `api/` et `src/`, pas d'une lecture de mémoire. `NULL` est
-- rendu explicite : les contraintes d'origine le toléraient déjà par accident
-- — une comparaison avec NULL vaut NULL, et une CHECK ne rejette que ce qui est
-- franchement faux — mais un comportement acquis par accident se perd au
-- premier remaniement.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Prolongation : l'état intermédiaire avant règlement du client.
ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_extra_hours_status_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_extra_hours_status_check CHECK (
    extra_hours_status IS NULL
    OR extra_hours_status IN ('pending', 'accepte_presta', 'accepted', 'refused')
  );

-- 2. Décalage d'horaire : l'attente d'arbitrage par le client.
ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_delay_status_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_delay_status_check CHECK (
    delay_status IS NULL
    OR delay_status IN ('pending', 'approved', 'rejected')
  );

-- 3. Versement : la retenue de l'article 7.4.
ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_payout_status_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_payout_status_check CHECK (
    payout_status IS NULL
    OR payout_status IN ('pending', 'processing', 'transferred', 'failed', 'held')
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conrelid = 'public.missions'::regclass AND contype = 'c'
--    ORDER BY conname;
--
-- Les trois doivent citer les valeurs ajoutées : `accepte_presta`, `pending`
-- pour le décalage, `held` pour le versement.
--
-- CONTRÔLES DEPUIS L'APPLICATION :
--
--   1. côté client, demander une prolongation ; côté prestataire, l'accepter en
--      annonçant un tarif → « Proposition envoyée », plus de message d'erreur ;
--   2. pointer une arrivée AVEC PLUS DE QUINZE MINUTES DE RETARD sur l'heure
--      prévue → le pointage doit aboutir et le client être notifié du décalage.
--      C'est le contrôle qui manquait : sans retard, le défaut ne se voit pas ;
--   3. backoffice → Versements → retenir un versement avec un motif → la
--      prestation doit passer en « retenu » et sortir de la file automatique.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aucun n'est souhaitable : ces contraintes n'ont jamais protégé de rien, elles
-- refusaient du code légitime. Rétrécir à nouveau les listes remettrait en
-- panne la prolongation, le pointage en retard et la retenue.
-- ═══════════════════════════════════════════════════════════════════════════
