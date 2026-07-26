-- ============================================================
-- JOBER — Schéma complet Supabase
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- ── TABLE missions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prestataire_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sector                text,
  metier                text,
  date                  text,
  hours                 numeric,
  ville                 text,
  tarif_horaire         numeric,
  montant_total         numeric,
  status                text DEFAULT 'open',   -- open | pending_acceptance | assigned | completed | closed | rejected | refused
  stripe_payment_intent text,
  created_at            timestamptz DEFAULT now()
);

-- Colonnes ajoutées progressivement (idempotent)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS stripe_payment_intent text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS adresse               text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS description           text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS acceptance_deadline   timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS validation_client     boolean DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS validation_prestataire boolean DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_rating         integer;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS presta_rating         integer;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_comment        text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS presta_comment        text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS heure_debut           text;

-- ── TABLE candidatures ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidatures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid REFERENCES missions(id) ON DELETE CASCADE,
  prestataire_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  message        text,
  status         text DEFAULT 'pending',  -- pending | accepted | rejected
  created_at     timestamptz DEFAULT now()
);

-- ── TABLE notifications ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text,   -- mission | cashback | system
  title      text,
  body       text,
  read       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ── TABLE documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type           text,          -- kbis | rib | cni | urssaf | rib | domicile | rc_pro | photo | autre
  storage_path   text NOT NULL, -- chemin dans le bucket "documents"
  verified       boolean DEFAULT false,
  created_at     timestamptz DEFAULT now()
);
-- Fix FK si elle pointe vers une table "prestataires" au lieu de auth.users :
-- ALTER TABLE documents DROP CONSTRAINT documents_prestataire_id_fkey;
-- ALTER TABLE documents ADD CONSTRAINT documents_prestataire_id_fkey
--   FOREIGN KEY (prestataire_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── COLONNES manquantes sur profiles ─────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cashback_balance        numeric DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS missions_completed_month integer DEFAULT 0;
-- Wallet prépayé client (solde rechargé via Stripe, débité à chaque mission)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS prepaid_balance         numeric DEFAULT 0;

-- [Str-06] Stripe Connect — colonnes manquantes sur profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id     text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_status text DEFAULT 'pending';

-- ── RLS sur profiles ──────────────────────────────────────────
-- (la table profiles n'avait pas de RLS — correctif)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id          -- toujours accès à son propre profil
    OR role = 'prestataire'  -- profils prestataires lisibles pour les listings clients
  );

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- RLS — Row Level Security
-- ============================================================

ALTER TABLE missions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidatures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents     ENABLE ROW LEVEL SECURITY;

-- ── missions ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "missions_client_own"     ON missions;
DROP POLICY IF EXISTS "missions_presta_assigned" ON missions;
DROP POLICY IF EXISTS "missions_open_read"       ON missions;
DROP POLICY IF EXISTS "missions_client_insert"   ON missions;
DROP POLICY IF EXISTS "missions_client_update"   ON missions;

-- Tout utilisateur connecté peut voir les missions ouvertes ou en recherche de remplaçant
CREATE POLICY "missions_open_read" ON missions
  FOR SELECT USING (status IN ('open', 'needs_replacement') OR client_id = auth.uid() OR prestataire_id = auth.uid());

-- Un client peut créer ses propres missions
CREATE POLICY "missions_client_insert" ON missions
  FOR INSERT WITH CHECK (client_id = auth.uid());

-- Client et prestataire assigné peuvent modifier
CREATE POLICY "missions_client_update" ON missions
  FOR UPDATE USING (client_id = auth.uid() OR prestataire_id = auth.uid());

-- ── candidatures ─────────────────────────────────────────────
DROP POLICY IF EXISTS "candidatures_presta_own"   ON candidatures;
DROP POLICY IF EXISTS "candidatures_client_read"  ON candidatures;
DROP POLICY IF EXISTS "candidatures_presta_insert" ON candidatures;
DROP POLICY IF EXISTS "candidatures_update"       ON candidatures;

-- Prestataire voit ses propres candidatures
CREATE POLICY "candidatures_presta_own" ON candidatures
  FOR SELECT USING (prestataire_id = auth.uid());

-- Client voit les candidatures de ses missions
CREATE POLICY "candidatures_client_read" ON candidatures
  FOR SELECT USING (
    mission_id IN (SELECT id FROM missions WHERE client_id = auth.uid())
  );

-- Prestataire peut postuler
CREATE POLICY "candidatures_presta_insert" ON candidatures
  FOR INSERT WITH CHECK (prestataire_id = auth.uid());

-- Prestataire peut retirer, client peut accepter/refuser
CREATE POLICY "candidatures_update" ON candidatures
  FOR UPDATE USING (
    prestataire_id = auth.uid() OR
    mission_id IN (SELECT id FROM missions WHERE client_id = auth.uid())
  );

-- ── notifications ─────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_own" ON notifications;

CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid());

