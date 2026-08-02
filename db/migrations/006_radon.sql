-- =====================================================================
-- 006_radon.sql
--
-- Radon sets, results, chain of custody, and the QA duplicate rule.
--
-- A "set" is one test at one property. It has one or more detectors on
-- it: a Primary, and — every Nth set — a Duplicate placed alongside it.
-- The duplicate exists to prove the equipment is repeatable, so the two
-- readings are compared as a relative percent difference and flagged
-- when they disagree by more than the tolerance.
--
-- The rule is enforced in three places on purpose: the field app shows
-- it, the API rejects a deployment without it, and a database trigger
-- refuses to let a set move to Deployed without the duplicate row. The
-- last one is the only defense that cannot be routed around.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- The QA policy itself. One active row. Change it here, not in code.
-- ---------------------------------------------------------------------
CREATE TABLE radon_qa_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active                 boolean NOT NULL DEFAULT true,
  scope                  text NOT NULL DEFAULT 'device'
                           CHECK (scope IN ('device','inspector','company')),
  duplicate_interval     int NOT NULL DEFAULT 10 CHECK (duplicate_interval > 1),
  blank_interval         int CHECK (blank_interval IS NULL OR blank_interval > 1),
  spike_interval_months  int,
  rpd_tolerance_pct      numeric NOT NULL DEFAULT 36,
  action_level_pci       numeric NOT NULL DEFAULT 4.0,
  min_hours_deployed     int NOT NULL DEFAULT 48,
  closed_house_hours     int NOT NULL DEFAULT 12,
  enforce_in_field       boolean NOT NULL DEFAULT true,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX radon_qa_rules_one_active ON radon_qa_rules (active) WHERE active;

INSERT INTO radon_qa_rules (scope, duplicate_interval, blank_interval, notes)
VALUES ('device', 10, 10,
        'Every 10th set on a given device is deployed as a duplicate pair. '
        || 'Change scope to inspector or company to spread duplicates differently.');

-- ---------------------------------------------------------------------
-- The set: one radon test at one property.
-- ---------------------------------------------------------------------
CREATE SEQUENCE radon_test_seq START 1;

CREATE TABLE radon_tests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_number           text NOT NULL UNIQUE
                          DEFAULT 'RT-' || to_char(now(),'YYYY') || '-'
                                || lpad(nextval('radon_test_seq')::text, 5, '0'),

  -- where the job came from. ISN is the system of record for the order.
  isn_order_id          text,
  isn_order_url         text,

  property_address      text NOT NULL,
  property_city         text,
  property_state        text NOT NULL DEFAULT 'VA',
  property_zip          text,
  foundation_type       text,
  client_name           text,
  client_phone          text,
  client_email          text,
  agent_name            text,

  test_method           text NOT NULL DEFAULT 'Continuous Monitor'
                          CHECK (test_method IN ('Continuous Monitor','Charcoal Canister',
                                                 'Alpha Track','Liquid Scintillation','Other')),
  lab_vendor_id         uuid REFERENCES vendors(id) ON DELETE SET NULL,
  lab_report_number     text,

  inspector_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  retrieved_by_id       uuid REFERENCES employees(id) ON DELETE SET NULL,

  status                text NOT NULL DEFAULT 'Scheduled'
                          CHECK (status IN ('Scheduled','Deployed','Retrieved','At Lab',
                                            'Reported','Voided')),

  scheduled_for         timestamptz,
  deployed_at           timestamptz,
  retrieved_at          timestamptz,
  hours_deployed        numeric,          -- filled on retrieval

  closed_house_start    timestamptz,
  closed_house_confirmed boolean NOT NULL DEFAULT false,
  conditions_notes      text,
  tamper_evident        boolean,

  -- QA. Stamped when the set is created; never guessed at read time.
  qa_sequence_number    int,              -- this device's Nth set
  qa_duplicate_required boolean NOT NULL DEFAULT false,
  qa_reason             text,

  result_pci_l          numeric,
  duplicate_pci_l       numeric,
  rpd_pct               numeric,          -- computed by trigger
  rpd_within_tolerance  boolean,
  result_status         text CHECK (result_status IN
                          ('Below Action Level','At or Above Action Level','Invalid','Pending')),
  mitigation_recommended boolean,
  report_delivered_at   timestamptz,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON radon_tests (status, deployed_at);
