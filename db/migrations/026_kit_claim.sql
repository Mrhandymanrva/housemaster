-- ---------------------------------------------------------------------
-- When somebody last said what they are actually carrying.
--
-- The office can assign equipment to a person from the desktop, but only the
-- person holding it knows what is really on the van this morning. This is the
-- date of the last time they confirmed it, which is what turns a one-off
-- first-load into something worth doing again every few months: the phone can
-- say "you last checked in March" without anybody having to remember.
--
-- Nullable on purpose. Never having checked is a real state and a useful one —
-- it is exactly who the office needs to chase first.
-- ---------------------------------------------------------------------
BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS kit_confirmed_at timestamptz;

COMMIT;