-- ── documents ────────────────────────────────────────────────
DROP POLICY IF EXISTS "documents_presta_own"   ON documents;
DROP POLICY IF EXISTS "documents_presta_insert" ON documents;

-- Prestataire voit ses propres documents
CREATE POLICY "documents_presta_own" ON documents
  FOR SELECT USING (prestataire_id = auth.uid());

-- Prestataire peut uploader
CREATE POLICY "documents_presta_insert" ON documents
  FOR INSERT WITH CHECK (prestataire_id = auth.uid());

-- Note : la lecture BO des documents se fait via service_role_key (bypass RLS) — OK

-- ── TABLE visits (tracking visiteurs) ────────────────────────
CREATE TABLE IF NOT EXISTS visits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id    uuid,          -- null si visiteur anonyme
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visits_created_at_idx ON visits (created_at);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut insérer sa propre visite (anon inclus)
-- [Str-05] Restreindre INSERT sur visits aux rôles authenticated et anon uniquement
DROP POLICY IF EXISTS "visits_insert" ON visits;
CREATE POLICY "visits_insert" ON visits
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- [Str-05] Contrainte anti-abus : une session ne peut insérer qu'une fois par path
-- NOTE: visits n'a pas de colonne `path` — si elle est ajoutée ultérieurement :
-- ALTER TABLE visits ADD COLUMN IF NOT EXISTS path text;
-- ALTER TABLE visits ADD CONSTRAINT visits_session_path_unique UNIQUE (session_id, path);

-- Lecture réservée au service role (BO uniquement via service_role_key)

-- ── TABLE messages (chat client ↔ prestataire) ────────────────
CREATE TABLE IF NOT EXISTS messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key text NOT NULL,   -- format : "<userId1>_<userId2>"
  sender_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_tag       text,            -- "client" | "prestataire"
  content          text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_key_idx ON messages (conversation_key);
CREATE INDEX IF NOT EXISTS messages_created_at_idx       ON messages (created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_participants" ON messages;
DROP POLICY IF EXISTS "messages_select"       ON messages;
DROP POLICY IF EXISTS "messages_insert"       ON messages;
DROP POLICY IF EXISTS "messages_delete"       ON messages;

-- Lecture : les deux participants de la conversation
CREATE POLICY "messages_select" ON messages
  FOR SELECT USING (
    sender_id = auth.uid() OR
    conversation_key LIKE '%' || auth.uid()::text || '%'
  );

-- Insertion : uniquement l'auteur (sender_id vérifié côté serveur)
CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

-- Suppression : uniquement l'auteur du message (pas l'autre participant)
CREATE POLICY "messages_delete" ON messages
  FOR DELETE USING (sender_id = auth.uid());

-- ── TABLE support_tickets ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  user_name  text,
  subject    text,
  message    text,
  status     text DEFAULT 'open',   -- open | closed
  created_at timestamptz DEFAULT now()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_insert" ON support_tickets;
CREATE POLICY "support_tickets_insert" ON support_tickets
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "support_tickets_own" ON support_tickets;
CREATE POLICY "support_tickets_own" ON support_tickets
  FOR SELECT USING (user_id = auth.uid());

