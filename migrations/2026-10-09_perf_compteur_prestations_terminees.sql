-- ═══════════════════════════════════════════════════════════════════════════
-- `prestations_terminees_par_prestataire` : le compteur du catalogue, calculé
-- par la base
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- Pour afficher « N prestations réalisées » sur chaque fiche, /api/prestataires
-- lit TOUTES les prestations terminées de la plateforme, ligne par ligne, puis
-- les compte (depuis le 08/10/2026 — avant, la lecture échouait et chaque fiche
-- affichait zéro). Le volume lu croît sans fin avec l'activité : des dizaines de
-- pages de 1 000 lignes à chaque calcul du catalogue, puis un échec au-delà du
-- garde-fou de 50 000 lignes de `lireTout()`. Relevé à la relecture du
-- 09/10/2026 ; correction demandée par Alexandre.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Une fonction qui rend UNE ligne par prestataire (son identifiant et son nombre
-- de prestations terminées) : le volume lu suit le nombre de prestataires, plus
-- celui des prestations.
--
-- COMPATIBILITÉ : le code appelle la fonction et, si elle est absente ou en
-- erreur, garde sa lecture actuelle. Il fonctionne avant comme après la
-- migration.
--
-- Lecture seule, aucune donnée modifiée. Seul le service role peut l'appeler.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prestations_terminees_par_prestataire()
RETURNS TABLE (prestataire_id uuid, nombre bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.prestataire_id, count(*)::bigint
  FROM public.missions m
  WHERE m.status = 'completed' AND m.prestataire_id IS NOT NULL
  GROUP BY m.prestataire_id
$$;

REVOKE ALL ON FUNCTION public.prestations_terminees_par_prestataire() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prestations_terminees_par_prestataire() TO service_role;

-- Vérification attendue : une ligne, `existe = true`.
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'prestations_terminees_par_prestataire'
) AS existe;
