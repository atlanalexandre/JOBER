-- ═══════════════════════════════════════════════════════════════════════════
-- Un fichier remplacé dans le bucket `Documents` remet sa pièce EN ATTENTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI SE PASSAIT
--
-- Le prestataire peut écraser son propre fichier dans le bucket (règle
-- `docs_update_own_folder` de `storage.objects`) : c'est ce qui permet de
-- remplacer une pièce, sous le même nom `{user_id}/{type}` (CLAUDE.md §3.4).
-- Depuis le 25/09/2026, l'application remet la pièce en attente à chaque dépôt
-- (`/api/notify-doc`). Mais rien n'obligeait à passer par l'application : un
-- appel direct au stockage, avec son propre jeton, remplaçait le fichier d'une
-- pièce DÉJÀ VALIDÉE sans toucher à sa ligne. La pièce restait « vérifiée »
-- sur un fichier que personne n'avait vu — une RC Pro, une pièce d'identité.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Un déclencheur sur `storage.objects` : dès qu'un fichier du bucket
-- `Documents` est remplacé, la ligne de `documents` qui le désigne repasse en
-- attente (vérification et date de validité effacées). Il vit dans la base :
-- aucun chemin, même hors de l'application, ne le contourne.
--
-- La fonction est SECURITY DEFINER : le rôle `authenticated` n'a pas — et ne
-- doit pas avoir — le droit de modifier `verified` (migration du 17/08/2026,
-- `colonnes_non_modifiables`). Elle ne fait qu'une chose, remettre à zéro, et
-- n'est exécutable par personne en direct.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.documents_fichier_remplace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bucket_id = 'Documents' THEN
    UPDATE public.documents
       SET verified = false, verified_at = NULL, expires_at = NULL, relance_expiration_at = NULL
     WHERE storage_path = NEW.name
       AND (verified IS TRUE OR verified_at IS NOT NULL OR expires_at IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.documents_fichier_remplace() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_fichier_remplace ON storage.objects;
CREATE TRIGGER documents_fichier_remplace
  AFTER UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.documents_fichier_remplace();

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'storage.objects'::regclass AND tgname = 'documents_fichier_remplace';