-- ── TABLE ratings (notations prestataires) ───────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_provider_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_name        text,
  mission_id           uuid REFERENCES missions(id) ON DELETE SET NULL,
  rating               integer CHECK (rating BETWEEN 1 AND 5),
  tags                 text[],
  comment              text,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ratings_provider_idx ON ratings (reviewee_provider_id);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ratings_insert" ON ratings;
CREATE POLICY "ratings_insert" ON ratings
  FOR INSERT WITH CHECK (reviewer_id = auth.uid());

DROP POLICY IF EXISTS "ratings_read" ON ratings;
CREATE POLICY "ratings_read" ON ratings
  FOR SELECT USING (true);

-- ── TABLE contracts (contrats de mission signés) ─────────────────────
-- [Str-03] NOTE MIGRATION: contracts.mission_id devrait être uuid REFERENCES missions(id)
-- Pour migrer : ALTER TABLE contracts ADD COLUMN mission_uuid uuid REFERENCES missions(id);
-- UPDATE contracts SET mission_uuid = mission_id::uuid WHERE mission_id ~ '^[0-9a-f-]{36}$';
-- ALTER TABLE contracts DROP COLUMN mission_id; ALTER TABLE contracts RENAME COLUMN mission_uuid TO mission_id;
CREATE TABLE IF NOT EXISTS contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id            text,
  contract_number       text UNIQUE,
  client_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prestataire_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prestataire_name      text,
  prestataire_role      text,
  nb_heures             numeric,
  montant               numeric,
  client_signed         boolean DEFAULT false,
  prestataire_signed    boolean DEFAULT false,
  client_signed_at      timestamptz,
  prestataire_signed_at timestamptz,
  created_at            timestamptz DEFAULT now()
);

-- [S-07] Colonne prestataire_id ajoutée en migration idempotente
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS prestataire_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_client_own" ON contracts;
CREATE POLICY "contracts_client_own" ON contracts
  FOR ALL USING (client_id = auth.uid());

-- [S-07] Policy SELECT pour le prestataire
DROP POLICY IF EXISTS "contracts_presta_read" ON contracts;
CREATE POLICY "contracts_presta_read" ON contracts
  FOR SELECT USING (prestataire_id = auth.uid());

-- ── TABLE tracking_positions (localisation GPS prestataires) ─────────
-- [Str-04] NOTE MIGRATION: tracking_positions.mission_id devrait être uuid REFERENCES missions(id)
-- Pour migrer : ALTER TABLE tracking_positions ADD COLUMN mission_uuid uuid REFERENCES missions(id);
-- UPDATE tracking_positions SET mission_uuid = mission_id::uuid WHERE mission_id ~ '^[0-9a-f-]{36}$';
-- ALTER TABLE tracking_positions DROP COLUMN mission_id; ALTER TABLE tracking_positions RENAME COLUMN mission_uuid TO mission_id;
CREATE TABLE IF NOT EXISTS tracking_positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      text NOT NULL,
  prestataire_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  lat             numeric NOT NULL,
  lng             numeric NOT NULL,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (mission_id, prestataire_id)
);

ALTER TABLE tracking_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracking_presta_write" ON tracking_positions;
CREATE POLICY "tracking_presta_write" ON tracking_positions
  FOR ALL USING (prestataire_id = auth.uid());

DROP POLICY IF EXISTS "tracking_read" ON tracking_positions;
CREATE POLICY "tracking_read" ON tracking_positions
  FOR SELECT USING (
    prestataire_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM missions
      WHERE missions.id::text = tracking_positions.mission_id
      AND missions.client_id = auth.uid()
    )
  );

-- ── TABLE favorites (prestataires mis en favoris par les clients) ─────
CREATE TABLE IF NOT EXISTS favorites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, provider_id)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_own" ON favorites;
CREATE POLICY "favorites_own" ON favorites
  FOR ALL USING (user_id = auth.uid());

-- ── Colonnes parrainage sur profiles ───────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by     text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_count  integer DEFAULT 0;

-- ── Récurrence missions ──────────────────────────────────────────────
ALTER TABLE missions ADD COLUMN IF NOT EXISTS recurrence        text DEFAULT NULL; -- 'weekly' | 'biweekly' | 'monthly' | null
ALTER TABLE missions ADD COLUMN IF NOT EXISTS parent_mission_id uuid REFERENCES missions(id) ON DELETE SET NULL;

