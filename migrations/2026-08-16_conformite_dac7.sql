-- ═══════════════════════════════════════════════════════════════════════════
-- Socle DAC7 et article 242 bis du CGI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- ALANE met en relation des prestataires de services avec des clients et
-- intervient dans le paiement. Le second conseil consulté retient l'hypothèse
-- de travail suivante : « ALANE est probablement dans le périmètre DAC7 jusqu'à
-- démonstration contraire » (art. 1649 ter A et suivants du CGI).
--
-- Deux obligations distinctes en découlent, qui ne se confondent pas :
--
--   • DAC7 — déclaration annuelle à l'administration fiscale de l'identité des
--     prestataires et des contreparties versées, avec remise d'une copie à
--     l'intéressé ;
--   • article 242 bis — récapitulatif annuel des montants bruts perçus, adressé
--     en janvier à chaque prestataire, et information fiscale à chaque
--     transaction.
--
-- Aucune des deux n'était outillée : ni collecte, ni décompte, ni export.
--
-- CE QUE STOCKENT CES COLONNES
--
-- Les données déclarables qui manquaient. L'identité, l'adresse et le SIRET
-- existaient déjà ; le NIF et la résidence fiscale, non.
--
-- Le NIF est volontairement NULLABLE : l'exiger de but en blanc bloquerait les
-- comptes existants. Le contrôle porte sur la complétude au moment de la
-- déclaration, pas sur l'inscription.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  -- Numéro d'identification fiscale. Pour un auto-entrepreneur français c'est le
  -- numéro fiscal à 13 chiffres, distinct du SIRET.
  ADD COLUMN IF NOT EXISTS nif                    text,
  ADD COLUMN IF NOT EXISTS nif_collecte_at        timestamptz,
  -- Pays de résidence fiscale, code ISO à deux lettres. « FR » par défaut n'est
  -- PAS posé : une valeur par défaut fausse est pire qu'une valeur absente, elle
  -- se déclare sans que personne ne la vérifie.
  ADD COLUMN IF NOT EXISTS residence_fiscale      text,
  -- Date d'envoi du dernier récapitulatif annuel (art. 242 bis). Sans elle, on
  -- ne peut ni prouver l'envoi, ni éviter de l'envoyer deux fois.
  ADD COLUMN IF NOT EXISTS recapitulatif_annuel_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_residence_fiscale_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_residence_fiscale_check
      CHECK (residence_fiscale IS NULL OR residence_fiscale ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- Les prestataires dont le dossier fiscal est incomplet : c'est la liste de
-- travail avant la déclaration annuelle.
CREATE INDEX IF NOT EXISTS profiles_dac7_incomplet_idx
  ON public.profiles (role)
  WHERE nif IS NULL OR residence_fiscale IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('nif','nif_collecte_at','residence_fiscale','recapitulatif_annuel_at');
--    -- attendu : 4 lignes
--
-- L'état du dossier fiscal, avant la première déclaration :
--
--    SELECT count(*) FILTER (WHERE nif IS NOT NULL)               AS avec_nif,
--           count(*) FILTER (WHERE residence_fiscale IS NOT NULL) AS avec_residence,
--           count(*)                                              AS total
--    FROM profiles WHERE role = 'prestataire' AND status = 'approved';
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS profiles_dac7_incomplet_idx;
--    ALTER TABLE public.profiles
--      DROP CONSTRAINT IF EXISTS profiles_residence_fiscale_check,
--      DROP COLUMN IF EXISTS nif,
--      DROP COLUMN IF EXISTS nif_collecte_at,
--      DROP COLUMN IF EXISTS residence_fiscale,
--      DROP COLUMN IF EXISTS recapitulatif_annuel_at;
--
-- Attention : les NIF déjà collectés seraient perdus et devraient être
-- redemandés un par un.
-- ═══════════════════════════════════════════════════════════════════════════
