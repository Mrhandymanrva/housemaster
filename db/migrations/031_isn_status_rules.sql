-- ---------------------------------------------------------------------
-- Which of ISN's statuses mean somebody is actually doing the work.
--
-- The app decided this in code: anything not Canceled, Deleted or Unscheduled
-- counted as booked work. That is a guess at another company's vocabulary, and
-- it was wrong — orders the office calls unscheduled came through under some
-- other word and drew themselves on the calendar as though they were booked.
--
-- Guessing harder is not the fix. What each status means is a fact about how
-- this branch runs ISN, the same kind of fact as which job kinds they sell,
-- and it belongs where the owner can set it rather than in a list only a
-- developer can reach. So: one row per status, a tick for whether it counts,
-- and a screen that shows every status ISN has actually sent with a count
-- beside it.
--
-- Statuses are stored folded and trimmed, because ISN's capitalisation is not
-- something to depend on. A status with no row here counts as work — a new
-- word appearing in ISN should show up on the calendar and be turned off on
-- purpose, rather than vanish silently and be missed.
-- ---------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS isn_status_rules (
  status          text PRIMARY KEY,
  counts_as_work  boolean NOT NULL DEFAULT true,
  note            text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The four the code used to carry. Seeded so the table is never empty: an
-- empty rules table would mean nothing is excluded, which is the one starting
-- point worse than the old guess.
INSERT INTO isn_status_rules (status, counts_as_work, note) VALUES
  ('canceled',    false, 'Called off. Not work and not revenue.'),
  ('cancelled',   false, 'The same thing, spelled the other way.'),
  ('deleted',     false, 'Removed in ISN.'),
  ('unscheduled', false, 'No day on it yet — it belongs on the waiting list, not the grid.')
ON CONFLICT (status) DO NOTHING;

COMMIT;