-- ── Colonnes manquantes missions ─────────────────────────────────────
ALTER TABLE missions ADD COLUMN IF NOT EXISTS titre                text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_debut           text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_fin             text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_nom           text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS cancellation_reason  text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS cancellation_penalty numeric DEFAULT 0;

-- [Str-07 + B-05 + N-05 + S-06] Colonnes manquantes sur missions
ALTER TABLE missions ADD COLUMN IF NOT EXISTS payout_status                  text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS stripe_transfer_id             text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS end_notif_sent                 boolean DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS cashback_credited              boolean DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS last_validation_reminder_at    timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS broadcast_sent_at              timestamptz;

-- ── plan_abonnement + subscription_end_date sur profiles ────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_abonnement        text DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_end_date  date;

-- ── TABLE bo_logs (audit trail des actions backoffice) ─────────────────
CREATE TABLE IF NOT EXISTS bo_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  target_id    uuid,
  target_email text,
  reason       text,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE bo_logs ENABLE ROW LEVEL SECURITY;

-- ── TABLE platform_settings (réglages plateforme editables depuis le BO) ──
CREATE TABLE IF NOT EXISTS platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Lecture publique (anon + authenticated)
DROP POLICY IF EXISTS "settings_read" ON platform_settings;
CREATE POLICY "settings_read" ON platform_settings FOR SELECT USING (true);

-- Valeurs par défaut
INSERT INTO platform_settings (key, value) VALUES
  ('plan_limits',          '{"free": 2, "premium": 8, "elite": 999}'::jsonb),
  ('subscription_prices',  '{"premium": {"monthly": 29, "yearly": 290}, "elite": {"monthly": 79, "yearly": 790}}'::jsonb),
  ('commission_rate',      '0'::jsonb),
  ('urgency_surcharge',    '5'::jsonb),
  ('frais_service',        '{"single": 4.90, "range": 2.90, "urgent": 9.90}'::jsonb),
  ('launch_phase',         'true'::jsonb),
  ('disabled_sectors',     '[]'::jsonb),
  ('cashback_rates',       '[{"id":"standard","min":0,"max":2,"rate":0.005},{"id":"silver","min":3,"max":5,"rate":0.0075},{"id":"gold","min":6,"max":9,"rate":0.01},{"id":"platinum","min":10,"max":999,"rate":0.015}]'::jsonb),
  ('sector_min_prestataires', '20'::jsonb),
  ('invoice_sequence',        '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── WEB PUSH SUBSCRIPTIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_own" ON push_subscriptions;
CREATE POLICY "push_own" ON push_subscriptions
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Compatibilité ascendante : les missions déjà assignées avant l'introduction de validation_prestataire
-- sont considérées comme déjà validées côté prestataire pour ne pas bloquer les clients
UPDATE missions SET validation_prestataire = true WHERE status = 'assigned' AND validation_prestataire = false;

-- Valeurs possibles du champ status (pour référence)
-- open | pending_acceptance | assigned | needs_replacement | completed | closed | rejected | refused | cancelled

-- Migration : champs facturation sur profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS adresse text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS code_postal text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ville text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS siret text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS societe_nom text;

-- Signatures électroniques
ALTER TABLE missions ADD COLUMN IF NOT EXISTS contrat_client_signe_at timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS contrat_presta_signe_at timestamptz;

-- Anti-abus : flag permanent indiquant que le trial gratuit a été consommé
-- Ne se remet pas à zéro lors du reset mensuel du cron
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_exhausted boolean DEFAULT false;

-- Stripe subscription tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id     text;

-- ── TABLE account_blacklist ──────────────────────────────────
-- Mémorise les identifiants des comptes prestataires supprimés
-- pour empêcher de recréer un compte et retrouver les missions gratuites
CREATE TABLE IF NOT EXISTS account_blacklist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text,
  telephone  text,
  iban       text,
  siret      text,
  reason     text DEFAULT 'account_deleted',
  created_at timestamptz DEFAULT now()
);

