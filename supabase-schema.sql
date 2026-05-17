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
  type           text,          -- kbis | rib | cni | autre
  storage_path   text NOT NULL, -- chemin dans le bucket "documents"
  verified       boolean DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

-- ── COLONNES manquantes sur profiles ─────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cashback_balance        numeric DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS missions_completed_month integer DEFAULT 0;

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

-- Tout utilisateur connecté peut voir les missions ouvertes
CREATE POLICY "missions_open_read" ON missions
  FOR SELECT USING (status = 'open' OR client_id = auth.uid() OR prestataire_id = auth.uid());

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
DROP POLICY IF EXISTS "visits_insert" ON visits;
CREATE POLICY "visits_insert" ON visits
  FOR INSERT WITH CHECK (true);

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
CREATE POLICY "messages_participants" ON messages
  FOR ALL USING (
    sender_id = auth.uid() OR
    conversation_key LIKE '%' || auth.uid()::text || '%'
  );

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
