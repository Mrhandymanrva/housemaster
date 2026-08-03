-- =====================================================================
-- 010_van_maintenance.sql — a service log the tech fills in at the shop,
-- plus the two dropdowns on the phone that had no list behind them.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Lists the phone needs
-- ---------------------------------------------------------------------
INSERT INTO lookup_lists (key, label, description) VALUES
  ('fuel_level','Fuel level','How full the tank is on a van check')
ON CONFLICT (key) DO NOTHING;

INSERT INTO lookup_values (list_key, value, label, sort) VALUES
  ('fuel_level','Full','Full',10),
  ('fuel_level','Three Quarters','Three quarters',20),
  ('fuel_level','Half','Half',30),
  ('fuel_level','Quarter','Quarter',40),
  ('fuel_level','Low','Low — needs fuel',50)
ON CONFLICT (list_key, value) DO NOTHING;

-- Service types already exist as a list; the phone just never pointed at one.
INSERT INTO lookup_values (list_key, value, label, sort) VALUES
  ('vehicle_service_type','Oil Change','Oil change',10),
  ('vehicle_service_type','Tires','Tires',20),
  ('vehicle_service_type','Brakes','Brakes',30),
  ('vehicle_service_type','State Inspection','State inspection',40),
  ('vehicle_service_type','Scheduled Service','Scheduled service',50),
  ('vehicle_service_type','Repair','Repair',60),
  ('vehicle_service_type','Body Work','Body work',70),
  ('vehicle_service_type','Other','Other',80)
ON CONFLICT (list_key, value) DO NOTHING;

-- Point the existing select fields at a list so they stop coming up empty.
UPDATE field_form_fields SET lookup_list = 'fuel_level'
 WHERE key = 'fuel_level' AND lookup_list IS NULL;
UPDATE field_form_fields SET lookup_list = 'radon_placement_floor'
 WHERE key = 'placement_floor' AND lookup_list IS NULL
   AND EXISTS (SELECT 1 FROM lookup_lists WHERE key = 'radon_placement_floor');

-- ---------------------------------------------------------------------
-- Van maintenance
--
-- Unlike a van check, this is not an edit to the van — it is a thing that
-- happened to it. The submission carries no target record, so applying it
-- writes a new row in vehicle_maintenance.
--
-- auto_apply stays off: these carry a cost and a vendor, and the office
-- clears them from the inbox with one tap.
-- ---------------------------------------------------------------------
INSERT INTO field_modules
 (key, name, description, icon, accent, target_entity, sort_order,
  require_photo, require_gps, require_signature, auto_apply)
VALUES
 ('van_maintenance','Van maintenance','Log an oil change, tires, inspection or repair',
  'wrench','amber','vehicle_maintenance',15,false,false,false,false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO field_module_access (module_id, app_role, can_submit)
SELECT m.id, r, true
  FROM field_modules m, unnest(ARRAY['owner','admin','office','field']) r
 WHERE m.key = 'van_maintenance'
ON CONFLICT DO NOTHING;

INSERT INTO field_forms (module_id, name, version, active)
SELECT m.id, m.name || ' form', 1, true FROM field_modules m
 WHERE m.key = 'van_maintenance'
   AND NOT EXISTS (SELECT 1 FROM field_forms f WHERE f.module_id = m.id);

INSERT INTO field_form_fields
  (form_id, key, label, input_type, required, lookup_list, maps_to_column, sort_order, help_text)
SELECT f.id, v.key, v.label, v.input_type, v.required, v.list, v.maps_to, v.sort, v.help
FROM field_forms f
JOIN field_modules m ON m.id = f.module_id AND m.key = 'van_maintenance'
CROSS JOIN (VALUES
  ('vehicle','Which van','ref_vehicle',true,NULL,'vehicle_id',10,NULL),
  ('service_type','What was done','select',true,'vehicle_service_type','service_type',20,NULL),
  ('service_date','Date of service','date',true,NULL,'service_date',30,NULL),
  ('mileage_at_service','Odometer','integer',true,NULL,'mileage_at_service',40,
   'Read it off the dash, not off the invoice.'),
  ('cost','What it cost','currency',false,NULL,'cost',50,NULL),
  ('vendor','Who did it','ref_vendor',false,NULL,'vendor_id',60,NULL),
  ('next_service_due_date','Next service due','date',false,NULL,'next_service_due_date',70,
   'Whatever the shop put on the sticker. This is what puts it back on the calendar.'),
  ('next_service_due_mileage','Next service mileage','integer',false,NULL,'next_service_due_mileage',80,NULL),
  ('warranty_applies','Covered by warranty','toggle',false,NULL,'warranty_applies',90,NULL),
  ('receipt','Photo of the invoice','photo',false,NULL,NULL,100,NULL),
  ('notes','Anything else','textarea',false,NULL,'notes',110,NULL)
) AS v(key,label,input_type,required,list,maps_to,sort,help)
WHERE NOT EXISTS (
  SELECT 1 FROM field_form_fields x WHERE x.form_id = f.id AND x.key = v.key
);

COMMIT;
