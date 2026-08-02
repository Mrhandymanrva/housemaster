-- =====================================================================
-- 005_defaults.sql — dropdown lists and the starting field-app modules.
-- Everything here is editable in the app; this is only the starting point.
-- =====================================================================
BEGIN;

INSERT INTO lookup_lists (key, label) VALUES
 ('employee_role','Employee roles'),
 ('employee_status','Employee status'),
 ('license_type','License types'),
 ('license_status','License status'),
 ('ceu_category','CEU categories'),
 ('vehicle_status','Vehicle status'),
 ('vehicle_service_type','Vehicle service types'),
 ('asset_category','Asset categories'),
 ('asset_status','Asset status'),
 ('asset_condition','Asset condition'),
 ('equipment_service_type','Equipment service types'),
 ('supply_category','Supply categories'),
 ('inventory_txn_type','Inventory movements'),
 ('vendor_category','Vendor categories'),
 ('policy_type','Policy types'),
 ('incident_type','Incident types'),
 ('claim_status','Claim status'),
 ('billing_frequency','Billing frequency'),
 ('generic_status','Status')
ON CONFLICT DO NOTHING;

INSERT INTO lookup_values (list_key, value, label, color, sort) VALUES
 ('employee_role','Owner','Owner',NULL,10),
 ('employee_role','General Manager','General Manager',NULL,20),
 ('employee_role','Inspector','Inspector',NULL,30),
 ('employee_role','Radon Technician','Radon Technician',NULL,40),
 ('employee_role','CSR','CSR',NULL,50),
 ('employee_role','Admin','Admin',NULL,60),

 ('employee_status','Active','Active','green',10),
 ('employee_status','On Leave','On Leave','amber',20),
 ('employee_status','Inactive','Inactive','slate',30),

 ('license_type','Home Inspector','Home Inspector',NULL,10),
 ('license_type','NRS Home Inspector','New Residential Structure (NRS)',NULL,20),
 ('license_type','Radon Measurement','Radon Measurement',NULL,30),
 ('license_type','Termite / WDI','Termite / WDI',NULL,40),
 ('license_type','Mold Assessment','Mold Assessment',NULL,50),
 ('license_type','Septic / Well','Septic / Well',NULL,60),
 ('license_type','Business License','Business License',NULL,70),
 ('license_type','Drone / Part 107','Drone / Part 107',NULL,80),

 ('license_status','Active','Active','green',10),
 ('license_status','Pending Renewal','Pending Renewal','amber',20),
 ('license_status','Expired','Expired','red',30),
 ('license_status','Retired','Retired','slate',40),

 ('ceu_category','Standards of Practice','Standards of Practice',NULL,10),
 ('ceu_category','Ethics','Ethics',NULL,20),
 ('ceu_category','Technical','Technical',NULL,30),
 ('ceu_category','Radon','Radon',NULL,40),
 ('ceu_category','Report Writing','Report Writing',NULL,50),
 ('ceu_category','Business','Business',NULL,60),

 ('vehicle_status','Active','Active','green',10),
 ('vehicle_status','In Shop','In Shop','amber',20),
 ('vehicle_status','Out of Service','Out of Service','red',30),
 ('vehicle_status','Sold','Sold','slate',40),

 ('vehicle_service_type','Oil Change','Oil Change',NULL,10),
 ('vehicle_service_type','Tires','Tires',NULL,20),
 ('vehicle_service_type','Brakes','Brakes',NULL,30),
 ('vehicle_service_type','State Inspection','State Inspection',NULL,40),
 ('vehicle_service_type','Scheduled Maintenance','Scheduled Maintenance',NULL,50),
 ('vehicle_service_type','Repair','Repair',NULL,60),
 ('vehicle_service_type','Body Work','Body Work',NULL,70),

 ('asset_category','Radon','Radon',NULL,10),
 ('asset_category','Moisture / Thermal','Moisture / Thermal',NULL,20),
 ('asset_category','Drone','Drone',NULL,30),
 ('asset_category','Electrical','Electrical',NULL,40),
 ('asset_category','Gas / Combustion','Gas / Combustion',NULL,50),
 ('asset_category','Ladders & Access','Ladders & Access',NULL,60),
 ('asset_category','Computer / Tablet','Computer / Tablet',NULL,70),
 ('asset_category','General','General',NULL,80),

 ('asset_status','In Service','In Service','green',10),
 ('asset_status','In Calibration','In Calibration','amber',20),
 ('asset_status','Needs Repair','Needs Repair','red',30),
 ('asset_status','Spare','Spare','slate',40),
 ('asset_status','Retired','Retired','slate',50),

 ('asset_condition','Excellent','Excellent',NULL,10),
 ('asset_condition','Good','Good',NULL,20),
 ('asset_condition','Fair','Fair',NULL,30),
 ('asset_condition','Replace Soon','Replace Soon',NULL,40),

 ('equipment_service_type','Calibration','Calibration',NULL,10),
 ('equipment_service_type','Maintenance','Maintenance',NULL,20),
 ('equipment_service_type','Repair','Repair',NULL,30),
 ('equipment_service_type','Inspection','Inspection',NULL,40),

 ('supply_category','Radon Consumables','Radon Consumables',NULL,10),
 ('supply_category','Marketing','Marketing',NULL,20),
 ('supply_category','Office','Office',NULL,30),
 ('supply_category','Safety / PPE','Safety / PPE',NULL,40),
 ('supply_category','Field Consumables','Field Consumables',NULL,50),

 ('inventory_txn_type','Receive','Received',NULL,10),
 ('inventory_txn_type','Issue','Issued to field',NULL,20),
 ('inventory_txn_type','Count','Physical count',NULL,30),
 ('inventory_txn_type','Adjust','Adjustment',NULL,40),
 ('inventory_txn_type','Return','Returned',NULL,50),
 ('inventory_txn_type','Waste','Waste / damaged',NULL,60),

 ('vendor_category','Auto / Fleet','Auto / Fleet',NULL,10),
 ('vendor_category','Calibration Lab','Calibration Lab',NULL,20),
 ('vendor_category','Radon Lab','Radon Lab',NULL,30),
 ('vendor_category','Equipment Supplier','Equipment Supplier',NULL,40),
 ('vendor_category','Insurance','Insurance',NULL,50),
 ('vendor_category','Software','Software',NULL,60),
 ('vendor_category','Marketing','Marketing',NULL,70),
 ('vendor_category','Professional Services','Professional Services',NULL,80),

 ('policy_type','General Liability','General Liability',NULL,10),
 ('policy_type','Errors & Omissions','Errors & Omissions',NULL,20),
 ('policy_type','Commercial Auto','Commercial Auto',NULL,30),
 ('policy_type','Workers Comp','Workers Comp',NULL,40),
 ('policy_type','Inland Marine / Equipment','Inland Marine / Equipment',NULL,50),
 ('policy_type','Umbrella','Umbrella',NULL,60),
 ('policy_type','Cyber','Cyber',NULL,70),

 ('incident_type','Vehicle Accident','Vehicle Accident',NULL,10),
 ('incident_type','Property Damage','Property Damage',NULL,20),
 ('incident_type','Injury','Injury',NULL,30),
 ('incident_type','Client Complaint','Client Complaint',NULL,40),
 ('incident_type','E&O Claim','E&O Claim',NULL,50),
 ('incident_type','Equipment Loss','Equipment Loss',NULL,60),
 ('incident_type','Near Miss','Near Miss',NULL,70),

 ('claim_status','Open','Open','red',10),
 ('claim_status','Reported','Reported','amber',20),
 ('claim_status','Under Review','Under Review','amber',30),
 ('claim_status','Closed','Closed','green',40),

 ('billing_frequency','Monthly','Monthly',NULL,10),
 ('billing_frequency','Annual','Annual',NULL,20),
 ('billing_frequency','Quarterly','Quarterly',NULL,30),
 ('billing_frequency','One-time','One-time',NULL,40),

 ('generic_status','Active','Active','green',10),
 ('generic_status','Pending','Pending','amber',20),
 ('generic_status','Cancelled','Cancelled','slate',30)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Starting field-app modules
