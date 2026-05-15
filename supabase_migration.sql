-- ═══════════════════════════════════════════════════════
-- ALANE — Migration Supabase
-- À exécuter dans Supabase > SQL Editor
-- ═══════════════════════════════════════════════════════

-- 1. Table missions — colonnes manquantes
ALTER TABLE missions ADD COLUMN IF NOT EXISTS titre TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS nb_heures INTEGER;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS tarif_horaire DECIMAL(10,2);
ALTER TABLE missions ADD COLUMN IF NOT EXISTS prestataire_id UUID REFERENCES auth.users(id);
ALTER TABLE missions ADD COLUMN IF NOT EXISTS validation_client BOOLEAN DEFAULT FALSE;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS validation_prestataire BOOLEAN DEFAULT FALSE;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_rating INTEGER;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS presta_rating INTEGER;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_comment TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS presta_comment TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_debut TIMESTAMPTZ;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_fin TIMESTAMPTZ;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_nom TEXT;

-- 2. Table profiles — colonnes cashback
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cashback_balance DECIMAL(10,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS missions_completed_month INTEGER DEFAULT 0;

-- 3. Table ratings
CREATE TABLE IF NOT EXISTS ratings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id            BIGINT REFERENCES missions(id) ON DELETE SET NULL,
  reviewer_id           UUID REFERENCES auth.users(id),
  reviewee_provider_id  TEXT,
  reviewee_name         TEXT,
  rating                INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment               TEXT,
  tags                  TEXT[],
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings_insert" ON ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = reviewer_id);
CREATE POLICY "ratings_select" ON ratings FOR SELECT TO authenticated USING (true);

-- 4. Table contracts
CREATE TABLE IF NOT EXISTS contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id            BIGINT REFERENCES missions(id) ON DELETE SET NULL,
  contract_number       TEXT UNIQUE NOT NULL,
  client_id             UUID REFERENCES auth.users(id),
  prestataire_id        UUID REFERENCES auth.users(id),
  prestataire_name      TEXT,
  prestataire_role      TEXT,
  nb_heures             INTEGER,
  montant               DECIMAL(10,2),
  client_signed         BOOLEAN DEFAULT FALSE,
  prestataire_signed    BOOLEAN DEFAULT FALSE,
  client_signed_at      TIMESTAMPTZ,
  prestataire_signed_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts_select" ON contracts FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = prestataire_id);
CREATE POLICY "contracts_insert" ON contracts FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);
CREATE POLICY "contracts_update" ON contracts FOR UPDATE TO authenticated USING (auth.uid() = client_id OR auth.uid() = prestataire_id);

-- 5. Table notifications (si elle n'existe pas encore)
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type              TEXT DEFAULT 'system',
  title             TEXT,
  message           TEXT NOT NULL,
  read              BOOLEAN DEFAULT FALSE,
  related_id        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifs_select" ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifs_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notifs_update" ON notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
