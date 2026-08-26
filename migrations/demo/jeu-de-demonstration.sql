-- ═══════════════════════════════════════════════════════════════════════════
-- JEU DE DÉMONSTRATION — dix prestations, dix situations
-- ═══════════════════════════════════════════════════════════════════════════
--
-- À QUOI ÇA SERT
--
-- Montrer ALANE à quelqu'un suppose d'avoir sous la main une prestation dans
-- chaque état : une en recherche, une en retard, une avec des heures
-- supplémentaires en attente, une en litige… Les créer à la main demanderait
-- des heures, et des horaires qu'on ne peut pas attendre.
--
-- Ce script les pose toutes d'un coup, sur DEUX COMPTES EXISTANTS, avec des
-- dates calculées par rapport à aujourd'hui. Ce ne sont pas des écrans
-- reconstitués : ce sont de vraies prestations, lues par le vrai code, avec les
-- vrais calculs.
--
-- CE QUI NE SERA PAS MONTRÉ, ET POURQUOI
--
-- Aucun paiement Stripe n'est créé — un jeu de démonstration ne débite personne.
-- Les prestations portent donc un identifiant de paiement fictif, reconnaissable
-- (`pi_demo_…`). Deux conséquences à connaître AVANT la démonstration :
--
--   • un remboursement lancé depuis le back-office ÉCHOUERA, Stripe ne
--     connaissant pas ce paiement. C'est le comportement voulu — le code refuse
--     de clore un litige sans avoir rendu l'argent — mais il vaut mieux le
--     savoir que le découvrir devant quelqu'un ;
--   • le versement au prestataire restera « en attente », faute de compte
--     Stripe Connect actif. C'est de toute façon l'état réel aujourd'hui.
--
-- Tout le reste — parcours, écrans, montants, règles, délais — est authentique.
--
-- LES HEURES SONT EN HEURE FRANÇAISE
--
-- `date` et `heure_debut` sont lus par l'application comme de l'heure locale
-- française, alors que la base répond en UTC. Le script convertit donc par
-- `Europe/Paris` — sans quoi la prestation « en cours » s'afficherait avec deux
-- heures d'écart, et le retard de 18 minutes n'aurait aucun sens.
--
-- ─────────────────────────────────────────────────────────────────────────
-- MODE D'EMPLOI
-- ─────────────────────────────────────────────────────────────────────────
--
--   1. Vérifier les deux adresses e-mail du §1, et les corriger si besoin.
--   2. Exécuter le §1 : deux lignes doivent apparaître, CLIENT et PRESTATAIRE.
--   3. Exécuter le §2 en entier, d'un seul coup.
--   4. Ouvrir l'application et se connecter avec l'un ou l'autre compte.
--   5. Pour tout effacer après : le §3.
--
-- Les identifiants des prestations sont FIXES et commencent tous par
-- `d0000000` : la purge est donc exacte, elle ne peut pas emporter autre chose.
-- Le script est rejouable — il efface son propre jeu avant de le recréer, ce
-- qui permet de le relancer chaque matin pour remettre les horaires à jour.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- §1. CONTRÔLE — les deux comptes existent-ils ?
-- ─────────────────────────────────────────────────────────────────────────

SELECT id, email,
       CASE WHEN email = 'atlan.alexandre@groupe-stn.com' THEN 'CLIENT'
            WHEN email = 'alexandre.stngroupe@gmail.com'  THEN 'PRESTATAIRE'
       END AS role_demo
  FROM auth.users
 WHERE email IN ('atlan.alexandre@groupe-stn.com', 'alexandre.stngroupe@gmail.com');


-- ─────────────────────────────────────────────────────────────────────────
-- §2. CRÉATION DU JEU
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  -- Les deux comptes utilisés. À adapter si besoin.
  email_client text := 'atlan.alexandre@groupe-stn.com';
  email_presta text := 'alexandre.stngroupe@gmail.com';

  cli        uuid;
  pre        uuid;
  -- Aujourd'hui et maintenant, en heure française.
  jour       date        := (now() AT TIME ZONE 'Europe/Paris')::date;
  maintenant timestamp   := (now() AT TIME ZONE 'Europe/Paris');
  n          integer;
