-- ═══════════════════════════════════════════════════════════════════════════
-- Un versement annulé par un remboursement n'est pas un versement « retenu »
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CE QUI EST OBSERVÉ
--
-- Écran « Versements » du back-office, 24/08/2026 :
--
--     Alexandre Atlan — 15,00 €
--     Hôtellerie du 21 août 2026
--     Retenu pour « null » — fin au plus tard le —          [Retenu] [Lever]
--
-- POURQUOI « null »
--
-- Quand un litige se dénoue par un remboursement du client,
-- `executerResolution()` passait la prestation en `payout_status = 'held'` sans
-- renseigner ni motif ni échéance. Or l'écran affiche « Retenu pour « MOTIF » »
-- sans jamais envisager qu'il n'y en ait pas.
--
-- POURQUOI CE N'EST PAS QU'UN DÉFAUT D'AFFICHAGE
--
-- « Retenu » est un état TEMPORAIRE : l'article 7.4 des CGPS borne la retenue à
-- quatre-vingt-dix jours, après quoi elle se lève d'elle-même et le versement
-- part. Le back-office propose d'ailleurs un bouton « Lever ».
--
-- Or ici le client a été remboursé : le prestataire ne doit PAS être payé. Un
-- clic sur « Lever » — ou, si une échéance avait été posée, la levée
-- automatique — aurait versé au prestataire un argent déjà rendu au client.
-- ALANE aurait payé deux fois, sur ses fonds propres.
--
-- Le hold sans échéance protégeait par accident : la levée d'office filtre sur
-- `payout_hold_until`, qui était nul. Un défaut ne doit pas dépendre d'un autre
-- défaut pour être sans conséquence.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- 1. Ouvre `payout_status` à la valeur `annule` : le versement n'aura pas lieu,
--    et ce n'est ni un échec technique (`failed`, qu'on réessaie) ni une
--    retenue (`held`, qui se lève).
-- 2. Convertit les retenues sans motif — qui ne peuvent venir que de ce défaut,
--    le back-office exigeant un motif pour toute retenue manuelle.
--
-- CE QUI RESTE À DÉCIDER, ET QUI N'EST PAS TRANCHÉ ICI
--
-- Après un remboursement PARTIEL, le prestataire ne touche rien aujourd'hui,
-- alors qu'une partie de la prestation a été exécutée et payée par le client.
-- La somme reste chez ALANE. C'est une décision commerciale, pas un défaut
-- technique : elle appartient à Alexandre et n'est pas prise dans cette
-- migration.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_payout_status_check;
ALTER TABLE public.missions
  ADD CONSTRAINT missions_payout_status_check CHECK (
    payout_status IS NULL
    OR payout_status IN ('pending', 'processing', 'transferred', 'failed', 'held', 'annule')
  );

-- Les retenues nées du défaut : ni motif, ni échéance. Une retenue légitime en
-- porte toujours un, le back-office le rend obligatoire.
UPDATE public.missions
   SET payout_status = 'annule'
 WHERE payout_status = 'held'
   AND payout_hold_reason IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Plus aucune retenue sans motif :
--
--    SELECT id, payout_status, payout_hold_reason, payout_hold_until
--    FROM public.missions WHERE payout_status = 'held';
--    -- attendu : chaque ligne a un motif ET une échéance
--
-- 2. Les versements annulés :
--
--    SELECT id, status, montant_total, payout_status
--    FROM public.missions WHERE payout_status = 'annule';
--    -- attendu : des prestations `closed` dont le litige s'est dénoué par un
--    -- remboursement
--
-- 3. La contrainte accepte la nouvelle valeur et refuse l'inconnue :
--
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'missions_payout_status_check';
--
-- CONTRÔLE DEPUIS LE BACK-OFFICE : l'écran « Versements » doit afficher
-- « Annulé — le client a été remboursé », sans bouton « Lever ».
--
-- RETOUR ARRIÈRE
--
--    UPDATE public.missions SET payout_status = 'held' WHERE payout_status = 'annule';
--    ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_payout_status_check;
--    ALTER TABLE public.missions ADD CONSTRAINT missions_payout_status_check CHECK (
--      payout_status IS NULL
--      OR payout_status IN ('pending','processing','transferred','failed','held'));
--
-- À ne faire qu'accompagné du retour arrière du code : sans lui, `annule`
-- serait refusé par la contrainte et TOUTE la requête d'écriture rejetée.
-- ═══════════════════════════════════════════════════════════════════════════
