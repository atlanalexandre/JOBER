-- ═══════════════════════════════════════════════════════════════════════════
-- Droit de remplacement du prestataire
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Les CGPS reconnaissent au prestataire la faculté de se faire remplacer par un
-- autre professionnel indépendant qualifié. C'est l'un des indices les plus forts
-- d'indépendance : un salarié ne peut jamais envoyer quelqu'un à sa place, alors
-- qu'un prestataire de services le peut, parce que le contrat porte sur un
-- service et non sur sa personne.
--
-- Ce droit n'existait que sur le papier. Le produit ne proposait qu'une
-- annulation : la prestation repartait sur la place de marché et n'importe quel
-- prestataire du secteur pouvait la prendre, sans que le sortant n'ait son mot à
-- dire ni ne conserve la moindre responsabilité.
--
-- Un droit écrit mais jamais exerçable est pire que pas de droit du tout : devant
-- un contrôle, il se lit comme de l'habillage contractuel. Cette table le rend
-- réel et, surtout, en conserve la trace — pouvoir montrer que la faculté a été
-- exercée vaut mieux que pouvoir montrer qu'elle est écrite.
--
-- CE QUE STOCKE LA TABLE
--
-- Une ligne par demande de remplacement. Le remplacement n'est exécuté que
-- lorsque les DEUX accords sont recueillis :
--
--   • celui du remplaçant, qui est un indépendant et ne peut pas être volontaire
--     d'office pour une prestation qu'il n'a pas acceptée ;
--   • celui du client, qui reçoit un professionnel dans ses locaux ou chez son
--     propre client, et dont l'accord préalable a été retenu comme condition.
--
-- Tant que l'un des deux manque, la prestation reste au prestataire sortant, qui
-- demeure engagé. Un refus, de l'un ou de l'autre, clôt la demande sans rien
-- changer : le sortant reste libre d'annuler par la voie ordinaire.
--
-- STATUTS
--
--   en_attente  demande ouverte, un accord au moins manquant
--   accepte     les deux accords recueillis, la prestation a changé de titulaire
--   refuse      refus du client ou du remplaçant
--   annule      retirée par le prestataire sortant avant exécution
--   expire      la prestation a commencé sans que les accords soient réunis
--
-- ARGENT
--
-- Aucune écriture financière ici. Le virement de fin de prestation lit
-- `missions.prestataire_id` : basculer ce champ suffit à ce que le remplaçant
-- soit payé pour le travail qu'il a réellement fait, et à ce qu'il facture en son
-- nom. C'est aussi ce que veut l'URSSAF : chacun facture ce qu'il a exécuté.
--
-- SÉCURITÉ
--
-- Écriture réservée au service role, via /api/missions. Le navigateur ne peut ni
-- s'auto-désigner remplaçant, ni s'accorder à lui-même l'accord du client.
-- La lecture est ouverte aux trois personnes concernées.
--
-- COMPATIBILITÉ
--
-- Sans cette migration, les actions `proposer_remplacant`, `repondre_remplacement`
-- et `annuler_remplacement` répondent 503 avec un message explicite, et le bouton
-- correspondant est masqué. Le reste de l'application n'est pas affecté :
-- l'annulation ordinaire continue de fonctionner comme avant.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mission_remplacements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id            uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,

  -- Le prestataire qui demande à être remplacé, et celui qu'il propose.
  sortant_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entrant_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  statut                text NOT NULL DEFAULT 'en_attente',

  -- Motif communiqué au client. Facultatif : personne n'a à justifier un
  -- empêchement, mais un motif renseigné rassure et accélère l'accord.
  motif                 text,

  -- Horodatage de chaque accord. NULL tant qu'il n'est pas donné.
  accord_entrant_at     timestamptz,
  accord_client_at      timestamptz,

  -- Qui a refusé, et pourquoi, lorsque le statut est 'refuse'.
  refus_par             text,
  refus_motif           text,

  execute_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mission_remplacements_statut_valide
    CHECK (statut IN ('en_attente','accepte','refuse','annule','expire')),

  CONSTRAINT mission_remplacements_refus_par_valide
    CHECK (refus_par IS NULL OR refus_par IN ('client','entrant')),

  -- On ne se remplace pas par soi-même.
  CONSTRAINT mission_remplacements_personnes_distinctes
    CHECK (sortant_id <> entrant_id)
);

