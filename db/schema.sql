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
