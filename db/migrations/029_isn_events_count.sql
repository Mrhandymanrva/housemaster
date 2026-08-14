-- ---------------------------------------------------------------------
-- How many blocks the calendar had to say, last time it was asked.
--
-- /events answers rather than 404s, but with nothing in it. That is not the
-- same as a path that works, and remembering it as though it were would stop
-- the search there forever — the next candidate might be the one that talks,
-- or the same one might simply want a date range.
--
-- So a path is only worth reusing if it has produced something. Nought means
-- go and look again.
-- ---------------------------------------------------------------------
BEGIN;

ALTER TABLE isn_connection
  ADD COLUMN IF NOT EXISTS events_count int NOT NULL DEFAULT 0;

COMMIT;
