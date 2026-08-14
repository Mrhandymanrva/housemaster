-- ---------------------------------------------------------------------
-- When an inspector could take work.
--
-- ISN's API has no Events. The calendar section is one endpoint —
-- /calendar/availableslots — and it answers the booking question: given an
-- inspector, a zip and a service, when are they free? It never says what is
-- stopping them, so "Off", "Hold" and "back injury" are not reachable.
--
-- What it does allow is the inverse, carefully: a day with no free slot on it
-- is a day that inspector cannot take work. That is worth showing, and it is
-- not the same claim as "they are on leave" — the screen says so.
--
-- One row per inspector per day. The slots themselves are not kept: the grid
-- asks whether the day is open, and storing the windows would be storing a
-- booking engine's opinion of this afternoon, which is stale within the hour.
-- ---------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS isn_availability (
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day          date NOT NULL,
  slots        int  NOT NULL DEFAULT 0,
  pulled_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, day)
);

CREATE INDEX IF NOT EXISTS isn_availability_day ON isn_availability (day);

COMMIT;
