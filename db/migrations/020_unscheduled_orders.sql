-- =====================================================================
-- 020_unscheduled_orders.sql — an order nobody has scheduled is not work.
--
-- Three things let unscheduled and deleted orders be counted as jobs:
--
--   `datetime` on an unscheduled order is the literal text "null", which is a
--   non-empty string and so read as a real date.
--
--   `scheduleddatetime` was used as a fallback, but ISN's schema describes it
--   as the id of the user who did the scheduling, not a time.
--
--   `show` is ISN's deleted flag and was never looked at, so deleted orders
--   were pulled and counted like any other.
--
-- Repaired from the raw order already cached, so today's numbers are right
-- without waiting for the next pull.
-- =====================================================================
BEGIN;

-- A date that is not a date is no date.
UPDATE isn_orders
   SET scheduled_start = NULL, scheduled_end = NULL
 WHERE raw->>'datetime' IS NOT NULL
   AND (lower(trim(raw->>'datetime')) IN ('null', 'undefined', 'none', '')
        OR raw->>'datetime' ~ '^0{4}-0{2}-0{2}');

-- Deleted in ISN, whatever else it looks like.
UPDATE isn_orders
   SET order_status = 'Deleted'
 WHERE lower(COALESCE(raw->>'show', 'yes')) IN ('no', 'false', '0');

-- Everything left with no date is booked but not scheduled.
UPDATE isn_orders
   SET order_status = 'Unscheduled'
 WHERE scheduled_start IS NULL
   AND order_status NOT IN ('Deleted', 'Canceled', 'Complete');

-- A radon set drafted against one of those is not somebody's work either,
-- as long as nothing has been placed against it.
UPDATE radon_tests t
   SET status = 'Voided',
       conditions_notes = trim(BOTH E'\n' FROM
         COALESCE(t.conditions_notes || E'\n', '') ||
         'Voided automatically: the ISN order behind it is not a scheduled job.')
  FROM isn_orders o
 WHERE t.isn_order_uuid = o.id
   AND t.status = 'Scheduled'
   AND t.source = 'office'
   AND o.order_status IN ('Deleted', 'Unscheduled')
   AND NOT EXISTS (SELECT 1 FROM radon_deployments d WHERE d.radon_test_id = t.id);

COMMIT;
