-- ═══════════════════════════════════════════════════════════════════════════
-- pilotage_acceptee_at
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (demande d'Alexandre du 01/11/2026 — pilotage de l'activité)
--
-- Le tableau « 📈 Pilotage de l'activité » du back-office suit le délai entre
-- une réservation et l'acceptation du prestataire : long, les clients
-- attendent et repartent. La base n'enregistrait nulle part ce moment —
-- `contrat_presta_signe_at` n'est posé que sur certains chemins (e-mail,
-- reprise d'une demande diffusée, écran), pas quand le client choisit une
-- candidature, ni par le webhook Stripe, ni par la réaffectation du back-office.
--
-- Plutôt que d'écrire la date sur chacun des chemins (et d'en oublier un), un
-- déclencheur la pose dès que la prestation PASSE à `assigned`, quel que soit
-- le chemin — à la PREMIÈRE acceptation seulement, c'est-à-dire en sortant
-- d'une demande en attente (`open`, `pending_acceptance`). Un remplacement ou
-- une réaffectation ne la pose ni ne la déplace : c'est le délai de la première
-- acceptation qui compte pour le client. Seul l'éditeur SQL (rôle postgres)
-- peut la corriger à la main.
--
-- Le navigateur ne peut pas l'écrire : il n'a aucun droit UPDATE sur cette
-- colonne (les droits de `missions` sont accordés colonne par colonne), et à
-- l'INSERT — qu'il peut faire — le déclencheur impose la valeur.
--
-- Aucune date n'est inventée pour les prestations existantes : le moment de
-- leur acceptation n'est pas connu. Le délai ne porte que sur les acceptations
-- à venir.
--
-- ORDRE : indifférent. Le tableau (PR « pilotage de l'activité ») lit cette
-- colonne À PART et fonctionne sans elle ; elle fait apparaître le délai.
-- Contrainte : aucune (CLAUDE.md 1.6).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS acceptee_at timestamptz;

COMMENT ON COLUMN public.missions.acceptee_at IS
  'Première acceptation par un prestataire (passage à assigned). Posée par le déclencheur missions_acceptee_at, jamais par le code.';

CREATE OR REPLACE FUNCTION public.missions_poser_acceptee_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Imposée, jamais reçue : une ligne créée directement « assigned » (le
    -- serveur) prend l'heure de la base ; toute autre valeur fournie est effacée.
    NEW.acceptee_at := CASE WHEN NEW.status = 'assigned' THEN now() ELSE NULL END;
  ELSIF NEW.status = 'assigned' AND OLD.status IN ('open', 'pending_acceptance') AND OLD.acceptee_at IS NULL THEN
    -- PREMIÈRE acceptation : depuis une demande en attente seulement. Un
    -- retour à « assigned » depuis « remplaçant recherché » ou une réaffectation
    -- du back-office est un remplacement : une prestation acceptée AVANT cette
    -- migration aurait pris l'heure du remplaçant (relecture du 02/11/2026).
    NEW.acceptee_at := now();
  ELSIF current_user = 'postgres' THEN
    -- Correction à la main depuis l'éditeur SQL : permise. Ni le code (rôle
    -- service_role) ni le navigateur (authenticated) ne passent par ici.
    NULL;
  ELSE
    -- Jamais déplacée ni effacée par le code.
    NEW.acceptee_at := OLD.acceptee_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missions_acceptee_at ON public.missions;
CREATE TRIGGER missions_acceptee_at
  BEFORE INSERT OR UPDATE ON public.missions
  FOR EACH ROW EXECUTE FUNCTION public.missions_poser_acceptee_at();

-- ── Vérifications ──────────────────────────────────────────────────────────
--
-- 1. La colonne et le déclencheur existent — ATTENDU : 1 ligne, 1 ligne.
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'acceptee_at';
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.missions'::regclass AND tgname = 'missions_acceptee_at';
--
-- 2. Le navigateur ne peut pas l'écrire — ATTENDU : false.
--
-- SELECT has_column_privilege('authenticated', 'public.missions', 'acceptee_at', 'UPDATE');
--
-- 3. Après la première acceptation en recette — ATTENDU : une date proche de l'acceptation.
--
-- SELECT id, status, created_at, acceptee_at FROM public.missions
-- WHERE acceptee_at IS NOT NULL ORDER BY acceptee_at DESC LIMIT 5;
--
-- ── Retour arrière ─────────────────────────────────────────────────────────
--
-- DROP TRIGGER IF EXISTS missions_acceptee_at ON public.missions;
-- DROP FUNCTION IF EXISTS public.missions_poser_acceptee_at();
-- ALTER TABLE public.missions DROP COLUMN IF EXISTS acceptee_at;
