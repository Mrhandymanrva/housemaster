-- =====================================================================
-- 014_isn_users.sql — a local copy of the ISN user list.
--
-- GET /users returns stubs: id, show, modified. The names, emails and the
-- inspector flag only come from GET /user/{id}, one call each. On this account
-- that is 250 calls, which is fine occasionally and absurd on every page load.
--
-- So the roster is fetched deliberately and read from here. Like isn_orders,
-- this is a cache and not a second source of truth: ISN wins on every field.
-- `modified` is what lets a later refresh skip everyone who has not changed.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS isn_users (
  isn_user_id   text PRIMARY KEY,
  display_name  text,
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  is_inspector  boolean NOT NULL DEFAULT false,
  is_owner      boolean NOT NULL DEFAULT false,
  office        text,
  visible       boolean NOT NULL DEFAULT true,
  isn_modified  timestamptz,
  detail_pulled_at timestamptz,
  raw           jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS isn_users_inspectors ON isn_users (is_inspector) WHERE visible;
CREATE INDEX IF NOT EXISTS isn_users_email ON isn_users (lower(email));

COMMENT ON COLUMN isn_users.detail_pulled_at IS
  'When /user/{id} was last read. Null means only the stub is known.';

COMMIT;
