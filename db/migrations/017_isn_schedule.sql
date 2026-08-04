-- =====================================================================
-- 017_isn_schedule.sql — how often to pull, without anyone remembering to.
--
-- "Pull now" is a button somebody has to press, and the phone counts are only
-- as true as the last time somebody did. An hour is the right default: ISN's
-- footprints are a queue that keeps, and a tech who books a job at 9 wants to
-- see it before lunch, not instantly.
--
-- Zero means off, so the schedule can be switched away from without unpicking
-- anything.
-- =====================================================================
BEGIN;

ALTER TABLE isn_connection
  ADD COLUMN IF NOT EXISTS sync_every_minutes int NOT NULL DEFAULT 60;

ALTER TABLE isn_connection
  DROP CONSTRAINT IF EXISTS isn_connection_sync_interval_sane;
ALTER TABLE isn_connection
  ADD CONSTRAINT isn_connection_sync_interval_sane
  CHECK (sync_every_minutes = 0 OR sync_every_minutes BETWEEN 5 AND 1440);

COMMENT ON COLUMN isn_connection.sync_every_minutes IS
  'Minutes between automatic pulls. 0 switches the schedule off; the manual '
  'button still works.';

ALTER TABLE isn_sync_log
  ADD COLUMN IF NOT EXISTS trigger_source text;

COMMIT;
