-- =====================================================================
-- 023_order_crew.sql — a job belongs to everyone working it.
--
-- An ISN order carries inspector1 through inspector10. Only the first was
-- ever used, so a two-inspector job showed up on one person's phone and not
-- the other's — and the one who did not see it had no way to know it existed.
--
-- The whole crew is kept now, and anything asking "is this mine" asks the
-- crew rather than the lead. inspector_isn_id stays as the lead, because
-- somebody still has to be the one the office rings.
--
-- Backfilled from the raw order, so today's board is right before the next
-- pull rather than after it.
-- =====================================================================
BEGIN;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS crew_isn_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS crew_employee_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN isn_orders.crew_employee_ids IS
  'Everyone assigned to the job, not just the lead. This is what decides whose '
  'phone a job appears on.';

-- Pull inspector1..inspector10 off the raw order.
UPDATE isn_orders o
   SET crew_isn_ids = COALESCE(c.ids, '{}')
  FROM (
    SELECT o2.id,
           array_agg(DISTINCT v.val) FILTER (WHERE COALESCE(v.val, '') <> '') AS ids
      FROM isn_orders o2
      CROSS JOIN LATERAL (
        SELECT o2.raw->>('inspector' || g.n) AS val
          FROM generate_series(1, 10) AS g(n)
      ) v
     GROUP BY o2.id
  ) c
 WHERE o.id = c.id;

-- Resolve those to people here.
UPDATE isn_orders o
   SET crew_employee_ids = COALESCE(m.ids, '{}')
  FROM (
    SELECT o2.id, array_agg(DISTINCT e.id) FILTER (WHERE e.id IS NOT NULL) AS ids
      FROM isn_orders o2
      LEFT JOIN LATERAL unnest(o2.crew_isn_ids) AS x(isn_id) ON true
      LEFT JOIN employees e ON e.isn_user_id = x.isn_id
     GROUP BY o2.id
  ) m
 WHERE o.id = m.id;

CREATE INDEX IF NOT EXISTS isn_orders_crew ON isn_orders USING gin (crew_employee_ids);

COMMIT;
