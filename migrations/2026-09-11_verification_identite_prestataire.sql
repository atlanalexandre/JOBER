-- ═══════════════════════════════════════════════════════════════════════════
-- Le client vérifie que la personne qui se présente est bien celle réservée
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- Rien, dans l'application, ne permettait au client de s'assurer que la
-- personne qui sonne à sa porte est celle qu'il a réservée.
--
--   • l'écran de suivi, ouvert pendant la prestation, n'affichait qu'un émoji ;
--   • la notification d'arrivée ne nommait même pas le prestataire — « Votre
--     prestataire est arrivé(e) pour "Ménage" » ;
--   • aucune action ne permettait de dire « ce n'est pas la bonne personne ».
--     Les seuls recours étaient l'annulation ordinaire, frais de service
--     retenus, ou le litige — dont le bouton n'apparaît qu'APRÈS la prestation,
--     donc une fois la personne entrée chez le client.
--
-- Un prestataire qui envoie quelqu'un d'autre à sa place n'était donc arrêté
-- par rien. Il ne s'agit pas de confort : quelqu'un entre au domicile d'un
-- particulier, parfois en présence d'enfants.
--
-- CE QUE CES COLONNES STOCKENT
--
-- `identite_statut` porte la réponse du client à l'arrivée, et elle seule :
-- `confirmee` s'il reconnaît la personne, `refusee` sinon. NULL tant qu'il n'a
-- pas répondu — la très grande majorité des prestations, puisque la question
-- n'est posée qu'au pointage et qu'y répondre n'est pas obligatoire.
--
-- `identite_repondu_at` horodate la réponse. Sur un refus, c'est la pièce qui
-- date l'incident : elle sert à l'arbitrage, et le prestataire suspendu est en
-- droit de savoir quand les faits sont survenus.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS identite_statut      text,
  ADD COLUMN IF NOT EXISTS identite_repondu_at  timestamptz;

COMMENT ON COLUMN missions.identite_statut IS
  'Réponse du client quand le prestataire pointe son arrivée : « confirmee » '
  '(c''est bien la personne réservée) ou « refusee » (ce n''est pas elle). NULL '
  'tant qu''il n''a pas répondu. Un refus annule la prestation, rembourse le '
  'client intégralement — frais de service compris — et suspend le prestataire '
  'le temps d''une vérification.';

COMMENT ON COLUMN missions.identite_repondu_at IS
  'Horodatage de la réponse du client. Sur un refus, date l''incident.';

-- Deux valeurs, et deux seulement. NULL reste permis : c'est l'état normal
-- d'une prestation où la question n'a pas été posée ou pas été traitée.
--
-- Règle 1.6 de CLAUDE.md : ces deux valeurs sont les seules écrites par le
-- code (`api/missions.js`, actions `confirmer_identite` et `refuser_identite`).
ALTER TABLE missions
  DROP CONSTRAINT IF EXISTS missions_identite_statut_check;
ALTER TABLE missions
  ADD CONSTRAINT missions_identite_statut_check
  CHECK (identite_statut IS NULL OR identite_statut IN ('confirmee', 'refusee'));

-- ── Ces colonnes ne sont pas modifiables depuis le navigateur ───────────────
--
-- Un refus déclenche un remboursement intégral et la suspension d'un
-- prestataire. Laisser le navigateur l'écrire directement, c'est permettre à
-- un client de se rembourser lui-même et de suspendre qui il veut. Les deux
-- colonnes ne sont écrites que par `/api`, en rôle service, après vérification
-- de l'appelant et de la fenêtre de pointage.
REVOKE UPDATE (identite_statut)     ON public.missions FROM anon, authenticated;
REVOKE UPDATE (identite_repondu_at) ON public.missions FROM anon, authenticated;

-- ── Relecture ───────────────────────────────────────────────────────────────
--
-- Les refus d'identité, du plus récent au plus ancien — à relire régulièrement,
-- c'est la liste des incidents les plus graves que la plateforme puisse
-- connaître :
--
--   SELECT id, client_id, prestataire_id, date, metier,
--          identite_statut, identite_repondu_at, cancellation_reason
--   FROM missions
--   WHERE identite_statut = 'refusee'
--   ORDER BY identite_repondu_at DESC;
--
-- Et le taux de réponse, pour savoir si le dispositif est réellement utilisé :
--
--   SELECT identite_statut, count(*)
--   FROM missions
--   WHERE arrived_at IS NOT NULL
--   GROUP BY identite_statut;
