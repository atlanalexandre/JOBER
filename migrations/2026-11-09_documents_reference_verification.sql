-- ═══════════════════════════════════════════════════════════════════════════
-- Documents : la référence qui permet de vérifier un titre (09/11/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Décision d'Alexandre du 09/11/2026 : vérifier les qualifications sans
-- rappeler chaque prestataire. Le back-office ouvre déjà le service officiel à
-- côté de la pièce (CNAPS, QR code des diplômes). Il lui manquait la référence
-- à y saisir : le numéro de carte, ou la clé diplome.gouv.fr d'un diplôme
-- ancien, qu'il fallait lire sur un scan — ou demander.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Une colonne de texte court, facultative, écrite par le serveur seul
-- (/api/notify-doc) : le navigateur n'a aucun droit d'écriture sur
-- `documents` (CLAUDE.md §3.4), et cela ne change pas.
--
-- COMPATIBILITÉ
--
-- Ancien code : ne la lit ni ne l'écrit. Le back-office lit `select=*` : la
-- colonne apparaît d'elle-même.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reference_verification text;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_reference_verification_longueur;
ALTER TABLE public.documents ADD CONSTRAINT documents_reference_verification_longueur
  CHECK (reference_verification IS NULL OR char_length(reference_verification) BETWEEN 3 AND 80);

-- VÉRIFICATION — doit rendre une ligne
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reference_verification';
