-- ═══════════════════════════════════════════════════════════════════════════
-- Métier réglementé ajouté après activation : son justificatif est imposé
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (29/09/2026)
--
-- Le titre d'un métier réglementé (carte CNAPS, permis B, BAFA…) n'était
-- exigé qu'à l'ouverture de l'accès aux prestations. Un prestataire déjà
-- activé pouvait ensuite ajouter lui-même « Agent de sécurité » à ses métiers
-- et être proposé sans avoir jamais produit sa carte — un délit pour lui, et
-- une mise en relation que la plateforme aurait du mal à justifier.
--
-- Décision d'Alexandre : ne pas bloquer le compte, imposer le justificatif.
-- Les autres métiers restent ouverts ; le métier ajouté ne l'est qu'une fois
-- son titre déposé et vérifié.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Un seul document « diplomes » par prestataire porte tous ses titres. Pour
-- savoir s'il couvre un métier ajouté plus tard, la vérification note
-- désormais les titres qu'il couvrait (`titres_couverts`, écrit par verify_doc).
--
-- Les justificatifs DÉJÀ vérifiés sont réputés couvrir les titres des métiers
-- déclarés aujourd'hui : on ne retire pas en silence un métier à quelqu'un dont
-- la pièce a été acceptée. La table ci-dessous est celle de
-- api/_qualifications.js au 29/09/2026 (générée depuis le code).
--
-- ORDRE : cette migration (recette, puis production) AVANT le déploiement.
-- Le code lit la colonne ; sans elle, PostgREST refuserait la lecture et plus
-- aucun métier réglementé ne serait proposé.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS titres_couverts text[];

COMMENT ON COLUMN public.documents.titres_couverts IS
  'Pour le document « diplomes » : les titres de qualification (carte CNAPS, permis B…) '
  'que la vérification a constatés. Un métier réglementé n''est exerçable que si son '
  'titre y figure. Écrit par /api/bo-action (verify_doc), jamais par le navigateur.';

-- ── Le navigateur ne peut plus que LIRE les documents ────────────────────
--
-- Constaté en recette le 29/09/2026, en préparant cette migration :
--
--   • un prestataire pouvait CRÉER une ligne déjà `verified = true` (réponse
--     201) : la règle `docs_insert` ne contrôlait que `prestataire_id`, et
--     `verified` était inscriptible à l'insertion. Il certifiait lui-même sa
--     pièce, sans que personne l'ait ouverte — et, avec la colonne ajoutée ici,
--     il se serait déclaré titulaire de la carte CNAPS ;
--   • il pouvait CHANGER LE TYPE d'une pièce vérifiée (`type` modifiable,
--     règle `docs_update` sans condition) : une photo validée devenait un
--     diplôme validé ;
--   • `authenticated` détenait TRUNCATE, qui n'est PAS soumis à la RLS.
--
-- Rien de tout cela ne sert : la ligne est écrite par le serveur depuis le
-- 25/09/2026 (`/api/notify-doc`, CLAUDE.md §3.4) ; src/ ne fait que des
-- `select` sur `documents`. On retire donc tout droit d'écriture au navigateur.
DROP POLICY IF EXISTS docs_insert ON public.documents;
DROP POLICY IF EXISTS docs_update ON public.documents;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.documents FROM anon, authenticated;
GRANT SELECT ON public.documents TO authenticated;

