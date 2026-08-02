-- =====================================================================
-- 003_field.sql
-- Field app configuration. Everything the phone shows is a row here,
-- edited from the desktop under Setup → Field App. No app store release
-- is needed to change a form.
-- =====================================================================
BEGIN;

-- A module is one tile on the field app home screen.
CREATE TABLE field_modules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  icon            text NOT NULL DEFAULT 'clipboard',
  accent          text NOT NULL DEFAULT 'steel',
  target_entity   text,        -- catalog entity a submission can write back to
  enabled         boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  require_photo   boolean NOT NULL DEFAULT false,
  require_gps     boolean NOT NULL DEFAULT false,
  require_signature boolean NOT NULL DEFAULT false,
  allow_offline   boolean NOT NULL DEFAULT true,
  auto_apply      boolean NOT NULL DEFAULT false,  -- write back without office review
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field_module_access (
  module_id  uuid NOT NULL REFERENCES field_modules(id) ON DELETE CASCADE,
  app_role   text NOT NULL CHECK (app_role IN ('owner','admin','office','field')),
  can_submit boolean NOT NULL DEFAULT true,
  PRIMARY KEY (module_id, app_role)
);

CREATE TABLE field_forms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id  uuid NOT NULL REFERENCES field_modules(id) ON DELETE CASCADE,
  name       text NOT NULL,
  version    int NOT NULL DEFAULT 1,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, version)
);

CREATE TABLE field_form_fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id        uuid NOT NULL REFERENCES field_forms(id) ON DELETE CASCADE,
  key            text NOT NULL,
  label          text NOT NULL,
  input_type     text NOT NULL CHECK (input_type IN (
                   'text','textarea','number','integer','currency','date','time',
                   'toggle','select','multiselect','photo','signature','barcode',
                   'gps','rating','ref_employee','ref_vehicle','ref_equipment',
                   'ref_supply','ref_vendor','section')),
  required       boolean NOT NULL DEFAULT false,
  help_text      text,
  placeholder    text,
  lookup_list    text REFERENCES lookup_lists(key),
  options        jsonb,          -- inline options when not using a lookup list
  min_value      numeric,
  max_value      numeric,
  visible_if     jsonb,          -- {"field":"passed","equals":false}
  maps_to_column text,           -- write-back target on the module's entity
  sort_order     int NOT NULL DEFAULT 100,
  UNIQUE (form_id, key)
);

-- A completed form from the field
CREATE TABLE field_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES field_modules(id) ON DELETE RESTRICT,
  form_id       uuid NOT NULL REFERENCES field_forms(id) ON DELETE RESTRICT,
  client_uuid   text NOT NULL UNIQUE,   -- offline idempotency key from the device
  submitted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  device_id     text,
  target_entity text,
  target_id     uuid,
  payload       jsonb NOT NULL DEFAULT '{}',
  gps_lat       numeric(9,6),
  gps_lng       numeric(9,6),
  captured_at   timestamptz,             -- when the tech filled it out
  received_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','applied','rejected')),
  applied_at    timestamptz,
  reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note   text
);
CREATE INDEX ON field_submissions (status, received_at DESC);
CREATE INDEX ON field_submissions (target_entity, target_id);

CREATE TRIGGER trg_touch_field_modules BEFORE UPDATE ON field_modules
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_field_forms BEFORE UPDATE ON field_forms
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
