-- ═══════════════════════════════════════════════════════════════════════════
-- Le titre de séjour peut être enregistré (`documents.type = 'titre_sejour'`)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- Depuis le 11/09/2026, un ressortissant hors Union européenne doit fournir un
-- titre de séjour l'autorisant à exercer une activité non salariée
-- (`docsRequisPour()`, api/_documents.js). La contrainte `documents_type_check`
-- n'avait pas suivi : toute ligne `titre_sejour` était refusée par la base. La
-- pièce était donc réclamée, sans pouvoir jamais être déposée — et le dossier
-- de ces prestataires ne pouvait pas être complété.
--
-- C'est exactement le piège de CLAUDE.md §1.6 (contrainte plus étroite que les
-- valeurs réellement écrites). Relevé des valeurs du code le 25/09/2026 :
--   src/  : photo, kbis, urssaf, cni, domicile, rib, rc_pro, diplomes,
--           titre_sejour (DOCS_REQUIS), tva (espace client pro)
--   api/  : les mêmes, plus « autre » (libellés du back-office)
--   « rcpro » n'apparaît que dans des tables de libellés : jamais écrit.
--
-- Constaté en recette le 25/09/2026, confirmé en production (lecture seule) :
-- même contrainte, sans `titre_sejour`.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Elle ajoute `titre_sejour` à la liste, sans rien retirer.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_type_check CHECK (type = ANY (ARRAY[
  'photo', 'kbis', 'urssaf', 'cni', 'domicile', 'rib', 'rc_pro', 'diplomes', 'tva', 'autre',
  'titre_sejour'
]));

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — doit citer 'titre_sejour'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_type_check';
