-- =====================================================================
-- 009_equipment_categories.sql — asset categories a home inspector would
-- recognise on the truck, rather than eight broad buckets.
--
-- Values are the stored key and are never rewritten here, so equipment
-- already filed under one keeps its category. Labels and ordering are
-- refreshed, and anything an admin has since added in the app survives.
-- =====================================================================
BEGIN;

INSERT INTO lookup_values (list_key, value, label, sort) VALUES
  ('asset_category','Radon',              'Radon monitors',              10),
  ('asset_category','Sewer Scope',        'Sewer scopes',                20),
  ('asset_category','Thermal Imaging',    'Thermal cameras',             30),
  ('asset_category','Moisture',           'Moisture meters',             40),
  ('asset_category','Drone',              'Drones',                      50),
  ('asset_category','360 Camera',         '360 cameras',                 60),
  ('asset_category','Ladders & Access',   'Ladders & access',            70),
  ('asset_category','Electrical',         'Electrical testers',          80),
  ('asset_category','Gas / Combustion',   'Gas & combustion detectors',  90),
  ('asset_category','Crawlspace & Attic', 'Crawlspace & attic gear',    100),
  ('asset_category','Mold & Air Quality', 'Mold & air quality',         110),
  ('asset_category','Water & Septic',     'Water & septic testing',     120),
  ('asset_category','Pool & Spa',         'Pool & spa',                 130),
  ('asset_category','Photography',        'Cameras & lighting',         140),
  ('asset_category','Computer / Tablet',  'Computers & tablets',        150),
  ('asset_category','Safety & PPE',       'Safety & PPE',               160),
  ('asset_category','Hand Tools',         'Hand tools',                 170),
  ('asset_category','General',            'Everything else',            180)
ON CONFLICT (list_key, value) DO UPDATE
  SET label = EXCLUDED.label, sort = EXCLUDED.sort, active = true;

-- "Moisture / Thermal" is now two categories. Hide it rather than delete it,
-- so any asset already filed under it still reads back correctly.
UPDATE lookup_values SET active = false
 WHERE list_key = 'asset_category' AND value = 'Moisture / Thermal';

COMMIT;
