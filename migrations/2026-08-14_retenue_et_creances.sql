-- ═══════════════════════════════════════════════════════════════════════════
-- Retenue de versement (CGPS art. 7.4) et compensation sur rémunérations
-- à venir (CGPS art. 8B.3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Ces deux articles décrivent depuis leur rédaction des mécanismes qui
-- n'existaient pas dans le produit. Aucun bouton ne permettait de retenir un
-- versement ; aucun calcul ne récupérait une somme remboursée au client.
--
-- Une clause qu'on n'exerce jamais se lit mal en contentieux : soit on la
-- supprime, soit on l'outille. Alexandre a tranché pour l'outillage.
--
-- ── CE QUE FAIT L'ARTICLE 7.4 ──────────────────────────────────────────────
--
-- ALANE peut suspendre un versement pour cinq motifs limitativement énumérés.
-- La retenue est notifiée au prestataire, avec son motif et son montant, au
-- plus tard le jour où elle prend effet. Elle ne peut excéder quatre-vingt-dix
-- jours, sauf procédure judiciaire ou opposition bancaire en cours.
--
-- Techniquement, c'est un quatrième état du versement : `held`. Il sort la
-- prestation du traitement automatique sans la marquer en échec — un `failed`
-- signifie « Stripe a refusé », pas « ALANE a décidé de retenir ».
--
-- ── CE QUE FAIT L'ARTICLE 8B.3 ─────────────────────────────────────────────
--
-- Quand ALANE a remboursé un client pour une somme déjà versée au prestataire,
-- cette somme lui est due. Elle se récupère par compensation sur les
-- versements à venir, DANS LA LIMITE DE LA MOITIÉ de chacun d'eux.
--
-- Cette limite est le cœur du mécanisme et la raison de la table : sans suivi
-- du reste dû, on ne peut ni s'arrêter à l'extinction, ni prouver le calcul au
-- prestataire, ni constater les soixante jours au terme desquels la somme
-- devient exigible.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Retenue de versement (art. 7.4) ─────────────────────────────────────

-- Motif de la retenue, tel qu'il est notifié au prestataire. Les cinq valeurs
-- reprennent l'énumération limitative de l'article : une retenue sans motif
-- prévu au contrat serait une retenue sans fondement.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS payout_hold_reason text,
  ADD COLUMN IF NOT EXISTS payout_hold_at     timestamptz,
  ADD COLUMN IF NOT EXISTS payout_hold_until  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'missions_payout_hold_reason_check'
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_payout_hold_reason_check
      CHECK (payout_hold_reason IS NULL OR payout_hold_reason IN (
        'reclamation_client',      -- une réclamation du Client sur la Prestation
        'opposition_bancaire',     -- opposition ou procédure de rétrofacturation
        'suspicion_fraude',        -- indices sérieux de fraude ou de fausse déclaration
        'creance_alane',           -- une créance d'ALANE au titre de l'art. 8B.3
        'demande_autorite'         -- demande judiciaire, administrative ou du PSP
      ));
  END IF;
END $$;

-- Les retenues arrivées au terme des 90 jours sans réclamation confirmée
-- doivent être relevées : l'article prévoit qu'elles se lèvent d'elles-mêmes.
CREATE INDEX IF NOT EXISTS missions_payout_retenue_idx
  ON public.missions (payout_hold_until)
  WHERE payout_status = 'held';


-- ── 2. Créances sur prestataire (art. 8B.3) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.creances_prestataires (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Montant dû à l'origine, et ce qu'il en reste après compensations.
  -- `montant_restant` ne descend jamais sous zéro : la moitié d'un versement
  -- peut dépasser le reste dû, on ne prélève alors que le reste.
  montant_initial  numeric(10,2) NOT NULL CHECK (montant_initial > 0),
  montant_restant  numeric(10,2) NOT NULL CHECK (montant_restant >= 0),

  -- D'où vient la dette. `mission_id` est la prestation remboursée, quand elle
  -- est identifiée — ON DELETE SET NULL : supprimer une prestation ne doit pas
  -- effacer la créance qu'elle a fait naître.
  motif            text NOT NULL,
  mission_id       uuid REFERENCES public.missions(id) ON DELETE SET NULL,

  statut           text NOT NULL DEFAULT 'active'
                   CHECK (statut IN ('active', 'contestee', 'eteinte', 'abandonnee')),

  -- L'article impose d'informer le prestataire, avec le détail du calcul,
  -- AVANT la première retenue. Tant que `notifiee_at` est nul, aucune
  -- compensation ne doit être prélevée — c'est la condition, pas une formalité.
  notifiee_at      timestamptz,

  -- Une contestation suspend la compensation jusqu'à examen contradictoire.
  contestee_at     timestamptz,

  -- Soixante jours après la notification, la somme devient exigible et se
  -- recouvre par les voies de droit commun.
  exigible_at      timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creances_prestataire_actives_idx
  ON public.creances_prestataires (prestataire_id)
  WHERE statut = 'active' AND montant_restant > 0;

-- Journal des compensations : quelle créance, quelle prestation, combien.
-- Sans lui, on ne peut pas montrer au prestataire le détail du calcul que
-- l'article lui promet.
CREATE TABLE IF NOT EXISTS public.compensations_versements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creance_id    uuid NOT NULL REFERENCES public.creances_prestataires(id) ON DELETE CASCADE,
  mission_id    uuid REFERENCES public.missions(id) ON DELETE SET NULL,
  montant       numeric(10,2) NOT NULL CHECK (montant > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Une même prestation ne peut donner lieu qu'à une compensation par créance,
  -- quel que soit le nombre de passages du traitement.
  UNIQUE (creance_id, mission_id)
);

-- Montant réellement retenu sur le versement, pour que le prestataire le
-- retrouve en face de sa prestation et pas seulement dans un journal.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS payout_compensation numeric(10,2);


-- ── 3. RLS ─────────────────────────────────────────────────────────────────
--
-- Le prestataire lit ce qui le concerne, et rien d'autre. Aucune écriture
-- depuis le navigateur : créer ou éteindre une créance est une opération
-- d'argent, elle passe par /api avec la clé service role (CLAUDE.md §3.3).

ALTER TABLE public.creances_prestataires   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compensations_versements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creances_lecture_proprietaire ON public.creances_prestataires;
CREATE POLICY creances_lecture_proprietaire
  ON public.creances_prestataires FOR SELECT
  TO authenticated
  USING (prestataire_id = auth.uid());

DROP POLICY IF EXISTS compensations_lecture_proprietaire ON public.compensations_versements;
CREATE POLICY compensations_lecture_proprietaire
  ON public.compensations_versements FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.creances_prestataires c
    WHERE c.id = creance_id AND c.prestataire_id = auth.uid()
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Les colonnes et les tables :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions'
--      AND column_name IN ('payout_hold_reason','payout_hold_at','payout_hold_until','payout_compensation');
--    -- attendu : 4 lignes
--
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('creances_prestataires','compensations_versements');
--    -- attendu : 2 lignes
--
-- 2. La RLS est bien active et fermée en écriture :
--
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE tablename IN ('creances_prestataires','compensations_versements');
--    -- attendu : rowsecurity = true sur les deux
--
--    SELECT tablename, cmd, roles FROM pg_policies
--    WHERE tablename IN ('creances_prestataires','compensations_versements');
--    -- attendu : uniquement des policies SELECT
--
-- 3. Les retenues en cours, une fois le backoffice utilisé :
--
--    SELECT id, payout_hold_reason, payout_hold_at, payout_hold_until
--    FROM missions WHERE payout_status = 'held' ORDER BY payout_hold_until;
--
-- 4. Aucune retenue ne doit dépasser son terme :
--
--    SELECT count(*) FROM missions
--    WHERE payout_status = 'held' AND payout_hold_until < now() - interval '6 hours';
--    -- attendu : 0 — sinon le traitement de levée ne tourne pas
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TABLE IF EXISTS public.compensations_versements;
--    DROP TABLE IF EXISTS public.creances_prestataires;
--    DROP INDEX IF EXISTS missions_payout_retenue_idx;
--    ALTER TABLE public.missions
--      DROP CONSTRAINT IF EXISTS missions_payout_hold_reason_check,
--      DROP COLUMN IF EXISTS payout_hold_reason,
--      DROP COLUMN IF EXISTS payout_hold_at,
--      DROP COLUMN IF EXISTS payout_hold_until,
--      DROP COLUMN IF EXISTS payout_compensation;
--
-- Attention : les prestations en `held` redeviendraient payables au passage
-- suivant du traitement. Les relever avant.
-- ═══════════════════════════════════════════════════════════════════════════
