-- ═══════════════════════════════════════════════════════════════════════════
-- Un appareil ne reçoit les notifications que d'un seul compte
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Le relevé des abonnements push, le 18/08/2026, montre les mêmes adresses
-- d'appareil (`endpoint`) enregistrées sous DEUX comptes différents.
--
-- Un `endpoint` identifie une installation du site dans un navigateur, pas une
-- personne. Quand quelqu'un se déconnecte et rouvre l'application avec un autre
-- compte — ce que fait tout testeur, et tout prestataire qui a aussi un compte
-- client — le même endpoint est réenregistré sous le nouveau compte. L'ancienne
-- ligne, elle, n'était jamais retirée.
--
-- CE QUE ÇA PROVOQUE
--
-- L'appareil reçoit les notifications des DEUX comptes. Le nom d'un client, le
-- montant d'une prestation, une adresse d'intervention partent sur un téléphone
-- qui ne devait plus rien recevoir.
--
-- Ce n'est pas un doublon gênant, c'est une communication de données
-- personnelles à un destinataire qui n'y a pas droit — le contraire même de la
-- minimisation (RGPD art. 5.1.c). Et le défaut grandit tout seul : chaque
-- changement de compte ajoute une ligne, aucune n'en retire.
--
-- LE CODE EST CORRIGÉ EN MÊME TEMPS
--
-- `api/missions.js` (action `push_subscribe`) supprime désormais les
-- abonnements portant le même endpoint et un autre `user_id` AVANT d'insérer le
-- sien. Cette migration ne traite que les lignes déjà là.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. CONSTATER — à passer AVANT le nettoyage
-- ─────────────────────────────────────────────────────────────────────────
--
--    SELECT endpoint,
--           count(DISTINCT user_id) AS comptes,
--           count(*)                AS lignes,
--           max(created_at)         AS dernier
--    FROM push_subscriptions
--    GROUP BY endpoint
--    HAVING count(DISTINCT user_id) > 1
--    ORDER BY comptes DESC;
--
-- Chaque ligne renvoyée est un appareil qui reçoit les notifications de
-- plusieurs comptes. Zéro ligne : rien à nettoyer, le relevé initial ne
-- montrait que des adresses tronquées qui se ressemblaient.

-- ─────────────────────────────────────────────────────────────────────────
-- 2. NETTOYER — ne garder que le compte le plus récemment abonné
-- ─────────────────────────────────────────────────────────────────────────
--
-- Le plus récent est le bon : c'est celui qui utilise l'appareil aujourd'hui.
-- Les autres sont des sessions abandonnées.

DELETE FROM public.push_subscriptions p
WHERE EXISTS (
  SELECT 1 FROM public.push_subscriptions q
  WHERE q.endpoint = p.endpoint
    AND q.user_id <> p.user_id
    AND q.created_at > p.created_at
);


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Rejouer la requête de constat : elle doit renvoyer ZÉRO ligne.
--
-- Puis, pour voir ce qui reste :
--
--    SELECT user_id, count(*) AS appareils
--    FROM push_subscriptions GROUP BY user_id ORDER BY appareils DESC;
--
-- Plusieurs appareils pour un même compte est NORMAL — téléphone, ordinateur,
-- tablette. C'est l'inverse qui ne l'est pas.
--
-- CONTRÔLE DEPUIS L'APPLICATION :
--
--   se déconnecter, se reconnecter avec l'autre compte, accepter les
--   notifications, puis rejouer la requête de constat → toujours zéro ligne.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aucun. Les lignes supprimées désignaient des comptes qui n'utilisent plus
-- l'appareil ; les restaurer rétablirait la fuite. Un utilisateur privé de
-- notifications n'a qu'à les réaccepter, ce qui recrée son abonnement.
-- ═══════════════════════════════════════════════════════════════════════════