-- Une seule demande ouverte à la fois par prestation. Sans cela, un prestataire
-- pourrait proposer trois remplaçants et laisser le client arbitrer — ce qui
-- reviendrait à lui rendre le choix nominatif que l'article 5.2 lui retire.
CREATE UNIQUE INDEX IF NOT EXISTS mission_remplacements_une_seule_en_attente
  ON public.mission_remplacements (mission_id)
  WHERE statut = 'en_attente';

CREATE INDEX IF NOT EXISTS mission_remplacements_mission_idx  ON public.mission_remplacements (mission_id);
CREATE INDEX IF NOT EXISTS mission_remplacements_entrant_idx  ON public.mission_remplacements (entrant_id) WHERE statut = 'en_attente';
CREATE INDEX IF NOT EXISTS mission_remplacements_client_idx   ON public.mission_remplacements (client_id)  WHERE statut = 'en_attente';

-- updated_at tenu à jour côté base : le laisser au code, c'est l'oublier.
CREATE OR REPLACE FUNCTION public.mission_remplacements_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mission_remplacements_touch_trg ON public.mission_remplacements;
CREATE TRIGGER mission_remplacements_touch_trg
  BEFORE UPDATE ON public.mission_remplacements
  FOR EACH ROW EXECUTE FUNCTION public.mission_remplacements_touch();


-- ── Sécurité ───────────────────────────────────────────────────────────────
--
-- Lecture ouverte aux trois personnes concernées : le sortant suit sa demande,
-- le remplaçant voit ce qu'on lui propose, le client voit qui viendra chez lui.
-- Aucune écriture depuis le navigateur : tout passe par /api/missions, qui seul
-- vérifie les qualifications du remplaçant et l'ordre des accords.

ALTER TABLE public.mission_remplacements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_remplacements_lecture_concernes ON public.mission_remplacements;
CREATE POLICY mission_remplacements_lecture_concernes
  ON public.mission_remplacements
  FOR SELECT
  TO authenticated
  USING (auth.uid() IN (sortant_id, entrant_id, client_id));

-- Aucune policy INSERT/UPDATE/DELETE : le rôle `authenticated` ne peut donc pas
-- écrire. Le service role contourne la RLS et reste seul habilité.


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La table et ses contraintes existent :
--
--    SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.mission_remplacements'::regclass
--    ORDER BY conname;
--
--    Attendu : les trois CHECK, la clé primaire et les quatre clés étrangères.
--
-- 2. Une seule demande ouverte par prestation :
--
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'mission_remplacements'
--      AND indexname = 'mission_remplacements_une_seule_en_attente';
--
-- 3. La RLS est active et n'autorise que la lecture :
--
--    SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.mission_remplacements'::regclass;          -- attendu : true
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'mission_remplacements';                     -- attendu : 1 ligne, SELECT
--
-- 4. Une fois la fonctionnalité utilisée, la preuve que le droit est réel :
--
--    SELECT statut, count(*) FROM mission_remplacements GROUP BY statut;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TRIGGER IF EXISTS mission_remplacements_touch_trg ON public.mission_remplacements;
--    DROP FUNCTION IF EXISTS public.mission_remplacements_touch();
--    DROP TABLE IF EXISTS public.mission_remplacements;
--
-- Attention : efface l'historique des remplacements, qui a une valeur probatoire
-- en cas de contrôle URSSAF. Exporter la table avant toute suppression.
-- ═══════════════════════════════════════════════════════════════════════════
