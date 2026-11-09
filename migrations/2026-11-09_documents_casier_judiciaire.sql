-- ═══════════════════════════════════════════════════════════════════════════
-- Documents : l'extrait de casier judiciaire (09/11/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Décision d'Alexandre du 09/11/2026 : ALANE exige un extrait de casier
-- judiciaire (bulletin n° 3) pour les métiers au contact d'enfants — garde
-- d'enfants, animation, soutien scolaire (METIERS_CASIER, api/_qualifications.js).
-- La pièce est déposée comme les autres, sous le type `casier`.
--
-- La contrainte `documents_type_check` ne connaît pas ce type : sans cette
-- migration, le dépôt monterait dans le storage mais serait refusé en base
-- (le piège de la règle 1.6 de CLAUDE.md).
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Elle ajoute `casier` à la liste, sans rien retirer. Valeurs relevées dans
-- api/ et src/ le 09/11/2026, identiques à la contrainte de production lue le
-- même jour en lecture seule, plus `casier`.
--
-- COMPATIBILITÉ
--
-- Ancien code : n'écrit jamais `casier`, la contrainte élargie ne le gêne pas.
-- Nouveau code : a besoin de cette migration pour enregistrer l'extrait.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_type_check CHECK (type = ANY (ARRAY[
  'photo', 'kbis', 'urssaf', 'cni', 'domicile', 'rib', 'rc_pro', 'diplomes', 'tva', 'autre',
  'titre_sejour', 'casier'
]));

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — doit citer 'casier'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_type_check';
