-- ═══════════════════════════════════════════════════════════════════════════
-- pilotage_acceptee_at_remplacement
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (relecture quotidienne du 03/11/2026)
--
-- Le déclencheur `missions_acceptee_at` (2026-11-01_pilotage_acceptee_at.sql)
-- ne pose la date de première acceptation qu'en sortant de `open` ou de
-- `pending_acceptance`. Or le webhook Stripe pose aussi `needs_replacement` sur
-- un paiement dont le prestataire n'a PAS été retenu, sans que personne ait
-- jamais accepté. Quand un prestataire prend ensuite la demande
-- (`needs_replacement` → `assigned`), c'est bien la PREMIÈRE acceptation — et
-- `acceptee_at` restait vide pour toujours. Ces demandes, celles qui ont le
-- plus attendu, manquaient au délai médian du pilotage, qui paraissait plus
-- court qu'il n'est.
--
-- `needs_replacement` avait été écarté exprès : une prestation acceptée AVANT
-- la première migration (acceptee_at vide, faute de colonne), puis remplacée,
-- aurait pris l'heure du remplaçant. On l'admet donc seulement pour les
-- prestations créées APRÈS le passage de cette colonne partout (production le
-- 02/11/2026 au soir) : pour elles, `acceptee_at` vide veut dire que personne
-- n'a encore accepté. Une prestation acceptée puis remplacée a déjà sa date,
-- et la condition `OLD.acceptee_at IS NULL` la laisse intacte.
--
-- Rien d'autre ne change. Aucune donnée n'est réécrite. Contrainte : aucune.
-- ORDRE : indifférent (le code lit déjà la colonne, à part).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.missions_poser_acceptee_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.acceptee_at := CASE WHEN NEW.status = 'assigned' THEN now() ELSE NULL END;
  ELSIF NEW.status = 'assigned' AND OLD.acceptee_at IS NULL
        AND (OLD.status IN ('open', 'pending_acceptance')
             OR (OLD.status = 'needs_replacement' AND OLD.created_at >= '2026-11-03 00:00:00+00')) THEN
    NEW.acceptee_at := now();
  ELSIF current_user = 'postgres' THEN
    NULL;
  ELSE
    NEW.acceptee_at := OLD.acceptee_at;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Vérification ───────────────────────────────────────────────────────────
--
-- La fonction contient la nouvelle condition — ATTENDU : true.
--
-- SELECT prosrc LIKE '%needs_replacement%' FROM pg_proc WHERE proname = 'missions_poser_acceptee_at';
--
-- ── Retour arrière : rejouer 2026-11-01_pilotage_acceptee_at.sql (la fonction seule).
