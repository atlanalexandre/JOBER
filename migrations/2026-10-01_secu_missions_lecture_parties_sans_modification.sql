-- ═══════════════════════════════════════════════════════════════════════════
-- secu_missions_lecture_parties_sans_modification
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (audit « sécurité », 01/10/2026 — constaté en recette, e2e/54)
--
-- 1. LECTURE. La règle `missions_open_read`, accordée au rôle `public`, laissait
--    lire toute demande « open » ou « needs_replacement » à N'IMPORTE QUI — y
--    compris sans compte, avec la seule clé publique embarquée dans le site.
--    Toutes les colonnes : adresse et nom du client, description, montant,
--    déclaration de tiers. 40 demandes lisibles ainsi en recette.
--    Aucun écran n'en a besoin : la place de marché des prestataires passe par
--    /api (`list_open`), qui masque l'adresse ; le compteur de l'accueil passe
--    par /api/prestataires?action=demandes_ouvertes (déployé AVANT cette
--    migration).
--
-- 2. MODIFICATION. La règle `missions_update` et les droits par colonne
--    laissaient le client ET le prestataire modifier directement, depuis le
--    navigateur, quinze colonnes de leurs prestations — dont
--    `extra_hours_appliquees`, qui entre dans le calcul du virement : après une
--    prolongation à un tarif supérieur, le prestataire pouvait déclarer toutes
--    les heures à ce tarif et être payé plus que ce qu'ALANE avait encaissé.
--    Aussi `recurrence`, `adresse`, `metier`, `sector`…
--    Aucun écran n'a besoin d'écrire : tout passe par /api. La seule écriture
--    directe restante (validation, `client-screens.jsx`) était déjà refusée par
--    le déclencheur `prevent_missions_field_tampering`.
--
-- La CRÉATION d'une demande depuis le navigateur reste permise (App.jsx), sous
-- le contrôle du déclencheur `missions_creation_guard`.
--
-- ORDRE : recette, vérification par e2e/54, puis production.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Lecture : les parties seulement, et seulement connectées.
DROP POLICY IF EXISTS missions_open_read ON public.missions;
CREATE POLICY missions_lecture_parties ON public.missions
  FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()) OR prestataire_id = (SELECT auth.uid()));

-- 2. Modification et suppression : plus aucune depuis le navigateur.
DROP POLICY IF EXISTS missions_update ON public.missions;
REVOKE UPDATE, DELETE, TRUNCATE ON public.missions FROM anon, authenticated;

-- 3. Création : inchangée sur le fond, réservée aux comptes connectés.
DROP POLICY IF EXISTS missions_insert ON public.missions;
CREATE POLICY missions_insert ON public.missions
  FOR INSERT TO authenticated
  WITH CHECK (client_id = (SELECT auth.uid()));

-- VÉRIFICATION — attendu : deux lignes, missions_insert (INSERT) et
-- missions_lecture_parties (SELECT), toutes deux {authenticated}.
--   SELECT policyname, cmd, roles::text FROM pg_policies WHERE tablename = 'missions';
-- Et aucune ligne ici :
--   SELECT grantee, privilege_type FROM information_schema.column_privileges
--    WHERE table_name = 'missions' AND grantee IN ('anon','authenticated')
--      AND privilege_type IN ('UPDATE','DELETE');