CREATE INDEX ON radon_tests (inspector_id);
CREATE INDEX ON radon_tests (isn_order_id);
CREATE INDEX ON radon_tests USING gin (property_address gin_trgm_ops);

CREATE TRIGGER trg_touch_radon_tests BEFORE UPDATE ON radon_tests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- One row per detector on the set. The duplicate is a second row.
-- ---------------------------------------------------------------------
CREATE TABLE radon_deployments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radon_test_id      uuid NOT NULL REFERENCES radon_tests(id) ON DELETE CASCADE,
  role               text NOT NULL DEFAULT 'Primary'
                       CHECK (role IN ('Primary','Duplicate','Blank','Spike')),

  -- a continuous monitor is an equipment record; a canister is a lot number
  equipment_id       uuid REFERENCES equipment(id) ON DELETE SET NULL,
  device_serial      text,
  canister_lot       text,
  supply_id          uuid REFERENCES supplies(id) ON DELETE SET NULL,

  placement_floor    text,
  placement_room     text,
  placement_notes    text,
  distance_inches    numeric,   -- duplicate spacing from the primary

  start_at           timestamptz,
  end_at             timestamptz,
  hours_exposed      numeric,

  tamper_seal_number text,
  seal_intact        boolean,

  result_pci_l       numeric,
  voided             boolean NOT NULL DEFAULT false,
  void_reason        text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON radon_deployments (radon_test_id);
CREATE INDEX ON radon_deployments (equipment_id, role) WHERE NOT voided;
-- a set gets at most one of each QA role
CREATE UNIQUE INDEX radon_deployments_one_per_role
  ON radon_deployments (radon_test_id, role) WHERE role <> 'Primary' AND NOT voided;

