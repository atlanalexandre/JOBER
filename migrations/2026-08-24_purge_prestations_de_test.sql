-- ═══════════════════════════════════════════════════════════════════════════
-- Purge des prestations de test — À EXÉCUTER UNE SEULE FOIS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI CE FICHIER EXISTE
--
-- Ce n'est pas une migration de schéma : c'est une SUPPRESSION DE DONNÉES,
-- demandée par Alexandre le 24/08/2026 sur ses propres prestations d'essai.
-- Elle est versionnée pour la même raison qu'une migration : dans six mois,
-- quelqu'un se demandera pourquoi la numérotation des factures commence à
-- FAC-2026-000003, et la réponse doit être écrite quelque part.
--
-- CE QU'ELLE SUPPRIME
--
-- Les prestations désignées par la liste `cibles` ci-dessous, et tout ce qui en
-- dépend : candidatures, remplacements, contrats, positions, avis, messages,
-- notifications qui y renvoient.
--
-- CE QU'ELLE NE SUPPRIME PAS, ET POURQUOI
--
-- `factures_archives`. L'article L123-22 du Code de commerce impose de
-- conserver les factures dix ans, et l'article 242 nonies A de l'annexe II du
-- CGI exige une numérotation continue. Effacer une facture émise fait un trou
-- dans la séquence — exactement ce qu'un contrôle regarde en premier. Les
-- archives restent donc, orphelines de leur prestation, ce que la table
-- supporte : `mission_id` n'y porte aucune clé étrangère.
--
-- La numérotation reprendra donc après les numéros déjà émis. C'est correct :
-- la continuité s'apprécie vers l'avant, pas depuis 1.
--
-- COMMENT S'EN SERVIR
--
-- 1. Exécuter d'abord le SELECT de contrôle (§1) et LIRE le résultat.
-- 2. N'exécuter le bloc de suppression (§2) que si cette liste est exactement
--    ce que l'on veut perdre.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §1. CONTRÔLE — à lire avant toute chose ────────────────────────────────
--
-- Remplacer la liste de dates si le périmètre change.

WITH cibles AS (
  SELECT id FROM public.missions
   WHERE date IN ('2026-08-17', '2026-08-18', '2026-08-21')
)
SELECT m.id, m.date, m.metier, m.status, m.payout_status,
       m.montant_total, m.invoice_number
  FROM public.missions m
  JOIN cibles c ON c.id = m.id
 ORDER BY m.date;


-- ── §2. SUPPRESSION — n'exécuter qu'après avoir lu le §1 ────────────────────
--
-- Tout est dans une seule transaction : soit tout part, soit rien ne bouge.
-- Une purge à moitié faite laisserait des candidatures sans prestation et des
-- écrans qui plantent sur une référence morte.

BEGIN;

CREATE TEMP TABLE cibles_purge ON COMMIT DROP AS
  SELECT id FROM public.missions
   WHERE date IN ('2026-08-17', '2026-08-18', '2026-08-21');

-- Les tables dépendantes sont nettoyées par un bloc dynamique : `contracts` et
-- `tracking_positions` ne sont décrites que dans les vieux fichiers de schéma à
-- la racine, dont aucun ne fait autorité. Si l'une n'existe pas, un DELETE en
-- dur ferait échouer TOUTE la transaction, et la purge n'aurait pas lieu — sans
-- qu'on comprenne pourquoi. On ne touche donc qu'aux tables réellement là.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('notifications',         'ref_id',     'uuid'),
      ('ratings',               'mission_id', 'uuid'),
      ('candidatures',          'mission_id', 'uuid'),
      ('mission_remplacements', 'mission_id', 'uuid'),
      ('contracts',             'mission_id', 'texte'),
      ('tracking_positions',    'mission_id', 'texte')
    ) AS v(nom, colonne, genre)
  LOOP
    IF to_regclass('public.' || t.nom) IS NULL THEN
      RAISE NOTICE 'table % absente — ignorée', t.nom;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t.nom AND column_name = t.colonne
    ) THEN
      RAISE NOTICE 'colonne %.% absente — ignorée', t.nom, t.colonne;
      CONTINUE;
    END IF;

    -- Certaines tables portent l'identifiant en TEXTE : la comparaison passe
    -- alors par une conversion, sinon PostgreSQL refuse l'égalité.
    IF t.genre = 'texte' THEN
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I::text IN (SELECT id::text FROM cibles_purge)',
        t.nom, t.colonne);
    ELSE
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I IN (SELECT id FROM cibles_purge)',
        t.nom, t.colonne);
    END IF;
    RAISE NOTICE 'nettoyé : %', t.nom;
  END LOOP;
END $$;

-- Et enfin les prestations elles-mêmes.
DELETE FROM public.missions
 WHERE id IN (SELECT id FROM cibles_purge);

COMMIT;


-- ── §3. VÉRIFICATION ───────────────────────────────────────────────────────
--
--    SELECT count(*) FROM public.missions
--     WHERE date IN ('2026-08-17','2026-08-18','2026-08-21');
--    -- attendu : 0
--
--    SELECT numero, mission_id, emise_le FROM public.factures_archives
--     ORDER BY numero;
--    -- attendu : les factures d'essai sont TOUJOURS LÀ, c'est voulu
--
-- CONTRÔLE DEPUIS LE BACK-OFFICE : l'écran « Versements » ne doit plus rien
-- afficher, et la bannière de retard doit avoir disparu.
--
-- ── PAS DE RETOUR ARRIÈRE ──────────────────────────────────────────────────
--
-- Un DELETE ne se rejoue pas à l'envers. La seule sauvegarde est celle de
-- Supabase (Database → Backups), qui permet une restauration à un instant
-- donné. C'est la raison du SELECT de contrôle au §1.
-- ═══════════════════════════════════════════════════════════════════════════
