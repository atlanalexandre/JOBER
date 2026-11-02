-- ═══════════════════════════════════════════════════════════════════════════
-- invitation_clients
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (décision d'Alexandre du 02/11/2026 — « Invitez vos clients »)
--
-- Un prestataire invite un client avec son lien. Quand ce client, nouveau,
-- termine une première prestation d'au moins 50 € sans litige, il reçoit ses
-- frais de service en cashback et le prestataire un mois offert
-- (api/_invitation.js). Il faut noter, sur la fiche du CLIENT, que la
-- récompense a été versée : sans cela, chaque passage du traitement
-- automatique la verserait de nouveau.
--
--   invitation_recompensee_at   moment où la récompense a été réservée ; NULL
--                               tant qu'elle n'est pas due. L'écriture est
--                               conditionnée à NULL : une seule fois par client.
--   invitation_mission_id       la prestation qui l'a ouverte.
--   invitation_frais_offerts    les euros crédités en cashback au client.
--   invitation_mois_offert      le prestataire a-t-il reçu son mois ? (false :
--                               plafond de 6 par an atteint, ou carte du client
--                               identique à celle du prestataire). Sert au
--                               plafond.
--
-- Le navigateur ne peut PAS les écrire : les droits de `profiles` sont accordés
-- colonne par colonne (15 colonnes, voir 2026-10-14_secu_profils_siret_non_modifiable.sql),
-- et une colonne nouvelle n'en reçoit aucun. Aucun INSERT n'est permis au
-- navigateur. Seul le serveur (service role) les écrit.
--
-- Contrainte : aucune (CLAUDE.md 1.6). Rien n'est détruit ni réécrit.
-- ORDRE : indifférent. Avant la migration, le traitement journalise que la
-- colonne manque et ne verse rien ; l'écran d'invitation affiche le lien.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invitation_recompensee_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invitation_mission_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invitation_frais_offerts numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invitation_mois_offert boolean;

COMMENT ON COLUMN public.profiles.invitation_recompensee_at IS
  'Invitez vos clients : récompense versée (client invité). Écrite par le serveur seul, une fois.';

-- Le plafond se compte par prestataire invitant.
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles (referred_by);

-- ── Vérifications ──────────────────────────────────────────────────────────
--
-- 1. Les quatre colonnes existent — ATTENDU : 4.
--
-- SELECT count(*) FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name LIKE 'invitation_%';
--
-- 2. Le navigateur ne peut pas les écrire — ATTENDU : false, false.
--
-- SELECT has_column_privilege('authenticated', 'public.profiles', 'invitation_recompensee_at', 'UPDATE'),
--        has_column_privilege('authenticated', 'public.profiles', 'invitation_mois_offert', 'UPDATE');
--
-- ── Retour arrière ─────────────────────────────────────────────────────────
--
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS invitation_recompensee_at,
--   DROP COLUMN IF EXISTS invitation_mission_id, DROP COLUMN IF EXISTS invitation_frais_offerts,
--   DROP COLUMN IF EXISTS invitation_mois_offert;
