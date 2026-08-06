-- ═══════════════════════════════════════════════════════════════════════════
-- Déclaration d'intervention au bénéfice d'un tiers (CGPS art. 10B)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- L'article 10B autorise un client professionnel à faire exécuter une prestation
-- chez son propre client, et n'interdit qu'un schéma : fournir une personne
-- désignée, à l'heure, à un tiers qui la dirige.
--
-- Ce qui distingue les deux, en droit, n'est ni la durée ni la récurrence — il
-- n'existe aucun seuil — mais l'objet de ce qui est vendu. Une mission définie par
-- son périmètre, ses critères et son livrable est une prestation de services. La
-- présence d'une personne pendant sept heures n'en est pas une.
--
-- Cette colonne conserve la déclaration du client au moment de la réservation :
-- bénéficiaire final, service vendu, périmètre et critères, livrable attendu, et
-- identité de la personne qui organise le travail sur place. C'est la trace qui
-- permet de démontrer, en cas de contrôle, que la plateforme a demandé et obtenu
-- la qualification de la mission.
--
-- CONTENU
--
--   {
--     "beneficiaire":  "Hôtel X, Nice",
--     "service_vendu": "Contrôle qualité de l'étage 3",
--     "perimetre":     "24 chambres, critères de la grille interne",
--     "livrable":      "Grille de contrôle remplie et remise en fin de journée",
--     "organisateur":  "Mme Y, gouvernante générale, salariée du client",
--     "declare_le":    "2026-08-05T18:00:00.000Z"
--   }
--
-- COMPATIBILITÉ
--
-- Le code sait fonctionner sans cette migration : la déclaration est enregistrée
-- par une action serveur distincte de la création de la prestation. Si la colonne
-- est absente, la réservation aboutit quand même et l'échec est journalisé en
-- erreur. Aucun ordre imposé par rapport au déploiement, et aucun risque de bloquer
-- le tunnel de réservation.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS tiers_declaration jsonb;

-- Retrouver rapidement les prestations déclarées comme exécutées chez un tiers.
CREATE INDEX IF NOT EXISTS idx_missions_tiers_declaration
  ON public.missions((tiers_declaration IS NOT NULL))
  WHERE tiers_declaration IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne existe :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions' AND column_name = 'tiers_declaration';
--
-- 2. Après une réservation déclarée chez un tiers :
--
--    SELECT id, ville, tiers_declaration
--    FROM missions WHERE tiers_declaration IS NOT NULL
--    ORDER BY created_at DESC LIMIT 5;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS idx_missions_tiers_declaration;
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS tiers_declaration;
--
-- Attention : supprime les déclarations déjà recueillies, qui ont une valeur
-- probatoire. Ne revenir en arrière que si aucune n'a été enregistrée.
-- ═══════════════════════════════════════════════════════════════════════════
