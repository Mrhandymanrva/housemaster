-- =====================================================================
-- 024_order_modified.sql — remember when ISN last touched an order.
--
-- /orders answers with stubs: id, show, modified. Nothing else. So the pull
-- cannot tell from the list when a job is scheduled, or what its number is —
-- it has to fetch each order in full to find out.
--
-- Over a year that is six thousand orders and six thousand calls, which is why
-- a widened lookback left the sync grinding and saving nothing. Keeping
-- `modified` means the second pass asks only about what actually changed, and
-- the expensive pass happens once.
-- =====================================================================
BEGIN;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS isn_modified timestamptz;

COMMENT ON COLUMN isn_orders.isn_modified IS
  'ISN''s own last-modified stamp from the order list. A stub whose stamp '
  'matches this does not need fetching again.';

CREATE INDEX IF NOT EXISTS isn_orders_modified ON isn_orders (isn_modified);

-- Anything already cached has been read at least once; take the stamp off the
-- raw order where it is there, so the first run after this does not re-fetch
-- everything we already hold.
UPDATE isn_orders
   SET isn_modified = CASE
         WHEN raw->>'modified' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         THEN (raw->>'modified')::timestamptz
         ELSE last_pulled_at
       END
 WHERE isn_modified IS NULL;

COMMIT;

-- How many orders one pull may read in full. The list is stubs, so every
-- unread order costs a call; this keeps a first run from trying six thousand
-- of them at once. Newest-changed are read first and the rest wait for the
-- next pull, so the backlog clears on its own.
BEGIN;
ALTER TABLE isn_connection
  ADD COLUMN IF NOT EXISTS max_orders_per_pull int NOT NULL DEFAULT 600;
COMMIT;
