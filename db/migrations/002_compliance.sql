-- =====================================================================
-- 002_compliance.sql
-- The Renewals & Compliance Calendar, rebuilt as a generated index of
-- every date in the business rather than a table people re-key into.
-- =====================================================================
BEGIN;

CREATE TABLE compliance_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity   text,          -- null = manually created item
  source_id       uuid,
  source_field    text,          -- which date column produced this
  category        text NOT NULL, -- License | Vehicle | Equipment | Insurance | CEU | Software | Manual
  title           text NOT NULL,
  subject         text,          -- who/what it belongs to, denormalized for display
  due_date        date NOT NULL,
  priority        text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Critical','High','Normal','Low')),
  responsible_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  reminder_days   int[] NOT NULL DEFAULT '{90,60,30,14,7,1}',
  completed_date  date,
  dismissed       boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_entity, source_id, source_field)
);
CREATE INDEX ON compliance_items (due_date);
CREATE INDEX ON compliance_items (category, due_date);

CREATE TRIGGER trg_touch_compliance_items BEFORE UPDATE ON compliance_items
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- refresh_compliance() sweeps every expiration column in the system and
-- upserts a calendar row. Idempotent. Run on write and nightly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_compliance() RETURNS int AS $$
DECLARE n int := 0;
BEGIN
  WITH src AS (
    -- Licenses
    SELECT 'licenses'::text AS e, l.id, 'expiration_date'::text AS f, 'License'::text AS cat,
           l.name || ' expires' AS title, COALESCE(emp.full_name,'Unassigned') AS subj,
           l.expiration_date AS due, 'Critical'::text AS pri, l.employee_id AS resp
      FROM licenses l LEFT JOIN employees emp ON emp.id = l.employee_id
     WHERE l.expiration_date IS NOT NULL AND l.status <> 'Retired'
    UNION ALL
    -- Driver's licenses
    SELECT 'employees', e.id, 'dl_expiration', 'License',
           'Driver''s license expires', e.full_name, e.dl_expiration, 'High', e.id
      FROM employees e WHERE e.dl_expiration IS NOT NULL AND e.status = 'Active'
    UNION ALL
    -- Vehicle registration
    SELECT 'vehicles', v.id, 'registration_expiration', 'Vehicle',
           'Registration expires', v.unit_number, v.registration_expiration, 'High', v.primary_driver_id
      FROM vehicles v WHERE v.registration_expiration IS NOT NULL AND v.status = 'Active'
    UNION ALL
    -- State inspection
    SELECT 'vehicles', v.id, 'state_inspection_due', 'Vehicle',
           'State inspection due', v.unit_number, v.state_inspection_due, 'High', v.primary_driver_id
      FROM vehicles v WHERE v.state_inspection_due IS NOT NULL AND v.status = 'Active'
    UNION ALL
    -- Scheduled service
    SELECT 'vehicles', v.id, 'next_service_date', 'Vehicle',
           'Scheduled service due', v.unit_number, v.next_service_date, 'Normal', v.primary_driver_id
      FROM vehicles v WHERE v.next_service_date IS NOT NULL AND v.status = 'Active'
    UNION ALL
    -- Equipment calibration
    SELECT 'equipment', q.id, 'next_calibration_due', 'Equipment',
           'Calibration due', q.name || COALESCE(' · '||q.serial_number,''), q.next_calibration_due,
           CASE WHEN q.asset_category = 'Radon' THEN 'Critical' ELSE 'Normal' END, q.assigned_employee_id
      FROM equipment q WHERE q.next_calibration_due IS NOT NULL AND q.status <> 'Retired'
    UNION ALL
    -- Warranty
    SELECT 'equipment', q.id, 'warranty_expiration', 'Equipment',
           'Warranty expires', q.name, q.warranty_expiration, 'Low', q.assigned_employee_id
      FROM equipment q WHERE q.warranty_expiration IS NOT NULL AND q.status <> 'Retired'
    UNION ALL
    -- Insurance
    SELECT 'insurance_policies', p.id, 'expiration_date', 'Insurance',
           p.name || ' renews', COALESCE(p.carrier,''), p.expiration_date, 'Critical', NULL::uuid
      FROM insurance_policies p WHERE p.expiration_date IS NOT NULL AND p.status = 'Active'
    UNION ALL
    -- Software
    SELECT 'software_subscriptions', s.id, 'renewal_date', 'Software',
           s.service_name || ' renews', COALESCE(s.billing_frequency,''), s.renewal_date, 'Low', s.account_owner_id
      FROM software_subscriptions s WHERE s.renewal_date IS NOT NULL AND s.status = 'Active'
    UNION ALL
    -- Supply lot expiration (radon canisters, test kits)
    SELECT 'supplies', u.id, 'expiration_date', 'Supplies',
           u.item_name || ' lot expires', COALESCE(u.lot_number,''), u.expiration_date, 'Normal', NULL::uuid
      FROM supplies u WHERE u.expiration_date IS NOT NULL
  )
  INSERT INTO compliance_items
        (source_entity, source_id, source_field, category, title, subject, due_date, priority, responsible_id)
  SELECT e, id, f, cat, title, subj, due, pri, resp FROM src
  ON CONFLICT (source_entity, source_id, source_field) DO UPDATE
    SET due_date  = EXCLUDED.due_date,
        title     = EXCLUDED.title,
        subject   = EXCLUDED.subject,
        priority  = EXCLUDED.priority,
        category  = EXCLUDED.category,
        completed_date = CASE WHEN EXCLUDED.due_date <> compliance_items.due_date
                              THEN NULL ELSE compliance_items.completed_date END,
        updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;

  -- drop generated rows whose source date was cleared or source deleted
  DELETE FROM compliance_items ci
   WHERE ci.source_entity IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM licenses l WHERE ci.source_entity='licenses' AND l.id=ci.source_id AND l.expiration_date IS NOT NULL
       UNION ALL SELECT 1 FROM employees e WHERE ci.source_entity='employees' AND e.id=ci.source_id AND e.dl_expiration IS NOT NULL
       UNION ALL SELECT 1 FROM vehicles v WHERE ci.source_entity='vehicles' AND v.id=ci.source_id
       UNION ALL SELECT 1 FROM equipment q WHERE ci.source_entity='equipment' AND q.id=ci.source_id
       UNION ALL SELECT 1 FROM insurance_policies p WHERE ci.source_entity='insurance_policies' AND p.id=ci.source_id
       UNION ALL SELECT 1 FROM software_subscriptions s WHERE ci.source_entity='software_subscriptions' AND s.id=ci.source_id
       UNION ALL SELECT 1 FROM supplies u WHERE ci.source_entity='supplies' AND u.id=ci.source_id
     );
  RETURN n;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- The view the dashboard reads
