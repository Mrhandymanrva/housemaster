-- =====================================================================
-- demo.sql — sample data so the dashboard has something to show.
-- Dates are relative to today, so the compliance horizon always populates.
-- Run with: npm run seed     Clear with: npm run seed:reset
-- =====================================================================
BEGIN;

INSERT INTO employees (id, full_name, email, phone, job_title, role, status, hire_date, territory, home_location, dl_expiration) VALUES
 ('11111111-1111-1111-1111-111111111101','Mason Holloway','mason@hmrichmond.com','804-555-0101','Owner','Owner','Active','2016-03-01','Richmond','Glen Allen', CURRENT_DATE + 420),
 ('11111111-1111-1111-1111-111111111102','Dale Whitfield','dale@hmrichmond.com','804-555-0102','Lead Inspector','Inspector','Active','2018-06-11','Richmond','Midlothian', CURRENT_DATE + 41),
 ('11111111-1111-1111-1111-111111111103','Rosa Nunez','rosa@hmrichmond.com','804-555-0103','Inspector','Inspector','Active','2021-02-15','Tri-Cities','Chester', CURRENT_DATE + 260),
 ('11111111-1111-1111-1111-111111111104','Trevor Banks','trevor@hmrichmond.com','804-555-0104','Radon Technician','Radon Technician','Active','2023-09-05','Richmond','Henrico', CURRENT_DATE - 12),
 ('11111111-1111-1111-1111-111111111105','Angela Pryor','angela@hmrichmond.com','804-555-0105','Client Services','CSR','Active','2022-01-10','Office','Glen Allen', CURRENT_DATE + 610)
ON CONFLICT DO NOTHING;

UPDATE employees SET supervisor_id='11111111-1111-1111-1111-111111111101'
 WHERE id <> '11111111-1111-1111-1111-111111111101';

INSERT INTO vendors (id, name, category, contact_name, phone, email, payment_terms, preferred) VALUES
 ('22222222-2222-2222-2222-222222222201','Bowman Fleet Service','Auto / Fleet','Ken Bowman','804-555-0301','service@bowmanfleet.com','Net 15',true),
 ('22222222-2222-2222-2222-222222222202','Bowser Calibration Lab','Calibration Lab','Priya Rao','800-555-0302','lab@bowsercal.com','Prepaid',true),
 ('22222222-2222-2222-2222-222222222203','AccuStar Radon Labs','Radon Lab','Support','800-555-0303','support@accustar.com','Net 30',true),
 ('22222222-2222-2222-2222-222222222204','Colonial Risk Partners','Insurance','Beth Salter','804-555-0304','beth@colonialrisk.com','Annual',true),
 ('22222222-2222-2222-2222-222222222205','Inspector Tools Direct','Equipment Supplier','Sales','888-555-0305','sales@inspectortools.com','Net 30',false)
ON CONFLICT DO NOTHING;

INSERT INTO insurance_policies (id, name, policy_type, policy_number, carrier, broker_vendor_id, effective_date, expiration_date, premium_amount) VALUES
 ('33333333-3333-3333-3333-333333333301','General Liability','General Liability','GL-4471902','Hartford','22222222-2222-2222-2222-222222222204', CURRENT_DATE - 320, CURRENT_DATE + 45, 4820.00),
 ('33333333-3333-3333-3333-333333333302','Errors & Omissions','Errors & Omissions','EO-99120','Lloyd''s','22222222-2222-2222-2222-222222222204', CURRENT_DATE - 200, CURRENT_DATE + 165, 6250.00),
 ('33333333-3333-3333-3333-333333333303','Commercial Auto','Commercial Auto','CA-338814','Progressive','22222222-2222-2222-2222-222222222204', CURRENT_DATE - 280, CURRENT_DATE + 85, 7910.00),
 ('33333333-3333-3333-3333-333333333304','Inland Marine — Equipment','Inland Marine / Equipment','IM-55210','Hartford','22222222-2222-2222-2222-222222222204', CURRENT_DATE - 100, CURRENT_DATE + 265, 1180.00)
ON CONFLICT DO NOTHING;

