-- ═══════════════════════════════════════════════════════════════════════════
-- Le CV du prestataire quitte le jeton de connexion pour `profiles.cv`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (29/09/2026)
--
-- Le CV devient obligatoire (décision d'Alexandre). Il vivait dans
-- `user_metadata.cv`, qui est ENCODÉ DANS LE JETON de connexion, envoyé en
-- en-tête à chaque requête et plafonné à 16 Ko par Cloudflare. Une photo de
-- 60 Ko y avait rendu un compte inutilisable (CLAUDE.md, règle 1.1). Un CV
-- avec ses descriptions libres, imposé à tous, n'a rien à y faire.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- • ajoute `profiles.cv` (jsonb), borné à 12 Ko ;
-- • y RECOPIE les CV existants depuis `auth.users` — lecture seule du schéma
--   auth, rien n'y est modifié. Le retrait de l'ancienne copie se fait côté
--   application, compte par compte, à la prochaine sauvegarde du profil, et
--   seulement après l'écriture réussie dans `profiles` ;
-- • autorise le prestataire à modifier SON cv (la règle `profiles_update`
--   limite déjà la ligne à la sienne).
--
-- ORDRE : cette migration (recette, puis production) AVANT le déploiement.
-- `/api/prestataires` et le back-office lisent la colonne : sans elle,
-- PostgREST refuserait toute la requête, et le catalogue serait vide.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cv jsonb;

COMMENT ON COLUMN public.profiles.cv IS
  'CV du prestataire (titre, accroche, experiences[], formations[], permis). '
  'Obligatoire pour ouvrir l''accès aux prestations depuis le 29/09/2026. '
  'Ne vit plus dans user_metadata, encodé dans le jeton.';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_cv_taille_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_cv_taille_check
  CHECK (cv IS NULL OR octet_length(cv::text) <= 12000);

-- Recopie des CV existants — seulement ceux qui ont un contenu, et seulement
-- là où `profiles.cv` est encore vide : relancer la migration n'écrase rien.
UPDATE public.profiles p
   SET cv = u.raw_user_meta_data -> 'cv'
  FROM auth.users u
 WHERE u.id = p.id
   AND p.cv IS NULL
   AND jsonb_typeof(u.raw_user_meta_data -> 'cv') = 'object'
   AND u.raw_user_meta_data -> 'cv' <> '{}'::jsonb
   AND octet_length((u.raw_user_meta_data -> 'cv')::text) <= 12000;

GRANT UPDATE (cv) ON public.profiles TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne existe et le prestataire peut la modifier — attendu : une ligne
--    SELECT grantee FROM information_schema.column_privileges
--     WHERE table_name = 'profiles' AND column_name = 'cv'
--       AND privilege_type = 'UPDATE' AND grantee = 'authenticated';
--
-- 2. Aucun CV oublié dans la recopie — attendu : 0
--    SELECT count(*) FROM auth.users u JOIN public.profiles p ON p.id = u.id
--     WHERE jsonb_typeof(u.raw_user_meta_data -> 'cv') = 'object'
--       AND u.raw_user_meta_data -> 'cv' <> '{}'::jsonb
--       AND p.cv IS NULL;