CREATE TRIGGER trg_touch_radon_deployments BEFORE UPDATE ON radon_deployments
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- Chain of custody. Append-only in practice: every hand-off gets a row.
-- ---------------------------------------------------------------------
CREATE TABLE radon_custody_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radon_test_id  uuid NOT NULL REFERENCES radon_tests(id) ON DELETE CASCADE,
  deployment_id  uuid REFERENCES radon_deployments(id) ON DELETE SET NULL,
  event_type     text NOT NULL CHECK (event_type IN (
                   'Placed','Sealed','Client briefed','Checked','Retrieved',
                   'Transferred','Shipped to lab','Received by lab','Result received',
                   'Reported to client','Voided')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  employee_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  party_name     text,          -- the other side of a hand-off
  gps_lat        numeric,
  gps_lng        numeric,
  signature_ref  text,          -- attachment key, never the image itself
  photo_ref      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON radon_custody_events (radon_test_id, occurred_at);

-- =====================================================================
-- The QA rule, as functions
-- =====================================================================

-- How many completed sets this device (or inspector, or the company) has
-- run, and therefore whether the next one owes a duplicate.
CREATE OR REPLACE FUNCTION radon_qa_next(p_equipment_id uuid,
                                         p_inspector_id uuid DEFAULT NULL,
                                         p_exclude_test uuid DEFAULT NULL)
RETURNS TABLE (
  sequence_number    int,
  duplicate_required boolean,
  interval_n         int,
  scope              text,
  sets_since_last    int,
  reason             text
) AS $$
DECLARE r radon_qa_rules%ROWTYPE;
        prior int;
        seq   int;
        since int;
BEGIN
  SELECT * INTO r FROM radon_qa_rules WHERE active LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::int, false, NULL::int, NULL::text, NULL::int, 'No QA rule configured'::text;
    RETURN;
  END IF;

  SELECT count(*)::int INTO prior
    FROM radon_deployments d
    JOIN radon_tests t ON t.id = d.radon_test_id
   WHERE d.role = 'Primary' AND NOT d.voided AND t.status <> 'Voided'
     AND (p_exclude_test IS NULL OR t.id <> p_exclude_test)
     AND CASE r.scope
           WHEN 'device'    THEN d.equipment_id IS NOT DISTINCT FROM p_equipment_id
           WHEN 'inspector' THEN t.inspector_id IS NOT DISTINCT FROM p_inspector_id
           ELSE true
         END;

  seq := prior + 1;

  SELECT count(*)::int INTO since
    FROM radon_deployments d
    JOIN radon_tests t ON t.id = d.radon_test_id
   WHERE d.role = 'Primary' AND NOT d.voided AND t.status <> 'Voided'
     AND (p_exclude_test IS NULL OR t.id <> p_exclude_test)
     AND CASE r.scope
           WHEN 'device'    THEN d.equipment_id IS NOT DISTINCT FROM p_equipment_id
           WHEN 'inspector' THEN t.inspector_id IS NOT DISTINCT FROM p_inspector_id
           ELSE true
         END
     AND t.deployed_at > COALESCE((
           SELECT max(t2.deployed_at)
             FROM radon_deployments d2
             JOIN radon_tests t2 ON t2.id = d2.radon_test_id
            WHERE d2.role = 'Duplicate' AND NOT d2.voided
              AND CASE r.scope
                    WHEN 'device'    THEN d2.equipment_id IS NOT DISTINCT FROM p_equipment_id
                    WHEN 'inspector' THEN t2.inspector_id IS NOT DISTINCT FROM p_inspector_id
                    ELSE true
                  END), '-infinity'::timestamptz);

  RETURN QUERY SELECT
    seq,
    (seq % r.duplicate_interval) = 0,
    r.duplicate_interval,
    r.scope,
    since,
    CASE WHEN (seq % r.duplicate_interval) = 0
      THEN format('Set number %s on this %s — every %sth set is a duplicate pair.',
                  seq, r.scope, r.duplicate_interval)
      ELSE format('Set number %s. Duplicate due on set %s.',
                  seq, seq + (r.duplicate_interval - (seq % r.duplicate_interval)))
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- Stamp the QA decision onto the set the moment it is created.
CREATE OR REPLACE FUNCTION radon_stamp_qa() RETURNS trigger AS $$
DECLARE q record;
BEGIN
  IF NEW.qa_sequence_number IS NULL THEN
    SELECT * INTO q FROM radon_qa_next(
      (SELECT equipment_id FROM radon_deployments
        WHERE radon_test_id = NEW.id AND role = 'Primary' LIMIT 1),
      NEW.inspector_id);
    IF q.sequence_number IS NOT NULL THEN
      NEW.qa_sequence_number    := q.sequence_number;
      NEW.qa_duplicate_required := q.duplicate_required;
      NEW.qa_reason             := q.reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The backstop: a set that owes a duplicate cannot reach Deployed
-- without one. No API path, import, or manual UPDATE gets around this.
CREATE OR REPLACE FUNCTION radon_enforce_duplicate() RETURNS trigger AS $$
DECLARE has_dup boolean;
        enforce boolean;
        qa      record;
BEGIN
  IF NEW.status = 'Deployed' AND COALESCE(OLD.status,'') <> 'Deployed' THEN
    -- At insert time the devices did not exist yet, so the sequence number is
    -- settled here, where the primary is on the record. Excluding this set
    -- keeps the number identical to the one the phone was shown.
    SELECT * INTO qa FROM radon_qa_next(
      (SELECT equipment_id FROM radon_deployments
        WHERE radon_test_id = NEW.id AND role = 'Primary' AND NOT voided LIMIT 1),
      NEW.inspector_id, NEW.id);
    IF qa.sequence_number IS NOT NULL THEN
      NEW.qa_sequence_number    := qa.sequence_number;
      NEW.qa_duplicate_required := qa.duplicate_required;
      NEW.qa_reason             := qa.reason;
    END IF;
  END IF;

  IF NEW.status = 'Deployed' AND COALESCE(OLD.status,'') <> 'Deployed'
     AND NEW.qa_duplicate_required THEN
    SELECT COALESCE(enforce_in_field, true) INTO enforce FROM radon_qa_rules WHERE active LIMIT 1;
    IF enforce THEN
      SELECT EXISTS (SELECT 1 FROM radon_deployments
                      WHERE radon_test_id = NEW.id AND role = 'Duplicate' AND NOT voided)
        INTO has_dup;
      IF NOT has_dup THEN
        RAISE EXCEPTION
          'Set % is QA set number % — it needs a second device deployed as a duplicate before it can go out.',
          NEW.test_number, NEW.qa_sequence_number
          USING ERRCODE = 'check_violation',
                HINT = 'Place a second monitor beside the first and record it as the Duplicate.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Precision check between the primary and its duplicate.
CREATE OR REPLACE FUNCTION radon_score_rpd() RETURNS trigger AS $$
DECLARE tol numeric;
        avg_v numeric;
BEGIN
  IF NEW.result_pci_l IS NOT NULL AND NEW.duplicate_pci_l IS NOT NULL THEN
    avg_v := (NEW.result_pci_l + NEW.duplicate_pci_l) / 2.0;
    IF avg_v > 0 THEN
      NEW.rpd_pct := round(abs(NEW.result_pci_l - NEW.duplicate_pci_l) / avg_v * 100, 1);
      SELECT rpd_tolerance_pct INTO tol FROM radon_qa_rules WHERE active LIMIT 1;
      NEW.rpd_within_tolerance := NEW.rpd_pct <= COALESCE(tol, 36);
    END IF;
  END IF;

  IF NEW.result_pci_l IS NOT NULL AND NEW.result_status IS NULL THEN
    NEW.result_status := CASE
      WHEN NEW.result_pci_l >= (SELECT action_level_pci FROM radon_qa_rules WHERE active LIMIT 1)
        THEN 'At or Above Action Level' ELSE 'Below Action Level' END;
    NEW.mitigation_recommended := NEW.result_status = 'At or Above Action Level';
  END IF;

  IF NEW.retrieved_at IS NOT NULL AND NEW.deployed_at IS NOT NULL THEN
    NEW.hours_deployed := round(EXTRACT(EPOCH FROM (NEW.retrieved_at - NEW.deployed_at)) / 3600.0, 1);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_radon_stamp_qa BEFORE INSERT ON radon_tests
FOR EACH ROW EXECUTE FUNCTION radon_stamp_qa();

CREATE TRIGGER trg_radon_enforce_duplicate BEFORE UPDATE ON radon_tests
FOR EACH ROW EXECUTE FUNCTION radon_enforce_duplicate();

CREATE TRIGGER trg_radon_score BEFORE INSERT OR UPDATE ON radon_tests
FOR EACH ROW EXECUTE FUNCTION radon_score_rpd();

-- =====================================================================
-- Views the desktop reads
-- =====================================================================

-- Sets that are out in the field right now, with the retrieval clock.
CREATE OR REPLACE VIEW radon_open_tests AS
SELECT t.*,
       emp.full_name  AS inspector_name,
       (SELECT count(*) FROM radon_deployments d
         WHERE d.radon_test_id = t.id AND NOT d.voided) AS device_count,
       (SELECT string_agg(COALESCE(e.name, d.canister_lot, d.device_serial), ' + ' ORDER BY d.role)
          FROM radon_deployments d LEFT JOIN equipment e ON e.id = d.equipment_id
         WHERE d.radon_test_id = t.id AND NOT d.voided) AS devices,
       EXISTS (SELECT 1 FROM radon_deployments d
                WHERE d.radon_test_id = t.id AND d.role = 'Duplicate' AND NOT d.voided) AS has_duplicate,
       CASE WHEN t.deployed_at IS NULL THEN NULL
            ELSE round(EXTRACT(EPOCH FROM (now() - t.deployed_at)) / 3600.0) END AS hours_out,
       (SELECT min_hours_deployed FROM radon_qa_rules WHERE active LIMIT 1) AS min_hours,
       t.deployed_at + ((SELECT min_hours_deployed FROM radon_qa_rules WHERE active LIMIT 1)
                        || ' hours')::interval AS retrievable_at
  FROM radon_tests t
  LEFT JOIN employees emp ON emp.id = t.inspector_id
 WHERE t.status IN ('Scheduled','Deployed','Retrieved','At Lab');

-- Where every device stands against the duplicate rule.
CREATE OR REPLACE VIEW radon_qa_status AS
SELECT e.id AS equipment_id,
       e.name,
       e.serial_number,
       emp.full_name AS assigned_to,
       q.sequence_number    AS next_set_number,
       q.duplicate_required AS next_set_needs_duplicate,
       q.interval_n,
       q.sets_since_last,
       q.reason,
       (SELECT max(t.deployed_at)
          FROM radon_deployments d JOIN radon_tests t ON t.id = d.radon_test_id
         WHERE d.equipment_id = e.id AND d.role = 'Duplicate' AND NOT d.voided) AS last_duplicate_at,
       (SELECT count(*) FROM radon_tests t
          WHERE t.rpd_within_tolerance = false
            AND EXISTS (SELECT 1 FROM radon_deployments d
                         WHERE d.radon_test_id = t.id AND d.equipment_id = e.id)) AS rpd_failures
  FROM equipment e
  LEFT JOIN employees emp ON emp.id = e.assigned_employee_id
  CROSS JOIN LATERAL radon_qa_next(e.id, NULL) q
 WHERE e.asset_category = 'Radon' AND e.status <> 'Retired';

-- ---------------------------------------------------------------------
-- Radon dates belong on the same compliance calendar as everything else.
-- Kept as its own sweep so 002 stays untouched.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_compliance_radon() RETURNS int AS $$
DECLARE n int := 0;
BEGIN
  INSERT INTO compliance_items
    (source_entity, source_id, source_field, category, title, subject, due_date, priority, responsible_id)
  SELECT 'radon_tests', t.id, 'retrieve_by', 'Radon',
         'Pick up radon devices',
         t.property_address || ' · ' || t.test_number,
         (t.deployed_at + ((SELECT min_hours_deployed FROM radon_qa_rules WHERE active LIMIT 1)
                           || ' hours')::interval)::date,
         'Critical', t.inspector_id
    FROM radon_tests t
   WHERE t.status = 'Deployed' AND t.deployed_at IS NOT NULL
  ON CONFLICT (source_entity, source_id, source_field) DO UPDATE
    SET title = EXCLUDED.title, subject = EXCLUDED.subject,
        due_date = EXCLUDED.due_date, responsible_id = EXCLUDED.responsible_id,
        updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;

  -- a set that has come back in is no longer a calendar item
  UPDATE compliance_items c
     SET completed_date = COALESCE(c.completed_date, CURRENT_DATE)
    FROM radon_tests t
   WHERE c.source_entity = 'radon_tests' AND c.source_id = t.id
     AND t.status IN ('Retrieved','At Lab','Reported','Voided');

  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Field app: the radon modules learn about the QA rule
-- =====================================================================
ALTER TABLE field_modules ADD COLUMN IF NOT EXISTS qa_rule text;
COMMENT ON COLUMN field_modules.qa_rule IS
  'When set to radon_duplicate the phone calls /ops/radon/qa-check before the '
  'form opens and blocks submit on a QA set without a second device.';

UPDATE field_modules SET qa_rule = 'radon_duplicate' WHERE key = 'radon_deploy';

-- The extra questions a QA set asks. visible_if keys off the QA check, so
-- on an ordinary set the tech never sees them.
INSERT INTO field_form_fields
  (form_id, key, label, input_type, required, help_text, visible_if, sort_order)
SELECT f.id, v.key, v.label, v.input_type, v.required, v.help_text,
       '{"qa":"duplicate_required"}'::jsonb, v.sort_order
  FROM field_forms f
  JOIN field_modules m ON m.id = f.module_id AND m.key = 'radon_deploy'
  CROSS JOIN (VALUES
    ('duplicate_device', 'Second monitor (duplicate)', 'ref_equipment', true,
     'This is a QA set. Place a second monitor beside the first one.', 210),
    ('duplicate_distance', 'Inches between the two', 'number', true,
     'Keep them close — within about four inches, same height, same room.', 220),
    ('duplicate_photo', 'Photo of both monitors together', 'photo', true,
     'One shot showing both units in place.', 230),
    ('duplicate_seal', 'Second tamper seal number', 'text', false, NULL, 240)
  ) AS v(key, label, input_type, required, help_text, sort_order)
 WHERE f.active
   AND NOT EXISTS (SELECT 1 FROM field_form_fields x WHERE x.form_id = f.id AND x.key = v.key);

-- Retrieval needs to collect the duplicate reading too.
INSERT INTO field_form_fields
  (form_id, key, label, input_type, required, help_text, visible_if, sort_order)
SELECT f.id, 'duplicate_pci', 'Duplicate reading (pCi/L)', 'number', true,
       'The second monitor from this set.', '{"qa":"duplicate_required"}'::jsonb, 210
  FROM field_forms f
  JOIN field_modules m ON m.id = f.module_id AND m.key = 'radon_retrieve'
 WHERE f.active
   AND NOT EXISTS (SELECT 1 FROM field_form_fields x WHERE x.form_id = f.id AND x.key = 'duplicate_pci');

-- ---------------------------------------------------------------------
-- Lookup values used by the radon screens
-- ---------------------------------------------------------------------
INSERT INTO lookup_lists (key, label, description) VALUES
  ('radon_test_method',   'Radon test method',   'How the measurement is taken'),
  ('radon_test_status',   'Radon set status',    'Where a set is in its lifecycle'),
  ('radon_placement_floor','Placement floor',    'Lowest livable level is the usual answer'),
  ('radon_foundation',    'Foundation type',     NULL),
  ('radon_device_role',   'Device role',         'Primary, duplicate, blank or spike'),
  ('radon_custody_event', 'Custody event',       'Steps in the chain of custody')
ON CONFLICT (key) DO NOTHING;

INSERT INTO lookup_values (list_key, value, label, sort_order) VALUES
  ('radon_test_method','Continuous Monitor','Continuous monitor',10),
  ('radon_test_method','Charcoal Canister','Charcoal canister',20),
  ('radon_test_method','Alpha Track','Alpha track',30),
  ('radon_test_method','Liquid Scintillation','Liquid scintillation',40),
  ('radon_test_status','Scheduled','Scheduled',10),
  ('radon_test_status','Deployed','Out in the field',20),
  ('radon_test_status','Retrieved','Picked up',30),
  ('radon_test_status','At Lab','At the lab',40),
  ('radon_test_status','Reported','Reported to client',50),
  ('radon_test_status','Voided','Voided',60),
  ('radon_placement_floor','Basement','Basement',10),
  ('radon_placement_floor','Crawlspace','Crawlspace',20),
  ('radon_placement_floor','First Floor','First floor',30),
  ('radon_placement_floor','Second Floor','Second floor',40),
  ('radon_foundation','Basement','Basement',10),
  ('radon_foundation','Slab','Slab on grade',20),
  ('radon_foundation','Crawlspace','Crawlspace',30),
  ('radon_foundation','Mixed','Mixed',40),
  ('radon_device_role','Primary','Primary',10),
  ('radon_device_role','Duplicate','Duplicate (QA)',20),
  ('radon_device_role','Blank','Blank (QA)',30),
  ('radon_device_role','Spike','Spike (QA)',40),
  ('radon_custody_event','Placed','Placed',10),
  ('radon_custody_event','Sealed','Sealed',20),
  ('radon_custody_event','Client briefed','Client briefed',30),
  ('radon_custody_event','Checked','Checked mid-test',40),
  ('radon_custody_event','Retrieved','Retrieved',50),
  ('radon_custody_event','Transferred','Handed off',60),
  ('radon_custody_event','Shipped to lab','Shipped to lab',70),
  ('radon_custody_event','Received by lab','Received by lab',80),
  ('radon_custody_event','Result received','Result received',90),
  ('radon_custody_event','Reported to client','Reported to client',100),
  ('radon_custody_event','Voided','Voided',110)
ON CONFLICT (list_key, value) DO NOTHING;

COMMIT;