BEGIN
  SELECT id INTO cli FROM auth.users WHERE email = email_client;
  SELECT id INTO pre FROM auth.users WHERE email = email_presta;

  IF cli IS NULL THEN RAISE EXCEPTION 'Compte client introuvable : %', email_client; END IF;
  IF pre IS NULL THEN RAISE EXCEPTION 'Compte prestataire introuvable : %', email_presta; END IF;
  RAISE NOTICE 'Client % · Prestataire %', cli, pre;

  -- Rejouable : on efface le jeu précédent avant de le recréer.
  DELETE FROM public.missions WHERE id::text LIKE 'd0000000-%';

  INSERT INTO public.missions (
    id, client_id, prestataire_id, sector,
    metier, titre, date, heure_debut,
    hours, actual_hours, ville, adresse,
    description, tarif_horaire, montant_total, status,
    stripe_payment_intent, acceptance_deadline, validation_client, validation_prestataire,
    arrived_at, started_at, delay_status, arrival_delay_minutes,
    extra_hours_requested, extra_hours_status, extra_hours_tarif, payout_status,
    payout_amount, payout_due_at, resolution_proposee, resolution_motif,
    resolution_montant, resolution_notifiee_at, resolution_echeance_at, cashback_applique,
    cashback_debite, created_at
  ) VALUES

  -- (1) EN RECHERCHE — publiée, personne ne l'a encore acceptée.
  ('d0000000-0000-4000-a000-000000000001', cli, NULL, 'hotellerie', 'Femme/Valet de chambre', 'Remise en état — 12 chambres', to_char(jour + 2, 'YYYY-MM-DD'), '08:00', 3, NULL, 'Roissy-en-France', '2 Rue de la Belle Étoile, 95700 Roissy-en-France', 'Remise en état de 12 chambres après départ. Matériel fourni sur place.', 18, 59.98, 'open', NULL, NULL, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '2 hours'),

  -- (2) RÉPONSE ATTENDUE — proposée au prestataire, moins d'une heure restante.
  ('d0000000-0000-4000-a000-000000000002', cli, pre, 'restauration', 'Serveur(se)', 'Service du soir — 40 couverts', to_char(jour + 1, 'YYYY-MM-DD'), '18:30', 4, NULL, 'Tremblay-en-France', '165 Avenue du Bois de la Pie, 93290 Tremblay-en-France', 'Service du soir, 40 couverts. Tenue noire exigée.', 20, 86.5, 'pending_acceptance', 'pi_demo_02', now() + interval '50 minutes', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '10 minutes'),

  -- (3) CONFIRMÉE — acceptée, elle aura lieu dans trois jours.
  ('d0000000-0000-4000-a000-000000000003', cli, pre, 'proprete', 'Agent de propreté', 'Nettoyage des bureaux — 2ᵉ étage', to_char(jour + 3, 'YYYY-MM-DD'), '06:00', 2, NULL, 'Tremblay-en-France', '165 Avenue du Bois de la Pie, 93290 Tremblay-en-France', 'Nettoyage complet des bureaux du 2ᵉ étage avant l''ouverture.', 15, 35.5, 'assigned', 'pi_demo_03', NULL, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '1 day'),

  -- (4) EN COURS AVEC RETARD — pointage 18 minutes après l'heure. Le client doit
  --     arbitrer : accepter le retard, ou refuser les heures perdues.
  ('d0000000-0000-4000-a000-000000000004', cli, pre, 'hotellerie', 'Gouvernant(e) d''étage', 'Contrôle des étages', to_char(jour + 0, 'YYYY-MM-DD'), to_char(maintenant - interval '1 hours', 'HH24:MI'), 4, NULL, 'Roissy-en-France', '2 Rue de la Belle Étoile, 95700 Roissy-en-France', 'Contrôle qualité des étages 1 à 4 et suivi des équipes.', 22, 94.66, 'assigned', 'pi_demo_04', NULL, false, false, now() - interval '42 minutes', now() - interval '42 minutes', 'pending', 18, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '2 days'),

  -- (5) HEURES SUPPLÉMENTAIRES — le prestataire a fixé son tarif, le client doit régler.
  ('d0000000-0000-4000-a000-000000000005', cli, pre, 'logistique', 'Préparateur de commandes', 'Renfort préparation — pic d''activité', to_char(jour + 0, 'YYYY-MM-DD'), to_char(maintenant - interval '3 hours', 'HH24:MI'), 5, NULL, 'Tremblay-en-France', '3 Rue des Chardonnerets, 93290 Tremblay-en-France', 'Renfort sur la préparation de commandes, pic d''activité.', 19, 101.8, 'assigned', 'pi_demo_05', NULL, false, false, now() - interval '3 hours', now() - interval '3 hours', 'approved', 0, 2, 'accepte_presta', 23, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '2 days'),

  -- (6) À VALIDER — terminée, le prestataire a confirmé, le client doit valider.
  --     C'est cette validation qui déclenche le versement.
  ('d0000000-0000-4000-a000-000000000006', cli, pre, 'restauration', 'Plongeur', 'Plonge — service du midi', to_char(jour + 0, 'YYYY-MM-DD'), to_char(maintenant - interval '6 hours', 'HH24:MI'), 3, 3, 'Tremblay-en-France', '165 Avenue du Bois de la Pie, 93290 Tremblay-en-France', 'Plonge et remise en état de la cuisine après le service du midi.', 17, 56.92, 'assigned', 'pi_demo_06', NULL, false, true, now() - interval '6 hours', now() - interval '6 hours', 'approved', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '3 days'),

  -- (7) TERMINÉE — validée des deux côtés, facture disponible, versement programmé.
  ('d0000000-0000-4000-a000-000000000007', cli, pre, 'proprete', 'Laveur de vitres', 'Vitrerie — façade et hall', to_char(jour - 3, 'YYYY-MM-DD'), '07:30', 4, 4, 'Roissy-en-France', '2 Rue de la Belle Étoile, 95700 Roissy-en-France', 'Nettoyage de la vitrerie du hall et de la façade accessible.', 21, 90.58, 'completed', 'pi_demo_07', NULL, true, true, NULL, NULL, 'approved', 0, NULL, NULL, NULL, 'pending', 84, now() - interval '1 day', NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '6 days'),

  -- (8) LITIGE — le client conteste, ALANE propose un remboursement PARTIEL.
  --     Les deux parties ont 48 h pour accepter ou s'y opposer.
  ('d0000000-0000-4000-a000-000000000008', cli, pre, 'hotellerie', 'Femme/Valet de chambre', 'Remise en état — 8 chambres', to_char(jour - 1, 'YYYY-MM-DD'), '08:20', 2, 2, 'Tremblay-en-France', '165 Avenue du Bois de la Pie, 93290 Tremblay-en-France', 'Remise en état de 8 chambres après départ.', 16, 37.54, 'disputed', 'pi_demo_08', NULL, false, true, NULL, NULL, 'approved', 0, NULL, NULL, NULL, 'pending', 32, now() + interval '1 day', 'rembourser_client', 'Trois chambres sur huit n''ont pas été faites — remboursement au prorata.', 12, now() - interval '4 hours', now() + interval '44 hours', 0, false, now() - interval '4 days'),

  -- (9) ANNULÉE ET REMBOURSÉE — personne n'a accepté avant l'heure prévue.
  ('d0000000-0000-4000-a000-000000000009', cli, NULL, 'commercial', 'Hôte(sse) d''accueil magasin', 'Accueil — journée portes ouvertes', to_char(jour - 2, 'YYYY-MM-DD'), '09:00', 6, NULL, 'Aulnay-sous-Bois', '12 Boulevard de Strasbourg, 93600 Aulnay-sous-Bois', 'Accueil et orientation des visiteurs lors de la journée portes ouvertes.', 16, 102.82, 'cancelled', 'pi_demo_09', NULL, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '8 days'),

  -- (10) VERSEMENT EN RETARD — le prestataire n'a pas de compte de virement actif.
  --      C'est l'état réel de la plateforme aujourd'hui.
  ('d0000000-0000-4000-a000-00000000000a', cli, pre, 'divers', 'Agent de sécurité', 'Surveillance — soirée d''entreprise', to_char(jour - 6, 'YYYY-MM-DD'), '19:00', 5, 5, 'Le Blanc-Mesnil', '5 Avenue Charles Floquet, 93150 Le Blanc-Mesnil', 'Surveillance de la soirée d''entreprise, 120 personnes.', 19, 101.8, 'completed', 'pi_demo_10', NULL, true, true, NULL, NULL, 'approved', 0, NULL, NULL, NULL, 'pending', 95, now() - interval '4 days', NULL, NULL, NULL, NULL, NULL, 0, false, now() - interval '9 days');

  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% prestation(s) de démonstration créée(s).', n;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- §3. PURGE — tout effacer après la démonstration
-- ─────────────────────────────────────────────────────────────────────────
--
-- Exact : ne touche que les prestations dont l'identifiant commence par
-- `d0000000`, c'est-à-dire uniquement celles créées ci-dessus.

DO $$
DECLARE
  t      record;
  cibles uuid[];
  n      integer;
BEGIN
  SELECT array_agg(id) INTO cibles
    FROM public.missions WHERE id::text LIKE 'd0000000-%';

  IF cibles IS NULL THEN
    RAISE NOTICE 'Aucune prestation de démonstration — rien à faire.';
    RETURN;
  END IF;

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
    IF to_regclass('public.' || t.nom) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t.nom AND column_name = t.colonne
    ) THEN CONTINUE; END IF;

    IF t.genre = 'texte' THEN
      EXECUTE format('DELETE FROM public.%I WHERE %I::text = ANY($1::text[])', t.nom, t.colonne) USING cibles;
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE %I = ANY($1)', t.nom, t.colonne) USING cibles;
    END IF;
  END LOOP;

  DELETE FROM public.missions WHERE id = ANY(cibles);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% prestation(s) de démonstration supprimée(s).', n;
END $$;
