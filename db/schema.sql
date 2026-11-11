-- Database schema for the clinic booking API.
-- Safe to run more than once (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS slots (
  id        TEXT PRIMARY KEY,
  provider  TEXT NOT NULL,
  start_at  TIMESTAMPTZ NOT NULL,
  end_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id     TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_booking_per_slot
  ON bookings (slot_id)
  WHERE status = 'confirmed';

-- Level 4: remembers each Idempotency-Key and the response it got
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT PRIMARY KEY,
  request_hash     TEXT NOT NULL,
  response_status  INTEGER,
  response_body    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep the stored response as plain text so it's replayed byte-for-byte
-- (JSONB would reorder the fields). Safe to run again.
ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE TEXT;

-- Level 4: fast lookup of one person's bookings in date order
CREATE INDEX IF NOT EXISTS bookings_by_email
  ON bookings (email, created_at, id);

-- Level 5: one row per booking attempt, for rate limiting
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  email         TEXT NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_by_email
  ON rate_limit_attempts (email, attempted_at);
