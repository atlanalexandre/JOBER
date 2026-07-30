-- ═══════════════════════════════════════════════════════════════════════════
-- Sortir l'IBAN du jeton d'authentification
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'IBAN du prestataire est stocké dans `user_metadata`. Or `user_metadata` est
-- encodé dans le jeton d'authentification, transmis en en-tête HTTP à CHAQUE
-- requête, et conservé côté navigateur.
--
-- Ce n'est pas un problème de taille — un IBAN fait 27 caractères, la limite de
-- 16 Ko de la règle 1.1 n'est pas menacée. C'est un problème d'exposition : une
-- coordonnée bancaire circule ainsi vers chaque point d'entrée de la plateforme,
-- y compris ceux qui n'en ont aucun besoin, et réside en clair dans le stockage
-- du navigateur. Le principe de minimisation du RGPD (art. 5.1.c) demande
-- l'inverse.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Étape 1 — ajoute `profiles.rib` et y recopie les IBAN existants.
-- Étape 2 — À EXÉCUTER SÉPARÉMENT, une fois l'étape 1 vérifiée : retire l'IBAN
--           de `user_metadata`.
--
-- Les deux étapes sont volontairement séparées : l'étape 2 touche au schéma
-- `auth` et efface une donnée. Ne la lancer qu'après avoir constaté que la
-- recopie est complète (requête de vérification fournie).
--
-- Le code lit `profiles.rib` en priorité et retombe sur `user_metadata.rib` tant
-- que l'étape 2 n'a pas été passée : aucune interruption de service, aucun ordre
-- imposé par rapport au déploiement.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 : colonne dédiée et recopie ────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rib text;

UPDATE public.profiles p
   SET rib = NULLIF(TRIM(u.raw_user_meta_data ->> 'rib'), '')
  FROM auth.users u
 WHERE u.id = p.id
   AND p.rib IS NULL
   AND NULLIF(TRIM(u.raw_user_meta_data ->> 'rib'), '') IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — à lancer AVANT l'étape 2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aucune ligne ne doit être renvoyée : chaque IBAN présent dans le jeton doit
-- avoir été recopié à l'identique dans le profil.
--
--    SELECT u.id,
--           u.raw_user_meta_data ->> 'rib' AS iban_jeton,
--           p.rib                          AS iban_profil
--    FROM auth.users u
--    JOIN public.profiles p ON p.id = u.id
--    WHERE NULLIF(TRIM(u.raw_user_meta_data ->> 'rib'), '') IS NOT NULL
--      AND (p.rib IS DISTINCT FROM NULLIF(TRIM(u.raw_user_meta_data ->> 'rib'), ''));
--
-- Compter ce qui a été recopié :
--
--    SELECT count(*) FROM public.profiles WHERE rib IS NOT NULL;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 2 — SUPPRESSION DANS LE JETON
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Efface une donnée du schéma `auth`. Ne l'exécuter qu'après la vérification
-- ci-dessus, et seulement si elle ne renvoie aucune ligne.
--
--    UPDATE auth.users u
--       SET raw_user_meta_data = u.raw_user_meta_data - 'rib'
--      FROM public.profiles p
--     WHERE p.id = u.id
--       AND p.rib IS NOT NULL
--       AND u.raw_user_meta_data ? 'rib';
--
-- Les prestataires devront se reconnecter — ou attendre le renouvellement de
-- leur jeton — pour que l'ancienne valeur disparaisse de leur navigateur.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Étape 1 seule appliquée : rien à défaire, la colonne peut rester.
-- Étape 2 appliquée : l'IBAN reste disponible dans `profiles.rib`, le code le
-- lit en priorité. Aucune donnée n'est perdue.
-- ═══════════════════════════════════════════════════════════════════════════
