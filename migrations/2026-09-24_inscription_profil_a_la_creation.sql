-- ═══════════════════════════════════════════════════════════════════════════
-- Inscription : la base enregistre le profil complet à la création du compte
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI
--
-- La confirmation de l'adresse e-mail va être activée. Avec elle, `signUp` crée
-- le compte mais ne rend AUCUNE session tant que le lien n'a pas été cliqué. Or
-- c'est le navigateur, avec sa session, qui complétait `profiles` juste après
-- l'inscription (adresse, SIRET, consentement) et rattachait le parrain
-- (`track_referral`). Sans session, tout cela aurait été perdu — la panne même
-- qui avait privé 87 prestataires sur 88 de leur IBAN (rattrapage du 23/09/2026).
--
-- Le déclencheur `handle_new_user` lit donc désormais ces renseignements dans
-- `raw_user_meta_data`, où le formulaire les dépose déjà, et les écrit lui-même.
-- Il marche que la confirmation soit active ou non.
--
-- CE QUI N'Y EST JAMAIS
--
-- L'IBAN. Il ne se saisit plus à l'inscription : les métadonnées voyagent dans
-- chaque jeton (CLAUDE.md §1.1). Il se renseigne depuis l'espace de l'utilisateur,
-- qui l'écrit dans `profiles.rib`.
--
-- LE PARRAIN
--
-- `parrain` n'est retenu que s'il désigne un compte existant, autre que soi.
-- Même confiance qu'avant : `track_referral` acceptait l'identifiant envoyé par
-- le navigateur. Le compteur du parrain est recalculé comme il le faisait.
--
-- SÛRETÉ
--
-- Une erreur dans ce déclencheur empêcherait TOUTE inscription (« Database error
-- saving new user »). Aucune conversion n'y peut donc échouer : les booléens sont
-- comparés au texte 'true', le parrain est validé par une expression régulière
-- avant toute conversion en uuid.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    meta       jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
    v_role     text  := CASE WHEN meta->>'role' = 'prestataire' THEN 'prestataire' ELSE 'client' END;
    -- COALESCE indispensable : sans la clé, la comparaison vaut NULL, et la
    -- colonne est NOT NULL — l'inscription ENTIÈRE serait refusée. Constaté sur
    -- la recette le 24/09/2026, avant toute mise en production.
    v_comms    boolean := COALESCE((meta->>'accepte_communications') = 'true', false);
    v_parrain  uuid := NULL;
  BEGIN
    IF meta->>'parrain' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND meta->>'parrain' <> NEW.id::text THEN
      SELECT id INTO v_parrain FROM profiles WHERE id = (meta->>'parrain')::uuid;
    END IF;

    INSERT INTO profiles (id, role, prenom, nom, status,
                          adresse, code_postal, ville, societe_nom, siret,
                          accepte_communications, accepte_communications_at, referred_by)
    VALUES (
      NEW.id,
      v_role,
      COALESCE(meta->>'prenom', ''),
      COALESCE(meta->>'nom', ''),
      CASE WHEN v_role = 'client' THEN 'approved' ELSE 'pending' END,
      NULLIF(btrim(meta->>'adresse'), ''),
      NULLIF(btrim(meta->>'code_postal'), ''),
      NULLIF(btrim(meta->>'ville'), ''),
      NULLIF(btrim(meta->>'societe_nom'), ''),
      -- Le prestataire déclare un SIRET, le client professionnel un « KBIS ».
      NULLIF(regexp_replace(COALESCE(meta->>'siret', meta->>'kbis', ''), '[^0-9]', '', 'g'), ''),
      v_comms,
      CASE WHEN v_comms THEN now() ELSE NULL END,
      v_parrain::text
    );

    IF v_parrain IS NOT NULL THEN
      UPDATE profiles
         SET referral_count = (SELECT count(*) FROM profiles WHERE referred_by = v_parrain::text)
       WHERE id = v_parrain;
    END IF;

    RETURN NEW;
  END;
  $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Créer un compte d'essai depuis l'écran d'inscription (ou `signUp`), puis :
--
--   SELECT role, status, adresse, ville, siret, accepte_communications, referred_by
--   FROM profiles ORDER BY created_at DESC LIMIT 1;
--
-- Les renseignements du formulaire doivent y figurer, même si l'adresse e-mail
-- n'a pas encore été confirmée.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE — l'ancienne version, qui n'écrivait que rôle, nom et statut
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
--  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
--   DECLARE v_role text := CASE WHEN NEW.raw_user_meta_data->>'role' = 'prestataire' THEN 'prestataire' ELSE 'client' END;
--   BEGIN
--     INSERT INTO profiles (id, role, prenom, nom, status) VALUES (NEW.id, v_role,
--       COALESCE(NEW.raw_user_meta_data->>'prenom', ''), COALESCE(NEW.raw_user_meta_data->>'nom', ''),
--       CASE WHEN v_role = 'client' THEN 'approved' ELSE 'pending' END);
--     RETURN NEW;
--   END; $f$;
--
-- (Ne rétablir l'ancienne version QU'APRÈS avoir désactivé la confirmation
-- d'e-mail : sinon les inscriptions perdent à nouveau leurs renseignements.)
-- ═══════════════════════════════════════════════════════════════════════════
