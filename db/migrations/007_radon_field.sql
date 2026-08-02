-- =====================================================================
-- 007_radon_field.sql
--
-- What happens when a phone that was offline turns out to have been wrong.
--
-- The rule so far is absolute: a set that owes a duplicate cannot reach
-- Deployed without one. That is right for anything created with a signal,
-- because the tech is still standing in the house and can fix it.
--
-- It is wrong for a set that comes in from a phone that was underground
-- three hours ago. The house has been tested. Rejecting the upload does
-- not produce a duplicate — it produces a lost record, which is worse
-- than a documented gap.
--
-- So offline arrivals may pass, but only by carrying an explicit exception
-- with a reason, which lands in a review queue in front of the office. The
-- set is never silently accepted and never silently dropped.
-- =====================================================================
BEGIN;

ALTER TABLE radon_tests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'office'
    CHECK (source IN ('office','field_online','field_offline','import')),
  ADD COLUMN IF NOT EXISTS qa_exception boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qa_exception_reason text,
  ADD COLUMN IF NOT EXISTS qa_exception_cleared_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qa_exception_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_exception_resolution text,
  -- what the phone believed at the moment the tech hit send
  ADD COLUMN IF NOT EXISTS device_believed_sequence int,
  ADD COLUMN IF NOT EXISTS device_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

CREATE INDEX IF NOT EXISTS radon_tests_open_exceptions
  ON radon_tests (qa_exception) WHERE qa_exception AND qa_exception_cleared_at IS NULL;

-- An exception needs a reason. A blank one is not an exception, it is a hole.
ALTER TABLE radon_tests DROP CONSTRAINT IF EXISTS radon_tests_exception_needs_reason;
ALTER TABLE radon_tests ADD CONSTRAINT radon_tests_exception_needs_reason
  CHECK (NOT qa_exception OR qa_exception_reason IS NOT NULL);

-- ---------------------------------------------------------------------
-- The trigger, now with exactly one way past it.
-- ---------------------------------------------------------------------
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
        -- A set that was captured with no signal can pass, but only loudly.
        IF NEW.source = 'field_offline' THEN
          NEW.qa_exception := true;
          NEW.qa_exception_reason := COALESCE(
            NEW.qa_exception_reason,
            format('Captured offline. The phone believed this was set %s and did not ask for a '
                || 'duplicate; it was actually set %s. No duplicate was placed.',
                COALESCE(NEW.device_believed_sequence::text, 'unknown'),
                NEW.qa_sequence_number));
        ELSE
          RAISE EXCEPTION
            'Set % is QA set number % — it needs a second device deployed as a duplicate before it can go out.',
            NEW.test_number, NEW.qa_sequence_number
            USING ERRCODE = 'check_violation',
                  HINT = 'Place a second monitor beside the first and record it as the Duplicate.';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- An extra duplicate is never wasted. If a cautious phone placed a pair
-- that was not owed, the cycle still resets — radon_qa_next() already
-- counts from the last duplicate, so this needs no extra bookkeeping.
-- What it does need is a note, so the office knows why it happened.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION radon_note_extra_duplicate() RETURNS trigger AS $$
DECLARE t radon_tests%ROWTYPE;
BEGIN
  IF NEW.role = 'Duplicate' AND NOT NEW.voided THEN
    SELECT * INTO t FROM radon_tests WHERE id = NEW.radon_test_id;
    IF FOUND AND NOT t.qa_duplicate_required THEN
      INSERT INTO radon_custody_events (radon_test_id, deployment_id, event_type, notes)
      VALUES (NEW.radon_test_id, NEW.id, 'Placed',
              'Extra duplicate. The phone could not confirm where this monitor was in its '
              || 'cycle, so it asked for a pair. The cycle resets from here.');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radon_extra_duplicate ON radon_deployments;
CREATE TRIGGER trg_radon_extra_duplicate AFTER INSERT ON radon_deployments
FOR EACH ROW EXECUTE FUNCTION radon_note_extra_duplicate();

-- ---------------------------------------------------------------------
-- The review queue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW radon_qa_exceptions AS
SELECT t.id, t.test_number, t.property_address, t.deployed_at, t.queued_at,
       t.qa_sequence_number, t.device_believed_sequence, t.device_synced_at,
       t.qa_exception_reason, t.source,
       e.full_name AS inspector_name,
       eq.name     AS monitor_name,
       eq.id       AS monitor_id,
       round(EXTRACT(EPOCH FROM (t.deployed_at - t.device_synced_at)) / 3600.0) AS hours_since_sync
  FROM radon_tests t
  LEFT JOIN employees e ON e.id = t.inspector_id
  LEFT JOIN LATERAL (
    SELECT eq.* FROM radon_deployments d JOIN equipment eq ON eq.id = d.equipment_id
     WHERE d.radon_test_id = t.id AND d.role = 'Primary' LIMIT 1
  ) eq ON true
 WHERE t.qa_exception AND t.qa_exception_cleared_at IS NULL
 ORDER BY t.deployed_at DESC;

-- ---------------------------------------------------------------------
-- What the phone downloads on every sync: one small row per monitor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW radon_device_ledger AS
SELECT e.id            AS equipment_id,
       e.name,
       e.serial_number,
       q.sequence_number  AS sequence,
       q.interval_n       AS interval,
       q.duplicate_required,
       e.next_calibration_due,
       e.status
  FROM equipment e
  CROSS JOIN LATERAL radon_qa_next(e.id, NULL) q
 WHERE e.asset_category = 'Radon' AND e.status NOT IN ('Retired');

COMMIT;