INSERT INTO vehicles (id, unit_number, make, model, model_year, vin, plate_number, status, primary_driver_id, insurance_policy_id, registration_expiration, state_inspection_due, current_mileage, last_mileage_update, next_oil_change_mileage, next_service_date, purchase_date) VALUES
 ('44444444-4444-4444-4444-444444444401','Van 1','Ford','Transit Connect',2021,'1FTBR1C87MKA12345','VDT-4471','Active','11111111-1111-1111-1111-111111111102','33333333-3333-3333-3333-333333333303', CURRENT_DATE + 22, CURRENT_DATE + 130, 88410, now() - interval '2 days', 91000, CURRENT_DATE + 26, '2021-04-02'),
 ('44444444-4444-4444-4444-444444444402','Van 2','Ford','Transit Connect',2022,'1FTBR1C87NKA55512','VDT-5590','Active','11111111-1111-1111-1111-111111111103','33333333-3333-3333-3333-333333333303', CURRENT_DATE + 190, CURRENT_DATE - 6, 61240, now() - interval '1 day', 64000, CURRENT_DATE + 70, '2022-05-19'),
 ('44444444-4444-4444-4444-444444444403','Van 3','Chevrolet','Colorado',2020,'1GCGTCEN4L1234567','VDT-2210','In Shop','11111111-1111-1111-1111-111111111104','33333333-3333-3333-3333-333333333303', CURRENT_DATE + 78, CURRENT_DATE + 44, 121880, now() - interval '9 days', 124000, CURRENT_DATE + 4, '2020-01-08')
ON CONFLICT DO NOTHING;

INSERT INTO licenses (name, license_type, issuing_authority, state_jurisdiction, license_number, employee_id, issue_date, expiration_date, ceu_hours_required, renewal_fee, status) VALUES
 ('VA Home Inspector — Holloway','Home Inspector','DPOR','VA','3380001234','11111111-1111-1111-1111-111111111101', CURRENT_DATE - 700, CURRENT_DATE + 330, 16, 100, 'Active'),
 ('VA Home Inspector — Whitfield','Home Inspector','DPOR','VA','3380004411','11111111-1111-1111-1111-111111111102', CURRENT_DATE - 690, CURRENT_DATE + 18, 16, 100, 'Pending Renewal'),
 ('VA NRS Endorsement — Whitfield','NRS Home Inspector','DPOR','VA','3380004411-N','11111111-1111-1111-1111-111111111102', CURRENT_DATE - 690, CURRENT_DATE + 18, 8, 45, 'Pending Renewal'),
 ('VA Home Inspector — Nunez','Home Inspector','DPOR','VA','3380007788','11111111-1111-1111-1111-111111111103', CURRENT_DATE - 400, CURRENT_DATE + 330, 16, 100, 'Active'),
 ('NRPP Radon Measurement — Banks','Radon Measurement','NRPP','National','RMT-220145','11111111-1111-1111-1111-111111111104', CURRENT_DATE - 730, CURRENT_DATE - 4, 16, 275, 'Expired'),
 ('NRPP Radon Measurement — Whitfield','Radon Measurement','NRPP','National','RMT-118820','11111111-1111-1111-1111-111111111102', CURRENT_DATE - 500, CURRENT_DATE + 225, 16, 275, 'Active'),
 ('FAA Part 107 — Nunez','Drone / Part 107','FAA','National','4451102','11111111-1111-1111-1111-111111111103', CURRENT_DATE - 600, CURRENT_DATE + 64, 0, 0, 'Active'),
 ('Henrico Business License','Business License','Henrico County','VA','BL-2026-8841', NULL, CURRENT_DATE - 210, CURRENT_DATE + 148, 0, 350, 'Active')
ON CONFLICT DO NOTHING;

INSERT INTO ceu_records (course_name, provider, category, employee_id, ceu_hours, completion_date, approved_for_renewal, cost) VALUES
 ('Standards of Practice Refresher','InterNACHI','Standards of Practice','11111111-1111-1111-1111-111111111102', 4, CURRENT_DATE - 120, true, 0),
 ('Ethics for Inspectors','InterNACHI','Ethics','11111111-1111-1111-1111-111111111102', 2, CURRENT_DATE - 95, true, 0),
 ('Advanced Moisture Diagnostics','ASHI','Technical','11111111-1111-1111-1111-111111111103', 6, CURRENT_DATE - 60, true, 195),
 ('Radon Measurement Update','AARST','Radon','11111111-1111-1111-1111-111111111104', 8, CURRENT_DATE - 380, true, 240),
 ('Report Writing that Sells','HouseMaster','Report Writing','11111111-1111-1111-1111-111111111103', 3, CURRENT_DATE - 25, false, 0)
ON CONFLICT DO NOTHING;

