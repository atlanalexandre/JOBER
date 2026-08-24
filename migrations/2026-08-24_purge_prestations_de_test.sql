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

-- Les tables sans clé étrangère, ou en SET NULL : à traiter à la main, sinon
-- elles gardent une référence vers une prestation qui n'existe plus.
DELETE FROM public.notifications
 WHERE ref_id IN (SELECT id FROM cibles_purge);

DELETE FROM public.ratings
 WHERE mission_id IN (SELECT id FROM cibles_purge);

DELETE FROM public.candidatures
 WHERE mission_id IN (SELECT id FROM cibles_purge);

DELETE FROM public.mission_remplacements
 WHERE mission_id IN (SELECT id FROM cibles_purge);

-- `contracts` et `tracking_positions` portent l'identifiant en TEXTE, sans clé
-- étrangère : la comparaison passe donc par une conversion.
DELETE FROM public.contracts
 WHERE mission_id::text IN (SELECT id::text FROM cibles_purge);

DELETE FROM public.tracking_positions
 WHERE mission_id::text IN (SELECT id::text FROM cibles_purge);

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
