-- ═══════════════════════════════════════════════════════════════════════════
-- Rattrapage : recopier dans `profiles` ce que l'inscription y avait perdu
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Du 30/07 au 23/09/2026, l'écriture du profil à l'inscription était refusée en
-- bloc (voir `completerProfil` dans src/components/auth.jsx). Les renseignements
-- du formulaire ne survivent que dans `auth.users.raw_user_meta_data`, où le
-- `signUp` les avait aussi déposés. Relevé en production le 23/09/2026 (lecture
-- seule) : 92 adresses, villes et codes postaux, 78 SIRET, 2 noms de société et
-- 2 IBAN récupérables.
--
-- CE QUI N'EST PAS RÉCUPÉRABLE
--   • L'IBAN des prestataires : le formulaire ne l'écrivait QUE dans `profiles`.
--     87 prestataires sur 88 n'en ont aucun. Il reste disponible sur la pièce
--     « RIB » de leur dossier documentaire, à déposer de toute façon.
--   • Le consentement aux communications commerciales : jamais enregistré. En
--     l'absence de preuve, il vaut refus — c'est le sens de l'art. L.34-5 CPCE.
--
-- On ne remplace JAMAIS une valeur déjà présente dans `profiles` : celle-ci a pu
-- être corrigée depuis par l'intéressé ou par l'administration.
-- Aucune donnée n'est retirée de `user_metadata` ici (schéma auth : CLAUDE.md §2.4).
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.profiles p
SET
  adresse     = COALESCE(p.adresse,     NULLIF(btrim(u.raw_user_meta_data->>'adresse'), '')),
  code_postal = COALESCE(p.code_postal, NULLIF(btrim(u.raw_user_meta_data->>'code_postal'), '')),
  ville       = COALESCE(p.ville,       NULLIF(btrim(u.raw_user_meta_data->>'ville'), '')),
  societe_nom = COALESCE(p.societe_nom, NULLIF(btrim(u.raw_user_meta_data->>'societe_nom'), '')),
  siret       = COALESCE(p.siret,       NULLIF(regexp_replace(u.raw_user_meta_data->>'siret', '[^0-9]', '', 'g'), '')),
  rib         = COALESCE(p.rib,         NULLIF(upper(regexp_replace(u.raw_user_meta_data->>'rib', '\s', '', 'g')), ''))
FROM auth.users u
WHERE u.id = p.id
  AND (   (p.adresse     IS NULL AND u.raw_user_meta_data ? 'adresse')
       OR (p.code_postal IS NULL AND u.raw_user_meta_data ? 'code_postal')
       OR (p.ville       IS NULL AND u.raw_user_meta_data ? 'ville')
       OR (p.societe_nom IS NULL AND u.raw_user_meta_data ? 'societe_nom')
       OR (p.siret       IS NULL AND u.raw_user_meta_data ? 'siret')
       OR (p.rib         IS NULL AND u.raw_user_meta_data ? 'rib'));

-- ── Vérification ────────────────────────────────────────────────────────────
-- Attendu : zéro partout (plus rien de récupérable qui ne soit recopié).
--   SELECT count(*) FILTER (WHERE p.ville IS NULL AND u.raw_user_meta_data->>'ville' IS NOT NULL) villes,
--          count(*) FILTER (WHERE p.siret IS NULL AND u.raw_user_meta_data->>'siret' <> '')       sirets
--   FROM profiles p JOIN auth.users u ON u.id = p.id;
--
-- ── Retour arrière ──────────────────────────────────────────────────────────
-- Aucun : seules des cases vides ont été remplies, avec la saisie de l'intéressé.