INSERT INTO equipment (id, name, asset_category, make, model, serial_number, asset_tag, status, condition, assigned_employee_id, assigned_vehicle_id, vendor_id, insurance_policy_id, purchase_date, purchase_price, warranty_expiration, requires_calibration, calibration_interval_months, last_calibration_date, next_calibration_due, expected_useful_life_years, estimated_replacement_cost) VALUES
 ('55555555-5555-5555-5555-555555555501','Radon CRM #1','Radon','Sun Nuclear','1027','SN-1027-A','HM-0101','In Service','Good','11111111-1111-1111-1111-111111111104','44444444-4444-4444-4444-444444444403','22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333304','2022-03-14', 3450, '2025-03-14', true, 12, CURRENT_DATE - 358, CURRENT_DATE + 7, 8, 3900),
 ('55555555-5555-5555-5555-555555555502','Radon CRM #2','Radon','Sun Nuclear','1027','SN-1027-B','HM-0102','In Service','Good','11111111-1111-1111-1111-111111111102','44444444-4444-4444-4444-444444444401','22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333304','2022-03-14', 3450, '2025-03-14', true, 12, CURRENT_DATE - 300, CURRENT_DATE + 65, 8, 3900),
 ('55555555-5555-5555-5555-555555555503','Radon CRM #3','Radon','Sun Nuclear','1028','SN-1028-C','HM-0103','Needs Repair','Fair','11111111-1111-1111-1111-111111111104', NULL,'22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333304','2020-08-01', 3100, NULL, true, 12, CURRENT_DATE - 400, CURRENT_DATE - 35, 8, 3900),
 ('55555555-5555-5555-5555-555555555504','Thermal Camera — E8','Moisture / Thermal','FLIR','E8-XT','FE8-99120','HM-0210','In Service','Excellent','11111111-1111-1111-1111-111111111103','44444444-4444-4444-4444-444444444402','22222222-2222-2222-2222-222222222205','33333333-3333-3333-3333-333333333304','2023-11-02', 2795, CURRENT_DATE + 120, true, 24, CURRENT_DATE - 200, CURRENT_DATE + 530, 7, 3200),
 ('55555555-5555-5555-5555-555555555505','Inspection Drone','Drone','DJI','Mavic 3E','DJ3E-44120','HM-0301','In Service','Good','11111111-1111-1111-1111-111111111103','44444444-4444-4444-4444-444444444402','22222222-2222-2222-2222-222222222205','33333333-3333-3333-3333-333333333304','2024-04-18', 4100, CURRENT_DATE + 20, false, NULL, NULL, NULL, 5, 4400),
 ('55555555-5555-5555-5555-555555555506','Combustion Analyzer','Gas / Combustion','Testo','320','TS320-7781','HM-0401','In Service','Good','11111111-1111-1111-1111-111111111102','44444444-4444-4444-4444-444444444401','22222222-2222-2222-2222-222222222202',NULL,'2023-02-09', 1290, NULL, true, 12, CURRENT_DATE - 340, CURRENT_DATE + 25, 6, 1450),
 ('55555555-5555-5555-5555-555555555507','Moisture Meter — Pinless','Moisture / Thermal','Delmhorst','TechScan','DM-88210','HM-0501','In Service','Good','11111111-1111-1111-1111-111111111102', NULL, NULL, NULL,'2023-06-01', 420, NULL, false, NULL, NULL, NULL, 5, 480),
 ('55555555-5555-5555-5555-555555555508','Telescoping Ladder 17ft','Ladders & Access','Werner','MT-17','WR-MT17-2201','HM-0601','In Service','Fair','11111111-1111-1111-1111-111111111103','44444444-4444-4444-4444-444444444402',NULL,NULL,'2021-07-22', 330, NULL, false, NULL, NULL, NULL, 6, 390)
ON CONFLICT DO NOTHING;

