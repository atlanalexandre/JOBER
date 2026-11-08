-- ═══════════════════════════════════════════════════════════════════════════
-- Références d'expérience confirmées par e-mail (09/11/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Décision d'Alexandre du 09/11/2026 : pour les métiers sans diplôme, vérifier
-- l'expérience déclarée sans appeler chaque référence. Le prestataire indique
-- l'entreprise (SIRET) et l'e-mail d'un responsable ; ALANE lui écrit, et la
-- réponse donne la mention « Référence confirmée ».
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Une table `references_experience`. Le navigateur la LIT pour ses propres
-- lignes et n'y écrit jamais : l'ajout, l'envoi et la réponse passent par
-- /api/references, en service role. La réponse de la référence n'est
-- authentifiée que par un jeton à usage unique, dont seule l'empreinte
-- (sha-256) est conservée.
--
-- Supprimée avec le compte du prestataire (ON DELETE CASCADE) : les données
-- de la référence — nom, e-mail — ne lui survivent pas.
--
-- COMPATIBILITÉ
--
-- Ancien code : ignore la table. Nouveau code : en a besoin pour les
-- références ; sans elle, l'écran le dit et rien d'autre ne change.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.references_experience (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  siret           text NOT NULL CHECK (siret ~ '^[0-9]{14}$'),
  entreprise      text NOT NULL CHECK (char_length(entreprise) BETWEEN 1 AND 160),
  metier          text NOT NULL CHECK (char_length(metier) BETWEEN 1 AND 120),
  annee_debut     integer NOT NULL CHECK (annee_debut BETWEEN 1970 AND 2100),
  annee_fin       integer CHECK (annee_fin IS NULL OR annee_fin BETWEEN 1970 AND 2100),
  contact_nom     text NOT NULL CHECK (char_length(contact_nom) BETWEEN 2 AND 80),
  contact_email   text NOT NULL CHECK (char_length(contact_email) BETWEEN 6 AND 160),
  jeton_hash      text NOT NULL UNIQUE,
  statut          text NOT NULL DEFAULT 'en_attente'
                  CHECK (statut IN ('en_attente', 'confirmee', 'refusee', 'expiree')),
  alerte          text CHECK (alerte IS NULL OR char_length(alerte) <= 300),
  reponse         jsonb,
  envoyee_at      timestamptz,
  repondu_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS references_experience_prestataire_idx ON public.references_experience (prestataire_id);
CREATE INDEX IF NOT EXISTS references_experience_contact_idx ON public.references_experience (lower(contact_email));

ALTER TABLE public.references_experience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS references_lecture_proprietaire ON public.references_experience;
CREATE POLICY references_lecture_proprietaire ON public.references_experience
  FOR SELECT TO authenticated USING (prestataire_id = (SELECT auth.uid()));

-- Aucun droit d'écriture au navigateur : pas de policy INSERT/UPDATE/DELETE,
-- et les privilèges retirés par sûreté.
REVOKE ALL ON public.references_experience FROM anon, authenticated;
-- Lecture par colonnes : le prestataire voit l'état de ses références, pas
-- la réponse détaillée de la référence (son commentaire est confié à ALANE),
-- ni les alertes anti-fraude, ni l'empreinte du jeton.
GRANT SELECT (id, prestataire_id, siret, entreprise, metier, annee_debut, annee_fin,
              contact_nom, contact_email, statut, envoyee_at, repondu_at, created_at)
  ON public.references_experience TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'references_experience';   -- true
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'references_experience'; -- une ligne, SELECT
-- SELECT privilege_type, column_name FROM information_schema.column_privileges
--  WHERE table_name = 'references_experience' AND grantee = 'authenticated';         -- SELECT seulement, sans reponse ni alerte
