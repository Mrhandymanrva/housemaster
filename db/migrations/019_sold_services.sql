-- =====================================================================
-- 019_sold_services.sql — what was actually sold, as opposed to listed.
--
-- Radon was fixed by telling a booked service apart from a price-list line at
-- zero. Every other job type still counted by searching the whole services
-- blob, which carries that same fee schedule — so mold and sewer matched every
-- scheduled inspection in the company.
--
-- Rather than repeat the rule in each query, it is settled once at sync time:
-- sold_services holds only what a customer is paying for. Counting reads this;
-- `services` keeps everything, because the diagnostic needs to show the lines
-- that are never charged.
--
-- Backfilled from the raw order, so the numbers are right before the next pull
-- rather than after it.
-- =====================================================================
BEGIN;

ALTER TABLE isn_orders
  ADD COLUMN IF NOT EXISTS sold_services jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN isn_orders.sold_services IS
  'Booked services, plus fee lines that were actually charged. A fee at zero is '
  'a price on a menu, not a sale.';

UPDATE isn_orders o
   SET sold_services = COALESCE((
     SELECT jsonb_agg(x)
       FROM (
         SELECT jsonb_build_object('name', s->>'name', 'from', 'service') AS x
           FROM jsonb_array_elements(COALESCE(o.raw->'services', '[]'::jsonb)) s
          WHERE COALESCE(s->>'name', '') <> ''
         UNION ALL
         SELECT jsonb_build_object('name', f->>'name', 'from', 'fee',
                                   'amount', (f->>'amount')::numeric)
           FROM jsonb_array_elements(COALESCE(o.raw->'fees', '[]'::jsonb)) f
          WHERE COALESCE(f->>'name', '') <> ''
            -- only a line with a real, positive amount
            AND f->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
            AND (f->>'amount')::numeric > 0
       ) t
   ), '[]'::jsonb);

CREATE INDEX IF NOT EXISTS isn_orders_sold ON isn_orders USING gin (sold_services);

COMMIT;