-- ---------------------------------------------------------------------
INSERT INTO field_modules
 (key, name, description, icon, accent, target_entity, sort_order,
  require_photo, require_gps, require_signature, auto_apply)
VALUES
 ('van_check','Van check','Start-of-day walkaround, mileage and fuel','van','steel','vehicles',10,true,true,false,true),
 ('radon_deploy','Radon deployment','Log placement, device and start time','gauge','red','equipment',20,true,true,false,false),
 ('radon_retrieve','Radon retrieval','Pick up devices and record readings','gauge','red','equipment',30,true,true,false,false),
 ('equipment_check','Equipment check-out','Take an asset out or bring it back','toolbox','amber','equipment',40,false,false,false,true),
 ('supply_count','Supply count','Count what is on the van','boxes','green','supplies',50,false,false,false,true),
 ('incident_report','Incident report','Something happened. Capture it now.','alert','red','claims_incidents',60,true,true,false,false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO field_module_access (module_id, app_role, can_submit)
SELECT id, r, true FROM field_modules, unnest(ARRAY['owner','admin','office','field']) r
ON CONFLICT DO NOTHING;

INSERT INTO field_forms (module_id, name, version, active)
SELECT id, name || ' form', 1, true FROM field_modules
ON CONFLICT DO NOTHING;

-- Van check form: the mileage field writes straight back to the vehicle record
INSERT INTO field_form_fields (form_id, key, label, input_type, required, maps_to_column, sort_order, help_text)
SELECT f.id, v.key, v.label, v.input_type, v.required, v.maps_to, v.sort, v.help
FROM field_forms f
JOIN field_modules m ON m.id = f.module_id AND m.key = 'van_check'
CROSS JOIN (VALUES
  ('vehicle','Which van','ref_vehicle',true,NULL,10,NULL),
  ('current_mileage','Odometer','integer',true,'current_mileage',20,'Read it off the dash before you pull out.'),
  ('fuel_level','Fuel level','select',true,NULL,30,NULL),
  ('tires_ok','Tires look right','toggle',true,NULL,40,NULL),
  ('lights_ok','Lights and signals work','toggle',true,NULL,50,NULL),
  ('fluids_ok','No leaks underneath','toggle',true,NULL,60,NULL),
  ('damage_photo','Any new damage','photo',false,NULL,70,'Skip if nothing changed since yesterday.'),
  ('notes','Anything else','textarea',false,'notes',80,NULL)
) AS v(key,label,input_type,required,maps_to,sort,help)
ON CONFLICT DO NOTHING;

INSERT INTO field_form_fields (form_id, key, label, input_type, required, maps_to_column, sort_order, help_text)
SELECT f.id, v.key, v.label, v.input_type, v.required, v.maps_to, v.sort, v.help
FROM field_forms f
JOIN field_modules m ON m.id = f.module_id AND m.key = 'radon_deploy'
CROSS JOIN (VALUES
  ('device','Which monitor','ref_equipment',true,NULL,10,NULL),
  ('address','Property address','text',true,NULL,20,NULL),
  ('placement_floor','Floor placed on','select',true,NULL,30,NULL),
  ('placement_photo','Photo of placement','photo',true,NULL,40,'Show the device and the room it sits in.'),
  ('closed_house_confirmed','Closed-house conditions explained to client','toggle',true,NULL,50,NULL),
  ('start_time','Start time','time',true,NULL,60,NULL),
  ('notes','Notes','textarea',false,NULL,70,NULL)
) AS v(key,label,input_type,required,maps_to,sort,help)
ON CONFLICT DO NOTHING;

INSERT INTO field_form_fields (form_id, key, label, input_type, required, maps_to_column, sort_order, help_text)
SELECT f.id, v.key, v.label, v.input_type, v.required, v.maps_to, v.sort, v.help
FROM field_forms f
JOIN field_modules m ON m.id = f.module_id AND m.key = 'supply_count'
CROSS JOIN (VALUES
  ('supply','Item','ref_supply',true,NULL,10,NULL),
  ('quantity','Count on hand','number',true,NULL,20,'What is physically on the van right now.'),
  ('vehicle','Counted on','ref_vehicle',false,NULL,30,NULL),
  ('notes','Notes','textarea',false,NULL,40,NULL)
) AS v(key,label,input_type,required,maps_to,sort,help)
ON CONFLICT DO NOTHING;

COMMIT;
