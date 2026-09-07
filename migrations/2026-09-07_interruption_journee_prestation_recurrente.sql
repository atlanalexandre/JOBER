-- ═══════════════════════════════════════════════════════════════════════════
-- Interrompre une JOURNÉE d'une prestation récurrente, pas la prestation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Sur une prestation récurrente, `hours` est le nombre d'heures PAR JOUR, et
-- `date_debut` / `date_fin` bornent la période. Interrompre en cours mettait
-- fin à toute la prestation et ne comptait que la journée entamée : un
-- prestataire qui avait travaillé lundi et mardi, interrompu mercredi, perdait
-- ses deux premières journées.
--
-- Le client, lui, n'avait pas le choix : arrêter l'après-midi du mercredi
-- annulait aussi le jeudi et le vendredi, alors qu'il ne demandait peut-être
-- que de rentrer plus tôt ce jour-là.
--
-- L'interruption ne porte donc plus que sur la JOURNÉE EN COURS. Le client
-- décide ensuite s'il annule les jours restants ou s'il les conserve.
--
-- CE QUE CETTE COLONNE STOCKE
--
-- Les heures qu'il a été convenu de ne pas faire, cumulées sur toute la
-- prestation. Elle ne sert qu'aux prestations qui CONTINUENT après une
-- interruption : sans elle, la clôture finale calculerait la part du
-- prestataire sur les heures prévues et paierait des heures non travaillées.
--
-- Elle vaut 0 partout ailleurs, y compris sur les prestations d'une seule
-- journée — de très loin le cas courant, où interrompre la journée revient à
-- interrompre la prestation.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS heures_perdues numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN missions.heures_perdues IS
  'Heures convenues comme non effectuées, cumulées sur toute la prestation, à '
  'la suite d''une interruption de journée par le client. Déduites de la part du '
  'prestataire à la clôture (api/_cloture.js). Vaut 0 pour toute prestation '
  'jamais interrompue.';

-- Une valeur négative rendrait au prestataire plus que ce qui a été facturé.
ALTER TABLE missions
  DROP CONSTRAINT IF EXISTS missions_heures_perdues_positives;
ALTER TABLE missions
  ADD CONSTRAINT missions_heures_perdues_positives CHECK (heures_perdues >= 0);

-- ── La colonne n'est pas modifiable depuis le navigateur ────────────────────
--
-- Elle détermine ce que touche le prestataire : un client capable de l'écrire
-- ramènerait sa facture à zéro. Les droits par colonne accordent UPDATE
-- colonne par colonne ; une colonne créée après coup n'y figure pas et n'est
-- donc déjà pas modifiable, mais on le rend explicite plutôt que de reposer
-- sur un effet de bord.
REVOKE UPDATE (heures_perdues) ON public.missions FROM anon, authenticated;

-- ── Relecture ───────────────────────────────────────────────────────────────
--
--   SELECT id, date_debut, date_fin, hours, actual_hours, heures_perdues, status
--   FROM missions
--   WHERE heures_perdues > 0
--   ORDER BY updated_at DESC;
