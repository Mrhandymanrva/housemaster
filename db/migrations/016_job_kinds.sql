-- =====================================================================
-- 016_job_kinds.sql — which job types the phone counts.
--
-- Richmond does not sell termite, well and septic, or pool and spa today. A
-- tech looking at three tiles that read zero every day stops reading the row.
--
-- They are defined and switched off rather than deleted, so the day one of
-- those services starts, somebody turns it on under Dropdown lists and it
-- appears on every phone the next time the app opens. How each kind is
-- recognised stays in code; which kinds are counted is the office's call.
-- =====================================================================
BEGIN;

INSERT INTO lookup_lists (key, label, description) VALUES
  ('job_kind', 'Job types counted on the phone',
   'Turn one on when you start selling that service. The phone shows a tile for each.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO lookup_values (list_key, value, label, sort, active) VALUES
  ('job_kind', 'mold',        'Mold',          10, true),
  ('job_kind', 'sewer',       'Sewer scopes',  20, true),
  ('job_kind', 'termite',     'Termite',       30, false),
  ('job_kind', 'well_septic', 'Well & septic', 40, false),
  ('job_kind', 'pool',        'Pool & spa',    50, false)
ON CONFLICT (list_key, value) DO UPDATE
  SET label = EXCLUDED.label, sort = EXCLUDED.sort;

COMMIT;