-- Index pour recherche rapide lors de l'approbation BO
CREATE INDEX IF NOT EXISTS idx_blacklist_telephone ON account_blacklist(telephone) WHERE telephone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_iban      ON account_blacklist(iban)      WHERE iban IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_siret     ON account_blacklist(siret)     WHERE siret IS NOT NULL;

-- RLS sur account_blacklist — lecture/écriture réservée au service_role (BO)
-- Avec RLS activé et aucune politique, seul le service_role (bypass RLS) peut accéder
ALTER TABLE account_blacklist ENABLE ROW LEVEL SECURITY;

-- ── FONCTION atomique cashback ────────────────────────────────────────
-- Incrémente le solde cashback de manière atomique pour éviter les race conditions
-- Usage : SELECT increment_cashback(user_id, delta, missions_delta)
CREATE OR REPLACE FUNCTION increment_cashback(
  p_user_id  uuid,
  p_delta    numeric,
  p_missions integer DEFAULT 1
)
RETURNS TABLE (cashback_balance numeric, missions_completed_month integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles
  SET
    cashback_balance        = COALESCE(cashback_balance, 0) + p_delta,
    missions_completed_month = COALESCE(missions_completed_month, 0) + p_missions
  WHERE id = p_user_id;
  RETURN QUERY SELECT p.cashback_balance, p.missions_completed_month
    FROM profiles p WHERE p.id = p_user_id;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_blacklist_email     ON account_blacklist(email)     WHERE email IS NOT NULL;

-- Checkin prestataire : horodatage d'arrivée sur place
ALTER TABLE missions ADD COLUMN IF NOT EXISTS arrived_at timestamptz;

-- Démarrage effectif de la prestation (déclenche le timer côté prestataire)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Gestion du retard d'arrivée du prestataire
ALTER TABLE missions ADD COLUMN IF NOT EXISTS arrival_delay_minutes integer;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS delay_status text; -- 'pending' | 'approved' | 'rejected'

-- Heures réelles facturées (ancre de facturation — définie par respond_delay et extra_hours)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS actual_hours numeric;

-- Heures supplémentaires demandées par le prestataire
ALTER TABLE missions ADD COLUMN IF NOT EXISTS extra_hours_requested numeric;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS extra_hours_status text; -- 'pending' | 'accepted' | 'refused'

-- ── FONCTION atomique vérification limite de plan ────────────────────
-- Vérifie si le prestataire peut encore accepter une mission (lecture atomique FOR UPDATE)
-- Retourne le nombre de slots disponibles (0 = limite atteinte)
CREATE OR REPLACE FUNCTION check_prestataire_slot(
  p_prestataire_id uuid,
  p_limit          integer
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_completed integer;
  v_active    integer;
  v_total     integer;
BEGIN
  -- FOR UPDATE verrouille la ligne pendant la transaction pour éviter les races
  SELECT COALESCE(missions_completed_month, 0) INTO v_completed
  FROM profiles WHERE id = p_prestataire_id FOR UPDATE;

  SELECT COUNT(*) INTO v_active
  FROM missions
  WHERE prestataire_id = p_prestataire_id
    AND status IN ('assigned', 'pending_acceptance');

  v_total := v_completed + v_active;
  RETURN GREATEST(0, p_limit - v_total);
END;
$$;

-- ── INDEX de performance ──────────────────────────────────────────────
-- Requêtes fréquentes : missions ouvertes triées par date, missions par client/prestataire
CREATE INDEX IF NOT EXISTS idx_missions_status_created        ON missions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missions_client_status         ON missions(client_id, status);
CREATE INDEX IF NOT EXISTS idx_missions_prestataire_status    ON missions(prestataire_id, status);
CREATE INDEX IF NOT EXISTS idx_candidatures_mission_status    ON candidatures(mission_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread      ON notifications(user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created     ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user        ON push_subscriptions(user_id);

-- ── Sécurité : messages_select — LIKE remplacé par split_part exact ───────
-- Le LIKE '%' || uid || '%' pouvait matcher des conversation_key non liées
-- à l'utilisateur. split_part compare exactement l'UUID en position 1 ou 2.
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages
  FOR SELECT USING (
    sender_id = auth.uid() OR
    split_part(conversation_key, '_', 1) = auth.uid()::text OR
    split_part(conversation_key, '_', 2) = auth.uid()::text
  );

-- ── Sécurité : protection colonne-niveau sur missions ─────────────────────
-- Un utilisateur authentifié (anon key) ne peut pas modifier directement
-- les colonnes sensibles. auth.uid() = NULL pour le service_role → autorisé.
CREATE OR REPLACE FUNCTION prevent_missions_field_tampering()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF (NEW.client_id              IS DISTINCT FROM OLD.client_id)              OR
     (NEW.prestataire_id         IS DISTINCT FROM OLD.prestataire_id)         OR
     (NEW.montant_total          IS DISTINCT FROM OLD.montant_total)          OR
     (NEW.stripe_payment_intent  IS DISTINCT FROM OLD.stripe_payment_intent)  OR
     (NEW.status                 IS DISTINCT FROM OLD.status)                 OR
     (NEW.cashback_credited      IS DISTINCT FROM OLD.cashback_credited)      OR
     (NEW.validation_client      IS DISTINCT FROM OLD.validation_client)      OR
     (NEW.validation_prestataire IS DISTINCT FROM OLD.validation_prestataire) THEN
    RAISE EXCEPTION 'Modification directe de colonnes protégées interdite — passez par l''API';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missions_field_tamper_guard ON missions;
CREATE TRIGGER missions_field_tamper_guard
  BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION prevent_missions_field_tampering();

-- ── Sécurité : account_blacklist — hachage SHA-256 des données PII ────────
-- Les colonnes claires (email, telephone, iban, siret) sont remplacées
-- par des hashes — seul le service_role (BO) peut accéder à cette table.
ALTER TABLE account_blacklist ADD COLUMN IF NOT EXISTS email_hash     text;
ALTER TABLE account_blacklist ADD COLUMN IF NOT EXISTS telephone_hash text;
ALTER TABLE account_blacklist ADD COLUMN IF NOT EXISTS iban_hash      text;
ALTER TABLE account_blacklist ADD COLUMN IF NOT EXISTS siret_hash     text;

DROP INDEX IF EXISTS idx_blacklist_email;
DROP INDEX IF EXISTS idx_blacklist_telephone;
DROP INDEX IF EXISTS idx_blacklist_iban;
DROP INDEX IF EXISTS idx_blacklist_siret;

CREATE INDEX IF NOT EXISTS idx_blacklist_email_hash     ON account_blacklist(email_hash)     WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_telephone_hash ON account_blacklist(telephone_hash) WHERE telephone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_iban_hash      ON account_blacklist(iban_hash)      WHERE iban_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_siret_hash     ON account_blacklist(siret_hash)     WHERE siret_hash IS NOT NULL;

-- ── Sécurité : rate-limit persistant backoffice ───────────────────────────
-- Remplace le Map in-memory de bo-verify-pin.js qui se réinitialise
-- à chaque cold start Vercel. RLS activé sans policy → accès service_role seul.
CREATE TABLE IF NOT EXISTS bo_rate_limits (
  ip       text PRIMARY KEY,
  attempts integer DEFAULT 1,
  reset_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
ALTER TABLE bo_rate_limits ENABLE ROW LEVEL SECURITY;

-- ── Brouillons de réservation abandonnés ─────────────────────────────────────
-- Sauvegardés au début du tunnel de paiement, supprimés après succès.
-- Le cron cron-abandon.js envoie push + email après 30 min si notified_at IS NULL.
CREATE TABLE IF NOT EXISTS booking_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  prestataire_name text,
  metier           text,
  date             text,
  ville            text,
  montant          numeric,
  mission_id       uuid,
  created_at       timestamptz DEFAULT now(),
  notified_at      timestamptz,
  UNIQUE(client_id)
);
ALTER TABLE booking_drafts ENABLE ROW LEVEL SECURITY;
-- Accès service_role uniquement (cron + endpoint API)
