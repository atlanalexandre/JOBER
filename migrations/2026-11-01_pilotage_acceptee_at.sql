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
-- le chemin. Elle n'est posée qu'une fois : une réaffectation ultérieure
-- (remplacement) ne la déplace pas — c'est le délai de la PREMIÈRE acceptation
-- qui compte pour le client.
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
  ELSIF NEW.status = 'assigned' AND OLD.status IS DISTINCT FROM 'assigned' AND OLD.acceptee_at IS NULL THEN
    NEW.acceptee_at := now();
  ELSE
    -- Jamais déplacée ni effacée après coup.
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
