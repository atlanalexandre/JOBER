-- ═══════════════════════════════════════════════════════════════════════════
-- garantie_releve_quotidien
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (relecture quotidienne du 05/11/2026)
--
-- La garantie « mois sans proposition » (2026-11-04) exige que le prestataire
-- ait été disponible PENDANT TOUT le mois : abonné à jour de ses paiements,
-- accès aux prestations ouvert, des jours de disponibilité, un rayon d'au
-- moins 10 km. Elle ne le vérifiait que le jour du contrôle. Or :
--   • une suspension pour pièce périmée, levée avant le 1er, ne laissait
--     aucune trace (`missions_enabled_at` ne garde que la première ouverture) ;
--   • le rayon et les disponibilités vivent dans les métadonnées du compte,
--     que le prestataire modifie lui-même : un rayon d'1 km tout le mois,
--     remis à 20 km le 31, passait.
--
-- D'où un relevé chaque matin, que seul le serveur écrit :
--
--   garantie_releves   une ligne par abonné et par jour : disponible ou non, et
--                      pourquoi. Le mois n'est offert que si aucun relevé du
--                      mois n'est « indisponible ».
--
-- DROITS : RLS activée, aucune policy, aucun droit au navigateur.
-- Contrainte : aucune (CLAUDE.md 1.6). Rien n'est détruit ni réécrit.
-- ORDRE : indifférent. Sans la table, le relevé échoue et est journalisé, et
-- aucun mois n'est offert faute de relevés.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.garantie_releves (
  prestataire_id uuid NOT NULL,
  jour           date NOT NULL,
  disponible     boolean NOT NULL,
  raison         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prestataire_id, jour)
);
COMMENT ON TABLE public.garantie_releves IS
  'Relevé quotidien de la disponibilité des abonnés (garantie « mois sans proposition »). Écrit par le serveur seul.';

ALTER TABLE public.garantie_releves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.garantie_releves FROM anon, authenticated;

-- ── Vérifications ──────────────────────────────────────────────────────────
-- 1. La table existe, RLS active — ATTENDU : 1, true.
-- SELECT count(*), bool_and(relrowsecurity) FROM pg_class WHERE relname = 'garantie_releves';
-- 2. Le navigateur n'y a pas accès — ATTENDU : false, false.
-- SELECT has_table_privilege('authenticated', 'public.garantie_releves', 'SELECT'),
--        has_table_privilege('authenticated', 'public.garantie_releves', 'INSERT');
--
-- ── Retour arrière ─────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.garantie_releves;