-- ---------------------------------------------------------------------
CREATE VIEW compliance_horizon AS
SELECT ci.*,
       (ci.due_date - CURRENT_DATE) AS days_out,
       CASE
         WHEN ci.completed_date IS NOT NULL THEN 'Cleared'
         WHEN ci.due_date <  CURRENT_DATE      THEN 'Overdue'
         WHEN ci.due_date <= CURRENT_DATE + 30 THEN 'Due Soon'
         WHEN ci.due_date <= CURRENT_DATE + 90 THEN 'On Deck'
         ELSE 'Scheduled'
       END AS state,
       emp.full_name AS responsible_name
FROM compliance_items ci
LEFT JOIN employees emp ON emp.id = ci.responsible_id
WHERE ci.dismissed = false;

-- Inspector readiness: can this person legally work today?
CREATE VIEW inspector_readiness AS
SELECT e.id AS employee_id, e.full_name, e.role, e.status,
       COUNT(l.id) FILTER (WHERE l.expiration_date < CURRENT_DATE)              AS licenses_expired,
       COUNT(l.id) FILTER (WHERE l.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60) AS licenses_due_60,
       COALESCE(SUM(l.ceu_hours_required),0)                                     AS ceu_hours_required,
       COALESCE((SELECT SUM(c.ceu_hours) FROM ceu_records c
                  WHERE c.employee_id = e.id
                    AND c.completion_date > CURRENT_DATE - INTERVAL '2 years'),0) AS ceu_hours_completed,
       (e.dl_expiration < CURRENT_DATE)                                          AS dl_expired
FROM employees e
LEFT JOIN licenses l ON l.employee_id = e.id AND l.status <> 'Retired'
WHERE e.status = 'Active'
GROUP BY e.id;

COMMIT;
