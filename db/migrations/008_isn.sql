-- =====================================================================
-- 008_isn.sql
--
-- The link to Inspection Support Network.
--
-- ISN owns the job: who booked it, what address, what services, what fee.
-- This system owns what happens to the radon equipment. The two meet at
-- the order id, and the arrow points one way — we read orders from ISN
-- and never write an address, a client or a fee back into it.
--
-- ISN's change feed is "footprints": stubs pointing at upcoming orders
-- for the authenticating user, which the consumer must DELETE once it has
-- them. That makes the read destructive, so nothing is deleted until the
-- order is committed here. If this job dies mid-run the footprint is still
-- waiting on the next pass.
--
-- Because footprints belong to the logged-in user, this integration wants
-- its own ISN user with its own access keys. Sharing a person's login means
-- consuming notifications that another tool — or that person — needed.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Connection settings. No secret ever lands in this table: the access key
-- and secret live in the environment, and this row records only which
-- account they belong to and how the last run went.
-- ---------------------------------------------------------------------
CREATE TABLE isn_connection (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key        text NOT NULL,
  service_domain     text NOT NULL DEFAULT 'inspectionsupport.net',
  rest_url           text,             -- domain + company key + /rest, cached after discovery
  credential_env_var text NOT NULL DEFAULT 'ISN_ACCESS_KEY',
  integration_user   text,             -- the dedicated ISN user, for the audit trail
  enabled            boolean NOT NULL DEFAULT false,
  pull_window_days   int NOT NULL DEFAULT 14,
  auto_create_sets   boolean NOT NULL DEFAULT true,
  radon_service_match text[] NOT NULL DEFAULT
    ARRAY['radon','radon test','radon measurement','radon testing'],
  last_sync_at       timestamptz,
  last_sync_status   text,
  last_sync_error    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX isn_connection_one ON isn_connection ((true));

COMMENT ON COLUMN isn_connection.credential_env_var IS
  'Name of the environment variable holding the ISN secret access key. Never the key itself.';

INSERT INTO isn_connection (company_key, integration_user, enabled)
VALUES ('housemaster-richmond', 'ops-integration', false);

-- ---------------------------------------------------------------------
-- A local copy of the orders we care about. This is a cache, not a
-- second source of truth: ISN wins on every field, always.
-- ---------------------------------------------------------------------
CREATE TABLE isn_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isn_order_id       text NOT NULL UNIQUE,
  order_number       text,
  order_url          text,

  scheduled_start    timestamptz,
  scheduled_end      timestamptz,
  inspector_isn_id   text,
  inspector_name     text,
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,

  property_address   text,
  property_city      text,
  property_state     text,
  property_zip       text,
  square_feet        int,
  year_built         int,
  foundation_type    text,

  client_name        text,
  client_phone       text,
  client_email       text,
  agent_name         text,
  agent_email        text,

  services           jsonb NOT NULL DEFAULT '[]',   -- as ISN lists them
  has_radon          boolean NOT NULL DEFAULT false,
  radon_fee          numeric,
  order_status       text,

  raw                jsonb,          -- the untouched payload, for when a field turns out to matter
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_pulled_at     timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON isn_orders (scheduled_start);
CREATE INDEX ON isn_orders (employee_id, scheduled_start);
CREATE INDEX ON isn_orders (has_radon) WHERE has_radon;

CREATE TRIGGER trg_touch_isn_orders BEFORE UPDATE ON isn_orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ISN user ids so a pulled order lands on the right person's phone
ALTER TABLE employees ADD COLUMN IF NOT EXISTS isn_user_id text;
CREATE INDEX IF NOT EXISTS employees_isn_user ON employees (isn_user_id);

-- ---------------------------------------------------------------------
-- Every run, whether or not anything changed. When a set goes missing
-- this is the first place to look.
-- ---------------------------------------------------------------------
CREATE TABLE isn_sync_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  trigger_source    text NOT NULL DEFAULT 'schedule'
                      CHECK (trigger_source IN ('schedule','manual','webhook','backfill')),
  footprints_seen   int NOT NULL DEFAULT 0,
  orders_upserted   int NOT NULL DEFAULT 0,
  sets_created      int NOT NULL DEFAULT 0,
  footprints_deleted int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','ok','partial','failed')),
  error             text,
  detail            jsonb
);
CREATE INDEX ON isn_sync_log (started_at DESC);

