-- ═══════════════════════════════════════════════════════════════════════════
-- Conservation des documents : purge RGPD (CGPS art. 14.4) et validité des
-- attestations RC Pro (CGPS art. 19.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Deux promesses écrites que rien n'exécutait.
--
-- L'article 14.4 annonce que les pièces d'identité sont « supprimées après
-- vérification du compte ou au plus tard 12 mois après leur dépôt ». Aucun
-- traitement ne les supprimait : les CNI dormaient indéfiniment dans le
-- stockage. C'est le premier point qu'une inspection CNIL vérifie, et c'est
-- aussi le plus coûteux en cas de fuite — une pièce d'identité ne se change pas.
--
-- L'article 19.1 impose au prestataire de renouveler son attestation de
-- responsabilité civile professionnelle chaque année, et permet de suspendre le
-- compte trente jours après l'expiration. Rien ne suivait la date de validité :
-- une RC Pro périmée depuis deux ans passait inaperçue.
--
-- ── LE POINT DÉLICAT : SUPPRIMER SANS PERDRE LA PREUVE ─────────────────────
--
-- Supprimer la ligne `documents` effacerait aussi la trace que la vérification
-- a EU LIEU. Or ALANE doit pouvoir en justifier : obligation de vigilance sur
-- le travail dissimulé (art. L8222-1 du Code du travail), et articles 10B.8 et
-- 10D.4 des CGPS qui l'engagent à conserver ses démarches de vérification.
--
-- On sépare donc les deux : le FICHIER est supprimé du stockage, la LIGNE est
-- conservée avec `purged_at`. Il reste « CNI vérifiée le 3 mars, pièce
-- supprimée le 3 avril », sans la pièce elle-même. C'est ce que le RGPD
-- demande — la minimisation, pas l'amnésie.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents
  -- Quand la vérification a eu lieu. `verified` seul ne permettait pas de
  -- compter les trente jours après lesquels la pièce peut partir.
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,

  -- Fin de validité, pour les attestations qui en ont une (RC Pro, URSSAF).
  -- Saisie par le backoffice au moment de la vérification.
  ADD COLUMN IF NOT EXISTS expires_at  date,

  -- Date de suppression du fichier. La ligne survit : elle est la preuve que
  -- la vérification a eu lieu, ce que la suppression ne doit pas effacer.
  ADD COLUMN IF NOT EXISTS purged_at   timestamptz;

-- Rattrapage : les documents déjà vérifiés n'ont pas de date de vérification.
-- On retient leur date de dépôt, qui est la seule information disponible et la
-- plus défavorable à la conservation — donc la bonne par défaut.
UPDATE public.documents
   SET verified_at = created_at
 WHERE verified = true AND verified_at IS NULL;

-- Le traitement de purge cherche les pièces d'identité encore présentes.
CREATE INDEX IF NOT EXISTS documents_a_purger_idx
  ON public.documents (type, verified_at, created_at)
  WHERE purged_at IS NULL;

-- Le traitement des RC Pro cherche celles qui expirent.
CREATE INDEX IF NOT EXISTS documents_expiration_idx
  ON public.documents (expires_at)
  WHERE expires_at IS NOT NULL;

-- Dernière relance envoyée au prestataire pour son attestation, afin de ne pas
-- la renvoyer à chaque passage du traitement.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rc_pro_relance_at timestamptz;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Les colonnes :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'documents'
--      AND column_name IN ('verified_at','expires_at','purged_at');
--    -- attendu : 3 lignes
--
-- 2. Ce qui reste à purger aujourd'hui (avant le premier passage) :
--
--    SELECT type, count(*) FROM documents
--    WHERE purged_at IS NULL AND type IN ('cni','kbis','domicile')
--      AND (verified_at < now() - interval '30 days'
--           OR created_at  < now() - interval '12 months')
--    GROUP BY type;
--
-- 3. Après quelques jours, plus aucune pièce d'identité ne doit dépasser
--    douze mois :
--
--    SELECT count(*) FROM documents
--    WHERE purged_at IS NULL AND type IN ('cni','kbis','domicile')
--      AND created_at < now() - interval '12 months';
--    -- attendu : 0
--
-- 4. Les attestations RC Pro périmées :
--
--    SELECT prestataire_id, expires_at FROM documents
--    WHERE type = 'rc_pro' AND expires_at < current_date ORDER BY expires_at;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS documents_a_purger_idx;
--    DROP INDEX IF EXISTS documents_expiration_idx;
--    ALTER TABLE public.documents
--      DROP COLUMN IF EXISTS verified_at,
--      DROP COLUMN IF EXISTS expires_at,
--      DROP COLUMN IF EXISTS purged_at;
--    ALTER TABLE public.profiles DROP COLUMN IF EXISTS rc_pro_relance_at;
--
-- Attention : les fichiers déjà supprimés du stockage ne reviendront pas.
-- Le retour arrière ne défait que le suivi, pas la purge.
-- ═══════════════════════════════════════════════════════════════════════════
