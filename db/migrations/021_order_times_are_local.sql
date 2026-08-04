-- =====================================================================
-- 021_order_times_are_local.sql — 9am means 9am in Richmond.
--
-- ISN sends "2026-08-04 09:00:00" with no zone on it and means nine in the
-- morning at the office. This server runs in UTC, so that reading was stored
-- as 09:00Z — and a phone in Richmond then showed a 9am inspection at 5am.
--
-- Rebuilt from the raw order rather than shifted by a fixed number of hours,
-- because the offset is four in August and five in January. AT TIME ZONE on a
-- naive timestamp is exactly this conversion, daylight saving included.
--
-- Only rows whose raw datetime carries no offset are touched. One that already
-- said UTC was never ambiguous and is correct as it stands.
-- =====================================================================
BEGIN;

UPDATE isn_orders o
   SET scheduled_start = s.start_at,
       scheduled_end = CASE
         WHEN NULLIF(o.raw->>'duration', '') ~ '^[0-9]+$'
         THEN s.start_at + ((o.raw->>'duration')::int * INTERVAL '1 minute')
         ELSE NULL
       END
  FROM (
    SELECT id,
           ((raw->>'datetime')::timestamp AT TIME ZONE 'America/New_York') AS start_at
      FROM isn_orders
     WHERE raw->>'datetime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}'
       AND raw->>'datetime' !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
  ) s
 WHERE o.id = s.id;

-- Radon sets drafted from those orders carry the same wrong time.
UPDATE radon_tests t
   SET scheduled_for = o.scheduled_start
  FROM isn_orders o
 WHERE t.isn_order_uuid = o.id
   AND t.status = 'Scheduled'
   AND t.scheduled_for IS DISTINCT FROM o.scheduled_start;

COMMIT;
