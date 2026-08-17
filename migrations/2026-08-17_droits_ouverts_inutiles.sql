-- ═══════════════════════════════════════════════════════════════════════════
-- Fermer les droits ouverts que personne n'utilise
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le relevé des règles ouvertes au rôle `public`, le 17/08/2026, montre quatre
-- policies `ALL` — c'est-à-dire SELECT, INSERT, UPDATE **et DELETE** — et deux
-- doublons. Chacune est correctement bornée aux lignes de l'intéressé. Aucune
-- ne correspond à un geste que l'application fait réellement.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. `documents` — un prestataire pouvait supprimer ses propres pièces
-- ─────────────────────────────────────────────────────────────────────────
--
--   documents | docs_own | ALL | {public} | USING (auth.uid() = prestataire_id)
--
-- `ALL` comprend DELETE. Un prestataire pouvait donc effacer sa pièce
-- d'identité, son Kbis, son attestation RC Pro — y compris après vérification.
--
-- C'est la trace de la vigilance qui disparaît. L'article 14.4 des CGPS dit
-- l'inverse : « la trace de la vérification — sa date et sa nature — est
-- conservée sans la pièce, ALANE devant pouvoir justifier de ses obligations
-- de vigilance ». Une trace que l'intéressé peut effacer ne justifie rien.
--
-- L'application ne supprime jamais de document : elle en dépose (`upsert`) et
-- en lit. Les trois policies qui restent — `docs_insert`, `docs_update`,
-- `documents_presta_own` — couvrent exactement ces deux gestes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. `contracts` — un client pouvait supprimer le contrat signé
-- ─────────────────────────────────────────────────────────────────────────
--
--   contracts | contracts_client_own | ALL | {public} | USING (client_id = auth.uid())
--
-- Même défaut, sur la pièce la plus lourde. Le contrat de prestation est ce
-- qui prouve ce qui a été commandé, à quel prix, et par qui. Le client pouvait
-- le réécrire ou le faire disparaître.
--
-- L'application ne fait qu'en créer un, et le lire. D'où deux règles
-- explicites, à la place d'un `ALL`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 3. `tracking_positions` — le contournement de la fenêtre de partage
-- ─────────────────────────────────────────────────────────────────────────
--
--   tracking_positions | tracking_presta_write | ALL | {public}
--
-- Le partage de position est borné depuis ce matin à la fenêtre de la
-- prestation — d'une heure avant le début à une heure après la fin — parce
-- qu'en dehors, ce qu'on diffuse n'est plus le trajet vers une prestation mais
-- le domicile de quelqu'un.
--
-- Ce contrôle vit dans `update_position`, côté serveur. Cette policy permettait
-- d'écrire directement dans la table, donc de le contourner intégralement.
--
-- L'application ne touche jamais `tracking_positions` : tout passe par
-- `update_position` et `get_position`. La règle ne sert donc à rien d'autre
-- qu'à rouvrir ce qu'on vient de fermer.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 4. `candidatures` — une écriture vers un chemin de paiement
-- ─────────────────────────────────────────────────────────────────────────
--
--   candidatures | candidatures_presta_insert | INSERT | {public}
--
-- Une candidature acceptée déclenche la création d'un PaymentIntent (action
-- `accept`). Or aucun écran ne crée de candidature : il n'existe ni bouton
-- « postuler », ni insertion depuis `src/`. Le serveur, lui, ne fait que les
-- lire (`get_candidatures`, `mes_candidatures`).
--
-- Cette règle ouvre donc une écriture vers un chemin qui mène à de l'argent,
-- pour un geste que l'application ne propose pas. Si la fonctionnalité revient
-- un jour, elle passera par /api comme les autres — avec les contrôles de
-- quota, de secteur et d'activation qui vont avec.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 5. Deux doublons de lecture sur `missions`
-- ─────────────────────────────────────────────────────────────────────────
--
--   missions_open_read : status IN ('open','needs_replacement') OR partie prenante
--   missions_select    : status = 'open'                        OR partie prenante
--
-- Les policies permissives s'additionnent : la seconde n'ajoute rien à la
-- première, elle la répète en plus étroit. Deux règles qui disent presque la
-- même chose, c'est celle qu'on oublie de modifier le jour où la règle change.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Documents : plus de suppression.
DROP POLICY IF EXISTS docs_own ON public.documents;

-- 2. Contrats : lecture et création, rien d'autre.
DROP POLICY IF EXISTS contracts_client_own ON public.contracts;

CREATE POLICY contracts_client_lecture ON public.contracts
  FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()));

CREATE POLICY contracts_client_creation ON public.contracts
  FOR INSERT TO authenticated
  WITH CHECK (client_id = (SELECT auth.uid()));

-- 3. Positions : le serveur, et lui seul.
DROP POLICY IF EXISTS tracking_presta_write ON public.tracking_positions;

-- 4. Candidatures : plus d'insertion depuis le navigateur.
DROP POLICY IF EXISTS candidatures_presta_insert ON public.candidatures;

-- 5. Le doublon de lecture, le plus étroit des deux.
DROP POLICY IF EXISTS missions_select ON public.missions;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT tablename, policyname, cmd, roles::text
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('documents','contracts','tracking_positions',
--                        'candidatures','missions')
--    ORDER BY tablename, cmd, policyname;
--
-- Plus aucune ligne avec `cmd = 'ALL'`. `tracking_positions` ne doit plus
-- apparaître du tout.
--
-- CONTRÔLES DEPUIS L'APPLICATION — dans cet ordre :
--
--   1. déposer un document en tant que prestataire → doit fonctionner ;
--   2. remplacer ce même document par un autre → doit fonctionner (`upsert`) ;
--   3. réserver une prestation → le contrat doit se créer et s'afficher ;
--   4. pendant une prestation, envoyer sa position → doit fonctionner ;
--   5. côté client, voir la position du prestataire → doit fonctionner.
--
-- Les points 4 et 5 passent par /api : ils ne dépendent pas des policies
-- retirées. S'ils échouent, c'est un autre problème.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    CREATE POLICY docs_own ON public.documents
--      FOR ALL TO authenticated USING ((SELECT auth.uid()) = prestataire_id);
--
--    CREATE POLICY contracts_client_own ON public.contracts
--      FOR ALL TO authenticated USING (client_id = (SELECT auth.uid()));
--
--    CREATE POLICY tracking_presta_write ON public.tracking_positions
--      FOR ALL TO authenticated USING (prestataire_id = (SELECT auth.uid()));
--
--    CREATE POLICY candidatures_presta_insert ON public.candidatures
--      FOR INSERT TO authenticated
--      WITH CHECK (prestataire_id = (SELECT auth.uid()));
--
-- Chacune rouvre le défaut décrit plus haut. À ne faire que le temps de
-- rétablir un geste réellement cassé, et en le signalant.
-- ═══════════════════════════════════════════════════════════════════════════
