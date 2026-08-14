-- ---------------------------------------------------------------------
-- Time somebody has blocked off.
--
-- In ISN this is an Event rather than an Order: a title somebody typed —
-- "Off", "Hold", "back injury" — against an inspector and a stretch of the
-- calendar. The week grid on Home cannot tell a free day from a blocked one
-- without them, which means it can show a day as open when it is not.
--
-- Kept apart from isn_orders on purpose. An event is not work and carries no
-- money; folding it into orders would put it into every revenue sum that
-- filters on status, and one missed filter would quietly invent revenue.
--
-- The whole payload is kept in `raw` because the shape of an ISN event is not
-- documented anywhere this office can reach — the columns below are what the
-- normaliser could recognise, and `raw` is what it can be re-read from when a
-- field turns out to matter.
-- ---------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS isn_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isn_event_id   text NOT NULL UNIQUE,
  title          text,

  starts_at      timestamptz,
  ends_at        timestamptz,
  all_day        boolean NOT NULL DEFAULT false,

  -- Who it belongs to. isn_user_id is what ISN says; employee_id is our own
  -- person once the roster has been adopted, filled the same way orders are.
  isn_user_id    text,
  employee_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  inspector_name text,

  source_path    text,          -- which endpoint it came from, for when one changes
  raw            jsonb,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_pulled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS isn_events_when ON isn_events (starts_at);
CREATE INDEX IF NOT EXISTS isn_events_who ON isn_events (employee_id, starts_at);

-- Which path answered, and when it last did. Nothing about ISN's calendar is
-- documented for this office, so the app finds out by asking and remembers the
-- answer rather than carrying a guess in code.
ALTER TABLE isn_connection
  ADD COLUMN IF NOT EXISTS events_path        text,
  ADD COLUMN IF NOT EXISTS events_kind        text,
  ADD COLUMN IF NOT EXISTS events_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS events_note        text;

COMMIT;
