-- =====================================================================
-- 022_order_revenue.sql — what the work was booked at.
--
-- ISN puts the whole job's price on the order as `totalfee`. Kept as a column
-- rather than dug out of the raw JSON every time somebody opens their phone.
--
-- This is booked revenue, not collected: it is what the jobs were sold for.
-- `paid` is ISN's yes/no on whether the money has arrived, and the two are
-- worth seeing apart.
-- =====================================================================
BEGIN;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS total_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN isn_orders.total_fee IS
  'What the job was booked at, from the order. Not what has been collected.';

UPDATE isn_orders
   SET total_fee = CASE
         WHEN raw->>'totalfee' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (raw->>'totalfee')::numeric
         ELSE NULL
       END,
       paid = lower(COALESCE(raw->>'paid', 'no')) IN ('yes', 'true', '1');

CREATE INDEX IF NOT EXISTS isn_orders_revenue
  ON isn_orders (scheduled_start) WHERE total_fee IS NOT NULL;

COMMIT;