-- Reprise : titres des métiers déclarés aujourd'hui, pour les justificatifs vérifiés.
WITH table_des_titres(metier, titre) AS (VALUES
    ('Agent de sécurité', 'Carte professionnelle CNAPS'),
    ('Agent de sûreté', 'Carte professionnelle CNAPS'),
    ('Agent cynophile de sécurité', 'Carte professionnelle CNAPS mention cynophile'),
    ('Agent de sécurité incendie SSIAP 1', 'Diplôme SSIAP 1 à jour'),
    ('Agent de sécurité incendie SSIAP 2', 'Diplôme SSIAP 2 à jour'),
    ('Agent de prévention des pertes (magasin)', 'Carte professionnelle CNAPS'),
    ('Éducateur sportif / Coach', 'Carte professionnelle d''éducateur sportif'),
    ('Maître-nageur sauveteur (BNSSA)', 'BNSSA ou BPJEPS AAN à jour'),
    ('Animateur périscolaire (BAFA)', 'BAFA (ou équivalent)'),
    ('Animateur club enfants', 'BAFA (ou équivalent)'),
    ('Chauffeur VTC', 'Carte professionnelle VTC'),
    ('Chauffeur poids lourd (permis C)', 'Permis C, FIMO et FCO à jour'),
    ('Chauffeur de bus / autocar', 'Permis D, FIMO et FCO à jour'),
    ('Chauffeur livreur', 'Permis de conduire B en cours de validité'),
    ('Voiturier', 'Permis de conduire B en cours de validité'),
    ('Coiffeur(se) à domicile', 'CAP coiffure, BP, ou 3 ans de pratique'),
    ('Spa praticien / Esthéticien', 'CAP esthétique-cosmétique, ou 3 ans de pratique'),
    ('Boulanger', 'CAP boulangerie, ou 3 ans de pratique'),
    ('Boulanger en GMS', 'CAP boulangerie, ou 3 ans de pratique'),
    ('Pâtissier', 'CAP pâtisserie, ou 3 ans de pratique'),
    ('Commis pâtissier', 'CAP pâtisserie, ou 3 ans de pratique'),
    ('Chef pâtissier', 'CAP pâtisserie, ou 3 ans de pratique'),
    ('Chocolatier', 'CAP chocolatier-confiseur, ou 3 ans de pratique'),
    ('Glacier', 'CAP glacier-fabricant, ou 3 ans de pratique'),
    ('Charcutier-traiteur', 'CAP charcutier-traiteur, ou 3 ans de pratique'),
    ('Boucher en GMS', 'CAP boucher, ou 3 ans de pratique'),
    ('Poissonnier-écailler', 'CAP poissonnier-écailler, ou 3 ans de pratique'),
    ('Poissonnier en GMS', 'CAP poissonnier-écailler, ou 3 ans de pratique'),
    ('Traiteur', 'CAP cuisine ou charcutier-traiteur, ou 3 ans de pratique'),
    ('Rôtisseur', 'CAP cuisine ou boucher, ou 3 ans de pratique'),
    ('Agent d''entretien du bâtiment', 'CAP du second œuvre, ou 3 ans de pratique'),
    ('Laveur de vitres en hauteur (cordiste)', 'CQP cordiste ou CATSC / IRATA')
),
declares AS (
  SELECT u.id, e.value ->> 'metier' AS metier
    FROM auth.users u, jsonb_array_elements(COALESCE(u.raw_user_meta_data -> 'metiers_list', '[]'::jsonb)) e
   WHERE jsonb_typeof(e.value) = 'object'
  UNION
  SELECT u.id, u.raw_user_meta_data ->> 'metier' FROM auth.users u
)
UPDATE public.documents d
   SET titres_couverts = t.titres
  FROM (SELECT declares.id, array_agg(DISTINCT q.titre) AS titres
          FROM declares JOIN table_des_titres q ON q.metier = declares.metier
         GROUP BY declares.id) t
 WHERE d.prestataire_id = t.id
   AND d.type = 'diplomes'
   AND d.verified IS TRUE
   AND d.titres_couverts IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Le navigateur ne peut que lire — attendu : une seule ligne, authenticated | SELECT
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND table_name = 'documents' AND grantee IN ('anon', 'authenticated')
--    UNION
--    SELECT DISTINCT grantee, privilege_type FROM information_schema.column_privileges
--     WHERE table_schema = 'public' AND table_name = 'documents' AND grantee IN ('anon', 'authenticated')
--       AND privilege_type <> 'SELECT';
--
-- 2. Les justificatifs repris, à relire une fois : un prestataire qui aurait
--    ajouté un métier réglementé AVANT cette migration, sans nouvelle pièce, y
--    figure aussi. Ouvrir la pièce de chacun et vérifier qu'elle porte bien
--    chaque titre listé.
--    SELECT p.prenom, p.nom, d.titres_couverts
--      FROM public.documents d JOIN public.profiles p ON p.id = d.prestataire_id
--     WHERE d.type = 'diplomes' AND d.titres_couverts IS NOT NULL;
