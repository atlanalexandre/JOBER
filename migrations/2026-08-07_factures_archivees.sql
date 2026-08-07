-- ═══════════════════════════════════════════════════════════════════════════
-- Archive immuable des factures émises
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La facture était RECONSTRUITE à chaque affichage, à partir des données
-- vivantes : profil du client, profil du prestataire, ligne `missions`. Deux
-- conséquences, toutes deux contraires à ce qu'est une facture.
--
--   1. Elle changeait. Un prestataire qui modifie sa raison sociale, son SIRET
--      ou son nom voyait TOUTES ses factures passées changer avec lui. Un
--      document comptable ne se réécrit pas.
--
--   2. Elle disparaissait. La suppression de compte anonymise le profil et vide
--      l'adresse des prestations : la facture d'une prestation réglée affichait
--      ensuite « Anonymisé » et plus aucune adresse. Or l'article L123-22 du
--      Code de commerce impose de conserver les pièces justificatives PENDANT
--      DIX ANS. Le droit à l'effacement (RGPD art. 17) ne s'y oppose pas : son
--      §3.b réserve expressément les traitements nécessaires au respect d'une
--      obligation légale.
--
-- CE QUE STOCKE LA TABLE
--
-- Un instantané figé au moment de l'ÉMISSION, c'est-à-dire à l'attribution du
-- numéro — le moment où la facture existe juridiquement. Les affichages
-- suivants relisent cet instantané et ne touchent plus aux données vivantes.
--
-- `contenu` porte l'identification des deux parties, le détail de la prestation
-- et les montants, tels qu'ils étaient ce jour-là.
--
-- CONSERVATION
--
-- Dix ans à compter de la clôture de l'exercice. Aucune suppression automatique
-- n'est programmée : purger une pièce comptable doit rester un acte délibéré.
--
-- SÉCURITÉ
--
-- Lecture et écriture réservées au service role. Le navigateur n'y accède
-- jamais : la facture est rendue par /api/invoice, qui vérifie l'appelant.
--
-- COMPATIBILITÉ
--
-- Sans cette migration, /api/invoice continue de fonctionner exactement comme
-- avant — reconstruction depuis les données vivantes — et journalise que
-- l'archivage est indisponible. Aucun blocage.
--
-- VÉRIFICATION et RETOUR ARRIÈRE — voir le bas du fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.factures_archives (
  -- Le numéro de facture est la clé : il est unique, séquentiel, et c'est lui
  -- qui identifie la pièce en comptabilité.
  numero          text PRIMARY KEY,

  -- Volontairement SANS clé étrangère vers `missions` : une facture doit
  -- survivre à la suppression de la prestation qui l'a produite. C'est tout
  -- l'objet de cette table.
  mission_id      uuid NOT NULL,

  emise_le        timestamptz NOT NULL DEFAULT now(),

  -- Montants extraits du contenu, pour interroger la comptabilité sans avoir à
  -- ouvrir chaque document.
  montant_ht      numeric(12,2),
  montant_tva     numeric(12,2),
  montant_ttc     numeric(12,2),

  -- L'instantané complet : parties, prestation, montants, mentions légales.
  contenu         jsonb NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS factures_archives_mission_idx ON public.factures_archives (mission_id);
CREATE INDEX IF NOT EXISTS factures_archives_emise_idx   ON public.factures_archives (emise_le DESC);


-- ── Immuabilité ────────────────────────────────────────────────────────────
--
-- Une facture émise ne se modifie pas. Une erreur se corrige par un avoir, pas
-- par une réécriture. Le déclencheur l'impose en base, seul endroit qu'aucun
-- chemin d'écriture ne peut contourner — y compris le service role.

CREATE OR REPLACE FUNCTION public.factures_archives_immuable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Une facture archivée ne peut être ni modifiée ni supprimée (numéro %). '
    'Une erreur se corrige par un avoir.', OLD.numero;
END;
$$;

DROP TRIGGER IF EXISTS factures_archives_pas_de_update ON public.factures_archives;
CREATE TRIGGER factures_archives_pas_de_update
  BEFORE UPDATE ON public.factures_archives
  FOR EACH ROW EXECUTE FUNCTION public.factures_archives_immuable();

DROP TRIGGER IF EXISTS factures_archives_pas_de_delete ON public.factures_archives;
CREATE TRIGGER factures_archives_pas_de_delete
  BEFORE DELETE ON public.factures_archives
  FOR EACH ROW EXECUTE FUNCTION public.factures_archives_immuable();


-- ── Sécurité ───────────────────────────────────────────────────────────────
--
-- RLS active sans aucune policy : le rôle `authenticated` ne peut donc ni lire
-- ni écrire. Le service role contourne la RLS et reste seul habilité. La facture
-- est rendue par /api/invoice, qui vérifie l'appelant.

ALTER TABLE public.factures_archives ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. La table, ses index et ses déclencheurs :
--
--    SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.factures_archives'::regclass AND NOT tgisinternal;
--    -- attendu : factures_archives_pas_de_update, factures_archives_pas_de_delete
--
-- 2. La RLS est active et sans policy :
--
--    SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.factures_archives'::regclass;              -- attendu : true
--
--    SELECT count(*) FROM pg_policies
--    WHERE tablename = 'factures_archives';                         -- attendu : 0
--
-- 3. L'immuabilité est réelle — cette requête DOIT échouer :
--
--    UPDATE public.factures_archives SET montant_ttc = 0;
--    -- attendu : ERROR ... ne peut être ni modifiée ni supprimée
--
-- 4. Une fois des factures émises :
--
--    SELECT numero, emise_le, montant_ttc FROM factures_archives
--    ORDER BY emise_le DESC LIMIT 10;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ═══════════════════════════════════════════════════════════════════════════
--
--    DROP TRIGGER IF EXISTS factures_archives_pas_de_update ON public.factures_archives;
--    DROP TRIGGER IF EXISTS factures_archives_pas_de_delete ON public.factures_archives;
--    DROP FUNCTION IF EXISTS public.factures_archives_immuable();
--    DROP TABLE IF EXISTS public.factures_archives;
--
-- ATTENTION : ce sont des pièces comptables soumises à une conservation légale
-- de dix ans. Les exporter avant toute suppression.
-- ═══════════════════════════════════════════════════════════════════════════
