-- =====================================================================
-- HouseMaster of Richmond — Operations Platform
-- 001_core.sql : core operating tables
-- Normalized from housemaster_table_export.csv (16 tables / 383 fields)
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Editable dropdown lists. Replaces Airtable single-selects so the office
-- can add a service type or asset category without a code change.
-- ---------------------------------------------------------------------
CREATE TABLE lookup_lists (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text
);

CREATE TABLE lookup_values (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_key  text NOT NULL REFERENCES lookup_lists(key) ON DELETE CASCADE,
  value     text NOT NULL,
  label     text NOT NULL,
  color     text,
  sort      int  NOT NULL DEFAULT 100,
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (list_key, value)
);

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
CREATE TABLE employees (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            text NOT NULL,
  email                text UNIQUE,
  phone                text,
  job_title            text,
  role                 text NOT NULL DEFAULT 'Inspector',   -- lookup: employee_role
  status               text NOT NULL DEFAULT 'Active',      -- lookup: employee_status
  hire_date            date,
  termination_date     date,
  territory            text,
  home_location        text,
  supervisor_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  dl_number            text,
  dl_expiration        date,
  photo_key            text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON employees (status);
CREATE INDEX ON employees USING gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------
CREATE TABLE ceu_requirements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  license_type          text NOT NULL,                       -- lookup: license_type
  state_jurisdiction    text,
  credits_required      numeric(6,2) NOT NULL DEFAULT 0,
  period_years          int NOT NULL DEFAULT 2,
  renewal_cycle         text,
  special_topics        text,
  renewal_fee           numeric(10,2),
  renewal_url           text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licenses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  license_type          text NOT NULL,                       -- lookup: license_type
  issuing_authority     text,
  state_jurisdiction    text,
  license_number        text,
  employee_id           uuid REFERENCES employees(id) ON DELETE SET NULL,
  ceu_requirement_id    uuid REFERENCES ceu_requirements(id) ON DELETE SET NULL,
  issue_date            date,
  expiration_date       date,
  renewal_date          date,
  renewal_frequency_months int DEFAULT 24,
  ceu_hours_required    numeric(6,2),
  renewal_fee           numeric(10,2),
  renewal_submitted     boolean NOT NULL DEFAULT false,
  renewal_paid          boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'Active',      -- lookup: license_status
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON licenses (employee_id);
CREATE INDEX ON licenses (expiration_date);

CREATE TABLE ceu_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_name           text NOT NULL,
  provider              text,
  category              text,                                -- lookup: ceu_category
  employee_id           uuid REFERENCES employees(id) ON DELETE CASCADE,
  license_id            uuid REFERENCES licenses(id) ON DELETE SET NULL,
  ceu_hours             numeric(6,2) NOT NULL DEFAULT 0,
  completion_date       date NOT NULL,
  expiration_date       date,
  cost                  numeric(10,2),
  paid_by               text,
  approved_for_renewal  boolean NOT NULL DEFAULT false,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ceu_records (employee_id, completion_date DESC);
CREATE INDEX ON ceu_records (license_id);

-- ---------------------------------------------------------------------
-- Vendors / Insurance
-- ---------------------------------------------------------------------
CREATE TABLE vendors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  category       text,                                       -- lookup: vendor_category
  contact_name   text,
  email          text,
  phone          text,
  website        text,
  account_number text,
  payment_terms  text,
  preferred      boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE insurance_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  policy_type     text,                                      -- lookup: policy_type
  policy_number   text,
  carrier         text,
  broker_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  effective_date  date,
  expiration_date date,
  premium_amount  numeric(12,2),
  status          text NOT NULL DEFAULT 'Active',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON insurance_policies (expiration_date);

-- ---------------------------------------------------------------------
-- Fleet
-- ---------------------------------------------------------------------
CREATE TABLE vehicles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number              text NOT NULL,          -- "Van 3" / unit or vehicle name
  make                     text,
  model                    text,
  model_year               int,
  vin                      text UNIQUE,
  plate_number             text,
  plate_state              text DEFAULT 'VA',
  status                   text NOT NULL DEFAULT 'Active',   -- lookup: vehicle_status
  primary_driver_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  insurance_policy_id      uuid REFERENCES insurance_policies(id) ON DELETE SET NULL,
  registration_expiration  date,
  state_inspection_due     date,
  purchase_date            date,
  current_mileage          int,
  last_mileage_update      timestamptz,
  next_oil_change_mileage  int,
  next_service_date        date,
  fuel_card_number         text,
  toll_transponder         text,
  gps_tracker_id           text,
  lease_loan_info          text,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicles (registration_expiration);
CREATE INDEX ON vehicles (primary_driver_id);

-- backup drivers (Airtable's "Backup Driver(s)" multi-link)
CREATE TABLE vehicle_drivers (
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'Backup',
  PRIMARY KEY (vehicle_id, employee_id)
);

CREATE TABLE vehicle_maintenance (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_type           text NOT NULL,                      -- lookup: vehicle_service_type
  service_date           date NOT NULL,
  mileage_at_service     int,
  cost                   numeric(10,2),
  vendor_id              uuid REFERENCES vendors(id) ON DELETE SET NULL,
  next_service_due_date  date,
  next_service_due_mileage int,
  warranty_applies       boolean NOT NULL DEFAULT false,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicle_maintenance (vehicle_id, service_date DESC);

-- ---------------------------------------------------------------------
-- Equipment (radon machines are equipment with requires_calibration = true;
-- see the radon_machines view at the bottom of this file)
-- ---------------------------------------------------------------------
CREATE TABLE equipment (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text NOT NULL,
  asset_category              text NOT NULL DEFAULT 'General', -- lookup: asset_category
  make                        text,
  model                       text,
  serial_number               text,
  asset_tag                   text UNIQUE,
  status                      text NOT NULL DEFAULT 'In Service', -- lookup: asset_status
  condition                   text,
  assigned_employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  assigned_vehicle_id         uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  current_location            text,
  vendor_id                   uuid REFERENCES vendors(id) ON DELETE SET NULL,
  insurance_policy_id         uuid REFERENCES insurance_policies(id) ON DELETE SET NULL,
  purchase_date               date,
  purchase_price              numeric(12,2),
  warranty_expiration         date,
  requires_calibration        boolean NOT NULL DEFAULT false,
  calibration_interval_months int,
  last_calibration_date       date,
  next_calibration_due        date,
  expected_useful_life_years  int,
  replacement_target_date     date,
  estimated_replacement_cost  numeric(12,2),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON equipment (asset_category);
CREATE INDEX ON equipment (next_calibration_due);
CREATE INDEX ON equipment (assigned_employee_id);

-- Unified maintenance + calibration history for equipment
CREATE TABLE maintenance_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id   uuid NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  service_type   text NOT NULL DEFAULT 'Calibration',  -- lookup: equipment_service_type
  service_date   date NOT NULL,
  performed_by   text,
  vendor_id      uuid REFERENCES vendors(id) ON DELETE SET NULL,
  result_notes   text,
  passed         boolean,
  cost           numeric(10,2),
  next_due_date  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON maintenance_records (equipment_id, service_date DESC);

-- Keep equipment calibration dates in step with the record history
CREATE OR REPLACE FUNCTION sync_equipment_calibration() RETURNS trigger AS $$
BEGIN
  IF NEW.service_type = 'Calibration' THEN
    UPDATE equipment e
       SET last_calibration_date = GREATEST(COALESCE(e.last_calibration_date,'1900-01-01'), NEW.service_date),
           next_calibration_due  = COALESCE(
                                     NEW.next_due_date,
                                     NEW.service_date + (COALESCE(e.calibration_interval_months,12) || ' months')::interval
                                   )::date,
           updated_at = now()
     WHERE e.id = NEW.equipment_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_calibration
AFTER INSERT OR UPDATE ON maintenance_records
FOR EACH ROW EXECUTE FUNCTION sync_equipment_calibration();

-- ---------------------------------------------------------------------
-- Supplies + the transaction ledger the export referenced but never defined
-- ---------------------------------------------------------------------
CREATE TABLE supplies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name         text NOT NULL,
  category          text,                                    -- lookup: supply_category
  sku               text,
  unit_of_measure   text NOT NULL DEFAULT 'each',
  quantity_on_hand  numeric(12,2) NOT NULL DEFAULT 0,
  reorder_point     numeric(12,2) NOT NULL DEFAULT 0,
  reorder_quantity  numeric(12,2),
  target_quantity   numeric(12,2),
  unit_cost         numeric(10,2),
  vendor_id         uuid REFERENCES vendors(id) ON DELETE SET NULL,
  storage_location  text,
  expiration_date   date,
  lot_number        text,
  last_count_date   date,
  product_url       text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON supplies (category);

CREATE TABLE inventory_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id    uuid NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  txn_type     text NOT NULL CHECK (txn_type IN ('Receive','Issue','Adjust','Count','Return','Waste')),
  quantity     numeric(12,2) NOT NULL,     -- signed: Issue/Waste negative, Receive positive
  unit_cost    numeric(10,2),
  employee_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  vehicle_id   uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  vendor_id    uuid REFERENCES vendors(id) ON DELETE SET NULL,
  reference    text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON inventory_transactions (supply_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION apply_inventory_txn() RETURNS trigger AS $$
BEGIN
  IF NEW.txn_type = 'Count' THEN
    UPDATE supplies SET quantity_on_hand = NEW.quantity,
                        last_count_date = NEW.occurred_at::date,
                        updated_at = now()
     WHERE id = NEW.supply_id;
  ELSE
    UPDATE supplies SET quantity_on_hand = quantity_on_hand + NEW.quantity,
                        updated_at = now()
     WHERE id = NEW.supply_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_inventory AFTER INSERT ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION apply_inventory_txn();

-- ---------------------------------------------------------------------
-- Claims, software, SOPs
-- ---------------------------------------------------------------------
CREATE TABLE claims_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number   text NOT NULL,
  incident_type     text,                                    -- lookup: incident_type
  claim_number      text,
  incident_date     date NOT NULL,
  description       text,
  status            text NOT NULL DEFAULT 'Open',            -- lookup: claim_status
  employee_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  vehicle_id        uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  equipment_id      uuid REFERENCES equipment(id) ON DELETE SET NULL,
  policy_id         uuid REFERENCES insurance_policies(id) ON DELETE SET NULL,
  cost_reserve      numeric(12,2),
  resolution        text,
  follow_up_needed  boolean NOT NULL DEFAULT false,
  follow_up_date    date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON claims_incidents (status, incident_date DESC);

CREATE TABLE software_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name           text NOT NULL,
  vendor_id              uuid REFERENCES vendors(id) ON DELETE SET NULL,
  category               text,
  subscription_type      text,
  cost                   numeric(12,2),
  billing_frequency      text NOT NULL DEFAULT 'Monthly',
  seats                  int,
  renewal_date           date,
  status                 text NOT NULL DEFAULT 'Active',
  login_url              text,
  credential_vault_ref   text,      -- name of the vault entry only. No secrets in this DB.
  account_owner_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON software_subscriptions (renewal_date);

CREATE TABLE sops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  category           text,
  version            text NOT NULL DEFAULT '1.0',
  effective_date     date,
  owner_id           uuid REFERENCES employees(id) ON DELETE SET NULL,
  last_updated_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  body               text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- One attachment table replaces 20+ Airtable attachment fields
-- ---------------------------------------------------------------------
CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        text NOT NULL,        -- catalog entity key, e.g. 'equipment'
  entity_id     uuid NOT NULL,
  kind          text NOT NULL DEFAULT 'Document', -- Document | Photo | Certificate | Receipt | Signature
  filename      text NOT NULL,
  mime_type     text,
  byte_size     bigint,
  storage_key   text NOT NULL,
  uploaded_by   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON attachments (entity, entity_id);

-- ---------------------------------------------------------------------
-- Auth + audit
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  app_role      text NOT NULL DEFAULT 'field'
                CHECK (app_role IN ('owner','admin','office','field')),
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  action     text NOT NULL,   -- create | update | delete | field_submit
  diff       jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (entity, entity_id, at DESC);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='updated_at'
    WHERE c.relkind='r' AND n.nspname='public'
  LOOP
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Compatibility view: the original "Radon Machines" table.
-- Radon devices live in `equipment` so calibration is tracked one way for
-- every serialized asset. This view keeps the old shape available.
-- ---------------------------------------------------------------------
CREATE VIEW radon_machines AS
SELECT e.id,
       e.name                        AS radon_machine_name,
       e.serial_number,
       e.last_calibration_date,
       e.next_calibration_due,
       e.calibration_interval_months,
       e.status,
       e.assigned_employee_id,
       (e.next_calibration_due - CURRENT_DATE) AS days_until_calibration_due,
       CASE
         WHEN e.next_calibration_due IS NULL THEN 'Unknown'
         WHEN e.next_calibration_due < CURRENT_DATE THEN 'Overdue'
         WHEN e.next_calibration_due < CURRENT_DATE + 30 THEN 'Due Soon'
         ELSE 'Current'
       END AS calibration_status
FROM equipment e
WHERE e.asset_category = 'Radon';

COMMIT;