INSERT INTO supplies (item_name, category, sku, unit_of_measure, quantity_on_hand, reorder_point, reorder_quantity, unit_cost, vendor_id, storage_location, lot_number, expiration_date) VALUES
 ('Radon charcoal canisters','Radon Consumables','AC-50','each', 34, 40, 100, 4.25,'22222222-2222-2222-2222-222222222203','Office shelf A','LOT-2261', CURRENT_DATE + 95),
 ('Radon tamper seals','Radon Consumables','TS-200','roll', 6, 3, 10, 12.00,'22222222-2222-2222-2222-222222222203','Office shelf A', NULL, NULL),
 ('Chain-of-custody forms','Radon Consumables','COC-100','pad', 2, 4, 12, 8.50,'22222222-2222-2222-2222-222222222203','Office shelf A', NULL, NULL),
 ('Shoe covers','Field Consumables','SC-500','case', 3, 2, 6, 42.00,'22222222-2222-2222-2222-222222222205','Van storage', NULL, NULL),
 ('Yard signs','Marketing','YS-25','each', 18, 10, 25, 11.75,'22222222-2222-2222-2222-222222222205','Office closet', NULL, NULL),
 ('Nitrile gloves','Safety / PPE','NG-100','box', 4, 6, 12, 14.00,'22222222-2222-2222-2222-222222222205','Van storage', NULL, NULL),
 ('Crawlspace coveralls','Safety / PPE','CV-XL','each', 9, 4, 10, 18.50,'22222222-2222-2222-2222-222222222205','Office closet', NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO software_subscriptions (service_name, vendor_id, category, cost, billing_frequency, seats, renewal_date, status, account_owner_id, credential_vault_ref) VALUES
 ('HouseMaster ReportHost', NULL,'Inspection software', 189, 'Monthly', 4, CURRENT_DATE + 12, 'Active','11111111-1111-1111-1111-111111111101','1Password — ReportHost'),
 ('Inspection Support Network', NULL,'Operations', 890, 'Monthly', 6, CURRENT_DATE + 58, 'Active','11111111-1111-1111-1111-111111111101','1Password — ISN'),
 ('CompanyCam', NULL,'Field photos', 79, 'Monthly', 5, CURRENT_DATE + 33, 'Active','11111111-1111-1111-1111-111111111101','1Password — CompanyCam'),
 ('QUO', NULL,'Communications', 145, 'Monthly', 6, CURRENT_DATE + 9, 'Active','11111111-1111-1111-1111-111111111105','1Password — QUO')
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_maintenance (vehicle_id, service_type, service_date, mileage_at_service, cost, vendor_id, next_service_due_date, next_service_due_mileage) VALUES
 ('44444444-4444-4444-4444-444444444401','Oil Change', CURRENT_DATE - 74, 83200, 92.40,'22222222-2222-2222-2222-222222222201', CURRENT_DATE + 26, 91000),
 ('44444444-4444-4444-4444-444444444402','Tires', CURRENT_DATE - 40, 57900, 812.00,'22222222-2222-2222-2222-222222222201', CURRENT_DATE + 300, 90000),
 ('44444444-4444-4444-4444-444444444403','Brakes', CURRENT_DATE - 5, 121600, 640.00,'22222222-2222-2222-2222-222222222201', CURRENT_DATE + 360, 145000)
ON CONFLICT DO NOTHING;

INSERT INTO maintenance_records (equipment_id, service_type, service_date, performed_by, vendor_id, passed, cost, next_due_date, result_notes) VALUES
 ('55555555-5555-5555-5555-555555555502','Calibration', CURRENT_DATE - 300,'Bowser Lab','22222222-2222-2222-2222-222222222202', true, 285, CURRENT_DATE + 65,'Within spec'),
 ('55555555-5555-5555-5555-555555555503','Calibration', CURRENT_DATE - 400,'Bowser Lab','22222222-2222-2222-2222-222222222202', false, 285, CURRENT_DATE - 35,'Drift outside tolerance, returned for service')
ON CONFLICT DO NOTHING;

INSERT INTO claims_incidents (incident_number, incident_type, incident_date, description, status, employee_id, vehicle_id, policy_id, cost_reserve, follow_up_needed, follow_up_date) VALUES
 ('INC-2026-014','Vehicle Accident', CURRENT_DATE - 18,'Backed into a mailbox on a Chesterfield driveway. No injuries.','Under Review','11111111-1111-1111-1111-111111111104','44444444-4444-4444-4444-444444444403','33333333-3333-3333-3333-333333333303', 1200, true, CURRENT_DATE + 6),
 ('INC-2026-015','Client Complaint', CURRENT_DATE - 9,'Client disputes a crawlspace moisture note in the report.','Open','11111111-1111-1111-1111-111111111102', NULL,'33333333-3333-3333-3333-333333333302', 0, true, CURRENT_DATE + 2)
ON CONFLICT DO NOTHING;

INSERT INTO sops (title, category, version, effective_date, owner_id) VALUES
 ('Radon deployment and retrieval','Radon','2.1', CURRENT_DATE - 210,'11111111-1111-1111-1111-111111111101'),
 ('Daily van check','Fleet','1.3', CURRENT_DATE - 90,'11111111-1111-1111-1111-111111111101'),
 ('Report QA before delivery','Inspection','3.0', CURRENT_DATE - 45,'11111111-1111-1111-1111-111111111102'),
 ('Incident and claim intake','Risk','1.0', CURRENT_DATE - 400,'11111111-1111-1111-1111-111111111101')
ON CONFLICT DO NOTHING;

SELECT refresh_compliance();

COMMIT;
