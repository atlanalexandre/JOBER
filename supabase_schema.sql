-- ============================================================
-- JOBER APP — Schéma Supabase complet
-- Coller dans : Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── PROFILES (tous les utilisateurs) ──────────────────────────
CREATE TABLE profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role      TEXT CHECK(role IN ('client','prestataire')) NOT NULL,
  prenom    TEXT,
  nom       TEXT,
  tel       TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture propre profil" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Mise à jour propre profil" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Insertion propre profil" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ── PRESTATAIRES ──────────────────────────────────────────────
CREATE TABLE prestataires (
  id          UUID PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
  siret       TEXT,
  siren       TEXT,
  activite    TEXT,
  rue         TEXT,
  ville       TEXT,
  cp          TEXT,
  zone_km     INTEGER DEFAULT 20,
  bio         TEXT,
  photo_url   TEXT,
  abonnement  TEXT DEFAULT 'free' CHECK(abonnement IN ('free','premium','elite')),
  available   BOOLEAN DEFAULT true,
  note_moy    NUMERIC DEFAULT 4.8,
  nb_missions INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE prestataires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture tous prestataires" ON prestataires FOR SELECT USING (true);
CREATE POLICY "Modif propre prestataire" ON prestataires FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Insert propre prestataire" ON prestataires FOR INSERT WITH CHECK (auth.uid() = id);

-- ── MÉTIERS ───────────────────────────────────────────────────
CREATE TABLE metiers (
  id              BIGSERIAL PRIMARY KEY,
  prestataire_id  UUID REFERENCES prestataires ON DELETE CASCADE,
  sector          TEXT NOT NULL,
  job_title       TEXT NOT NULL,
  niveau          TEXT DEFAULT 'Confirmé',
  tarif_net       NUMERIC DEFAULT 12,
  certifs         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE metiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture tous métiers" ON metiers FOR SELECT USING (true);
CREATE POLICY "Modif propres métiers" ON metiers FOR ALL USING (auth.uid() = prestataire_id);

-- ── DISPONIBILITÉS ────────────────────────────────────────────
CREATE TABLE disponibilites (
  id              BIGSERIAL PRIMARY KEY,
  prestataire_id  UUID REFERENCES prestataires ON DELETE CASCADE,
  jour            TEXT NOT NULL,
  creneau         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(prestataire_id, jour, creneau)
);
ALTER TABLE disponibilites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture toutes dispos" ON disponibilites FOR SELECT USING (true);
CREATE POLICY "Modif propres dispos" ON disponibilites FOR ALL USING (auth.uid() = prestataire_id);

-- ── DOCUMENTS ─────────────────────────────────────────────────
CREATE TABLE documents (
  id              BIGSERIAL PRIMARY KEY,
  prestataire_id  UUID REFERENCES prestataires ON DELETE CASCADE,
  type            TEXT NOT NULL,
  storage_path    TEXT,
  verified        BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture propres docs" ON documents FOR SELECT USING (auth.uid() = prestataire_id);
CREATE POLICY "Modif propres docs" ON documents FOR ALL USING (auth.uid() = prestataire_id);
-- Admins peuvent voir tous les docs (via service_role depuis backoffice)

-- ── MISSIONS ──────────────────────────────────────────────────
CREATE TABLE missions (
  id          BIGSERIAL PRIMARY KEY,
  client_id   UUID REFERENCES profiles ON DELETE CASCADE,
  sector      TEXT NOT NULL,
  metier      TEXT,
  date        DATE,
  hours       INTEGER DEFAULT 8,
  ville       TEXT,
  description TEXT,
  status      TEXT DEFAULT 'broadcast' CHECK(status IN ('broadcast','confirmed','completed','cancelled')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Client voit ses missions" ON missions FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Client crée missions" ON missions FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "Client modifie missions" ON missions FOR UPDATE USING (auth.uid() = client_id);
-- Prestataires peuvent voir les missions qui leur sont diffusées (via mission_responses)
CREATE POLICY "Prestataires voient missions broadcast" ON missions FOR SELECT
  USING (EXISTS (SELECT 1 FROM mission_responses WHERE mission_id = missions.id AND prestataire_id = auth.uid()));

-- ── RÉPONSES AUX MISSIONS ─────────────────────────────────────
CREATE TABLE mission_responses (
  id              BIGSERIAL PRIMARY KEY,
  mission_id      BIGINT REFERENCES missions ON DELETE CASCADE,
  prestataire_id  UUID REFERENCES prestataires ON DELETE CASCADE,
  accepted        BOOLEAN NOT NULL,
  responded_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mission_id, prestataire_id)
);
ALTER TABLE mission_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Client voit réponses ses missions" ON mission_responses FOR SELECT
  USING (EXISTS (SELECT 1 FROM missions WHERE id = mission_id AND client_id = auth.uid()));
CREATE POLICY "Prestataire répond" ON mission_responses FOR INSERT WITH CHECK (auth.uid() = prestataire_id);
CREATE POLICY "Prestataire voit ses réponses" ON mission_responses FOR SELECT USING (auth.uid() = prestataire_id);

-- ── BOOKINGS ──────────────────────────────────────────────────
CREATE TABLE bookings (
  id                    BIGSERIAL PRIMARY KEY,
  mission_id            BIGINT REFERENCES missions,
  client_id             UUID REFERENCES profiles ON DELETE CASCADE,
  prestataire_id        UUID REFERENCES prestataires ON DELETE CASCADE,
  amount                NUMERIC NOT NULL,
  hours                 INTEGER NOT NULL,
  status                TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','confirmed','completed','cancelled')),
  stripe_payment_intent TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Client voit ses bookings" ON bookings FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Client crée booking" ON bookings FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "Prestataire voit ses bookings" ON bookings FOR SELECT USING (auth.uid() = prestataire_id);

-- ── ÉVALUATIONS ───────────────────────────────────────────────
CREATE TABLE ratings (
  id              BIGSERIAL PRIMARY KEY,
  booking_id      BIGINT REFERENCES bookings ON DELETE CASCADE,
  client_id       UUID REFERENCES profiles,
  prestataire_id  UUID REFERENCES prestataires,
  note            NUMERIC CHECK(note BETWEEN 1 AND 5),
  commentaire     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id)
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture toutes notes" ON ratings FOR SELECT USING (true);
CREATE POLICY "Client note" ON ratings FOR INSERT WITH CHECK (auth.uid() = client_id);

-- ── ABONNEMENTS PRESTATAIRES ──────────────────────────────────
CREATE TABLE abonnements (
  id              BIGSERIAL PRIMARY KEY,
  prestataire_id  UUID REFERENCES prestataires ON DELETE CASCADE UNIQUE,
  plan            TEXT DEFAULT 'free' CHECK(plan IN ('free','premium','elite')),
  stripe_sub_id   TEXT,
  renew_date      DATE,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE abonnements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prestataire voit son abo" ON abonnements FOR SELECT USING (auth.uid() = prestataire_id);
CREATE POLICY "Insert propre abo" ON abonnements FOR INSERT WITH CHECK (auth.uid() = prestataire_id);
CREATE POLICY "Update propre abo" ON abonnements FOR UPDATE USING (auth.uid() = prestataire_id);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES profiles ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  data        JSONB,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture propres notifs" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Marquer lu" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- ── FONCTION : créer profil auto à l'inscription ──────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, role, prenom, nom)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'nom', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── ENABLE REALTIME sur tables clés ───────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE mission_responses;
ALTER PUBLICATION supabase_realtime ADD TABLE missions;
