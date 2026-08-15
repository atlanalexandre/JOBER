-- ═══════════════════════════════════════════════════════════════════════════
-- Séparer les communications commerciales des communications transactionnelles
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La Plateforme envoie deux choses très différentes par le même canal :
--
--   • des messages TRANSACTIONNELS — confirmation de réservation, rappel de
--     prestation, demande de validation, notification de versement. Ils relèvent
--     de l'exécution du contrat et ne supposent aucun consentement distinct ;
--
--   • des messages COMMERCIAUX — la fonction « communication globale » du
--     backoffice, qui écrit à tous les prestataires approuvés. Celle-ci relève
--     de la prospection, et l'article L.34-5 du Code des postes et des
--     communications électroniques la subordonne au consentement préalable de
--     la personne physique qui la reçoit.
--
-- Rien ne les distinguait : le même envoi partait à tout le monde, sans que
-- personne n'ait rien accepté ni ne puisse s'y soustraire.
--
-- CE QUE FAIT CETTE COLONNE
--
-- Elle porte le consentement à recevoir des communications commerciales.
-- Volontairement à FALSE par défaut : un consentement se recueille, il ne se
-- présume pas. Les envois transactionnels n'en dépendent pas et continuent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepte_communications      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepte_communications_at   timestamptz;

CREATE INDEX IF NOT EXISTS profiles_communications_idx
  ON public.profiles (role)
  WHERE accepte_communications = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('accepte_communications','accepte_communications_at');
--    -- attendu : 2 lignes, accepte_communications par défaut à false
--
-- Qui recevra les communications commerciales — zéro tant que personne n'a
-- donné son accord, ce qui est le comportement voulu :
--
--    SELECT count(*) FROM profiles WHERE accepte_communications = true;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS profiles_communications_idx;
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS accepte_communications,
--      DROP COLUMN IF EXISTS accepte_communications_at;
--
-- Attention : les consentements déjà recueillis seraient perdus, et il faudrait
-- les redemander.
-- ═══════════════════════════════════════════════════════════════════════════
