-- ═══════════════════════════════════════════════════════════════════════════
-- Numéro de facture stable
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La facture est produite à la volée à chaque ouverture de son URL, et un
-- nouveau numéro était tiré du compteur `platform_settings.invoice_sequence` à
-- CHAQUE affichage. Conséquences :
--
--   • la même prestation changeait de numéro de facture à chaque consultation ;
--   • le compteur grimpait à chaque coup d'œil, pas à chaque facture émise ;
--   • deux factures différentes pouvaient porter le même numéro selon le moment
--     où chacune avait été ouverte.
--
-- L'article 242 nonies A de l'annexe II au CGI impose une numérotation continue,
-- sans rupture, reposant sur une séquence chronologique. Un numéro qui change à
-- chaque affichage ne satisfait aucune de ces conditions.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- Ajoute `missions.invoice_number`. Le numéro est attribué au premier affichage
-- puis conservé ; les affichages suivants le relisent. La contrainte d'unicité
-- interdit que deux prestations portent le même.
--
-- COMPATIBILITÉ
--
-- Le code sait fonctionner sans cette migration : il tire un numéro, ne parvient
-- pas à le conserver, et le signale en erreur dans les journaux à chaque facture.
-- Appliquer cette migration n'impose donc aucun ordre par rapport au déploiement.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS invoice_number text;

-- Unicité sur les seules valeurs renseignées : les prestations sans facture
-- restent à NULL et ne se gênent pas entre elles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_missions_invoice_number
  ON public.missions(invoice_number)
  WHERE invoice_number IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La colonne existe :
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'missions' AND column_name = 'invoice_number';
--
-- 2. Après avoir ouvert une facture deux fois, le numéro doit être identique et
--    apparaître ici :
--
--    SELECT id, invoice_number FROM missions
--    WHERE invoice_number IS NOT NULL ORDER BY created_at DESC LIMIT 5;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP INDEX IF EXISTS idx_missions_invoice_number;
--    ALTER TABLE public.missions DROP COLUMN IF EXISTS invoice_number;
--
-- Attention : supprimer cette colonne efface les numéros déjà attribués. Une
-- facture émise ne devrait jamais changer de numéro — ne revenir en arrière que
-- si aucune facture n'a encore été remise à un client.
-- ═══════════════════════════════════════════════════════════════════════════
