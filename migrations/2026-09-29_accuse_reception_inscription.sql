-- ═══════════════════════════════════════════════════════════════════════════
-- Accusé de réception automatique de l'inscription d'un prestataire
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (29/09/2026)
--
-- Alexandre envoyait ce courriel à la main, à chaque inscription. Le courriel
-- automatique partait du navigateur avec la session de l'inscription — et il
-- n'y en a plus depuis que la confirmation de l'adresse e-mail est active. Le
-- serveur l'envoie désormais lui-même (api/_accuse_inscription.js), une seule
-- fois : cette colonne le marque.
--
-- LES INSCRITS D'AVANT NE LE RECEVRONT PAS
--
-- Tous les prestataires existants sont marqués comme déjà prévenus : Alexandre
-- leur a écrit à la main, et un second courriel, des semaines après, ferait
-- désordre. Seules les inscriptions postérieures à cette migration le reçoivent.
--
-- ORDRE : cette migration (recette, puis production) AVANT le déploiement.
-- Sans elle, le traitement automatique ne trouverait pas la colonne et
-- n'enverrait rien — sans rien casser d'autre, mais en silence.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS accuse_inscription_at timestamptz;

COMMENT ON COLUMN public.profiles.accuse_inscription_at IS
  'Envoi de l''accusé de réception de l''inscription (prestataire). Écrit par le serveur '
  'seul, une fois ; les comptes antérieurs au 29/09/2026 sont marqués sans envoi.';

UPDATE public.profiles
   SET accuse_inscription_at = now()
 WHERE role = 'prestataire' AND accuse_inscription_at IS NULL;

REVOKE UPDATE (accuse_inscription_at) ON public.profiles FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — attendu : 0 (aucun prestataire existant ne recevra le courriel)
--    SELECT count(*) FROM public.profiles
--     WHERE role = 'prestataire' AND accuse_inscription_at IS NULL;
-- ═══════════════════════════════════════════════════════════════════════════
