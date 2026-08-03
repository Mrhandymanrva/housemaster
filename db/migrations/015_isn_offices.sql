-- =====================================================================
-- 015_isn_offices.sql — which office on this ISN is ours.
--
-- The keys reach an ISN carrying 250 users with names nobody here recognises,
-- because the ISN is shared across offices. Both a user and an order name the
-- office they belong to, so that is the honest filter: not "hide the ones I do
-- not know" but "this branch is mine".
--
-- Nothing is deleted when an office is chosen. Orders and users from elsewhere
-- stay cached and simply stop being shown, so picking the wrong one is a
-- change of mind rather than a recovery job.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS isn_offices (
  isn_office_id text PRIMARY KEY,
  name          text,
  slug          text,
  city          text,
  state         text,
  manager       text,
  visible       boolean NOT NULL DEFAULT true,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE isn_connection
  ADD COLUMN IF NOT EXISTS isn_office_id text;

COMMENT ON COLUMN isn_connection.isn_office_id IS
  'The office on this ISN that belongs to us. Null means every office, which is '
  'right for a single-branch ISN and wrong for a shared one.';

ALTER TABLE isn_users
  ADD COLUMN IF NOT EXISTS office_name text;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS isn_office_id text;

CREATE INDEX IF NOT EXISTS isn_orders_office ON isn_orders (isn_office_id);
CREATE INDEX IF NOT EXISTS isn_users_office ON isn_users (office) WHERE visible;

COMMIT;
