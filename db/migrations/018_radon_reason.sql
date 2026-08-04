-- =====================================================================
-- 018_radon_reason.sql — why an order counted as radon.
--
-- The first pull flagged 124 of 124 orders and drafted a radon set against
-- every one. A set is not a harmless row: it carries the QA sequence number
-- the duplicate rule counts from, so phantom sets quietly corrupt "every tenth
-- set goes out as a pair".
--
-- Recording the reason means the next wrong answer can be read instead of
-- guessed at.
--
-- The drafts already made are voided here — but only the ones nobody has
-- touched. A set with a monitor on it is somebody's work, whatever caused it
-- to exist. The next pull re-evaluates every order and re-drafts the ones that
-- genuinely are radon.
-- =====================================================================
BEGIN;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS radon_reason text;

COMMENT ON COLUMN isn_orders.radon_reason IS
  'Which service or fee made this count as radon. Null when it did not.';

UPDATE radon_tests t
   SET status = 'Voided',
       conditions_notes = trim(BOTH E'\n' FROM
         COALESCE(t.conditions_notes || E'\n', '') ||
         'Voided automatically: drafted from an ISN order by a radon check that '
         || 'matched every order. Nothing was placed against it.')
 WHERE t.isn_order_uuid IS NOT NULL
   AND t.status = 'Scheduled'
   AND t.source = 'office'
   AND NOT EXISTS (SELECT 1 FROM radon_deployments d WHERE d.radon_test_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM radon_custody_events e
                    WHERE e.radon_test_id = t.id AND e.event_type <> 'Placed');

COMMIT;
