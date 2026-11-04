-- ═══════════════════════════════════════════════════════════════════════════
-- garantie_mois_sans_proposition
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (décision d'Alexandre du 04/11/2026)
--
-- Un prestataire abonné (Premium ou Elite) à qui AUCUNE prestation n'a été
-- proposée pendant un mois civil entier — alors qu'il était disponible — reçoit
-- le mois suivant offert. UNE SEULE FOIS. Une prestation proposée, même
-- refusée ou laissée sans réponse, compte : rien n'est alors offert.
--
-- Il faut donc PROUVER ce qui a été proposé. Les notifications ne le peuvent
-- pas : le prestataire peut modifier les siennes (titre, type compris). D'où
-- un registre que seul le serveur écrit :
--
--   propositions_recues   une ligne par prestation proposée à un prestataire
--                         (choix du client, cascade, série, diffusion).
--
-- Et sur la fiche du prestataire :
--
--   garantie_mois_offert_at    quand le mois a été offert (écriture
--                              conditionnée à NULL : une seule fois) ;
--   garantie_mois_offert_mois  le mois sans proposition, « 2026-12 ».
--
-- DROITS : RLS activée, aucune policy : le navigateur ne lit ni n'écrit
-- `propositions_recues`. Les deux colonnes de `profiles` ne reçoivent aucun
-- droit (accordés colonne par colonne). Seul le service role les écrit.
-- Contrainte : aucune (CLAUDE.md 1.6). Rien n'est détruit ni réécrit.
-- ORDRE : indifférent. Sans la table, l'inscription d'une proposition échoue
-- et est journalisée, sans rien bloquer ; sans les colonnes, aucun mois n'est
-- offert, et c'est journalisé.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.propositions_recues (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id uuid NOT NULL,
  mission_id     uuid,
  canal          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.propositions_recues IS
  'Prestations proposées à un prestataire (garantie « mois sans proposition »). Écrite par le serveur seul.';

ALTER TABLE public.propositions_recues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.propositions_recues FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS propositions_recues_presta_date_idx
  ON public.propositions_recues (prestataire_id, created_at);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS garantie_mois_offert_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS garantie_mois_offert_mois text;

-- ── Vérifications ──────────────────────────────────────────────────────────
--
-- 1. La table et les deux colonnes existent — ATTENDU : 1, 2.
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'propositions_recues'),
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'profiles' AND column_name LIKE 'garantie_mois_offert%');
--
-- 2. Le navigateur n'y a pas accès — ATTENDU : false, false, false.
-- SELECT has_table_privilege('authenticated', 'public.propositions_recues', 'SELECT'),
--        has_table_privilege('authenticated', 'public.propositions_recues', 'INSERT'),
--        has_column_privilege('authenticated', 'public.profiles', 'garantie_mois_offert_at', 'UPDATE');
--
-- ── Retour arrière ─────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.propositions_recues;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS garantie_mois_offert_at, DROP COLUMN IF EXISTS garantie_mois_offert_mois;