-- ---------------------------------------------------------------------
-- Radon sets learn where they came from.
-- ---------------------------------------------------------------------
ALTER TABLE radon_tests
  ADD COLUMN IF NOT EXISTS isn_order_uuid uuid REFERENCES isn_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prefilled_from_isn boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS radon_tests_isn_order ON radon_tests (isn_order_uuid);
-- one draft set per order, so a re-pull cannot duplicate the job
CREATE UNIQUE INDEX IF NOT EXISTS radon_tests_one_per_order
  ON radon_tests (isn_order_uuid) WHERE isn_order_uuid IS NOT NULL AND status <> 'Voided';

-- ---------------------------------------------------------------------
-- Turn a pulled order into a scheduled set. Idempotent: running it twice
-- updates the draft rather than creating a second one, and it refuses to
-- touch a set a tech has already placed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION isn_draft_radon_set(p_order uuid) RETURNS uuid AS $$
DECLARE o isn_orders%ROWTYPE;
        existing radon_tests%ROWTYPE;
        new_id uuid;
BEGIN
  SELECT * INTO o FROM isn_orders WHERE id = p_order;
  IF NOT FOUND OR NOT o.has_radon THEN RETURN NULL; END IF;

  SELECT * INTO existing FROM radon_tests
   WHERE isn_order_uuid = o.id AND status <> 'Voided' LIMIT 1;

  IF FOUND THEN
    -- Only a set nobody has touched yet gets refreshed from ISN.
    IF existing.status = 'Scheduled' THEN
      UPDATE radon_tests SET
        property_address = o.property_address, property_city = o.property_city,
        property_state = COALESCE(o.property_state, 'VA'), property_zip = o.property_zip,
        foundation_type = COALESCE(o.foundation_type, foundation_type),
        client_name = o.client_name, client_phone = o.client_phone,
        client_email = o.client_email, agent_name = o.agent_name,
        inspector_id = COALESCE(o.employee_id, inspector_id),
        scheduled_for = o.scheduled_start, isn_order_id = o.isn_order_id,
        isn_order_url = o.order_url
      WHERE id = existing.id;
    END IF;
    RETURN existing.id;
  END IF;

  INSERT INTO radon_tests
    (property_address, property_city, property_state, property_zip, foundation_type,
     client_name, client_phone, client_email, agent_name,
     inspector_id, scheduled_for, isn_order_id, isn_order_url, isn_order_uuid,
     prefilled_from_isn, source, status, result_status)
  VALUES
    (o.property_address, o.property_city, COALESCE(o.property_state,'VA'), o.property_zip,
     o.foundation_type, o.client_name, o.client_phone, o.client_email, o.agent_name,
     o.employee_id, o.scheduled_start, o.isn_order_id, o.order_url, o.id,
     true, 'office', 'Scheduled', 'Pending')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- What a phone asks for when it syncs: my jobs, already filled in, each
-- carrying the QA answer for the monitor most likely to be used.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW field_todays_radon_jobs AS
SELECT t.id            AS radon_test_id,
       t.test_number,
       t.status,
       t.scheduled_for,
       t.property_address, t.property_city, t.property_state, t.property_zip,
       t.foundation_type,
       t.client_name, t.client_phone, t.agent_name,
       t.isn_order_id, t.isn_order_url,
       t.inspector_id,
       e.full_name     AS inspector_name,
       o.square_feet, o.year_built, o.radon_fee,
       o.scheduled_start AS inspection_start
  FROM radon_tests t
  LEFT JOIN employees e ON e.id = t.inspector_id
  LEFT JOIN isn_orders o ON o.id = t.isn_order_uuid
 WHERE t.status IN ('Scheduled','Deployed')
   AND (t.scheduled_for IS NULL OR t.scheduled_for < now() + interval '3 days');

-- ---------------------------------------------------------------------
-- An order with radon on it and no set is money booked and not delivered.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW isn_radon_orders_without_sets AS
SELECT o.*
  FROM isn_orders o
 WHERE o.has_radon
   AND o.scheduled_start < now()
   AND NOT EXISTS (SELECT 1 FROM radon_tests t
                    WHERE t.isn_order_uuid = o.id AND t.status <> 'Voided')
 ORDER BY o.scheduled_start DESC;

COMMIT;
