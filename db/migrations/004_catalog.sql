-- =====================================================================
-- 004_catalog.sql
-- The UI catalog. server/catalog/entities.js is the source of truth and
-- syncs into these tables at boot; rows here hold any label, ordering, or
-- visibility change made from Setup → Screens, and those win on re-sync.
-- =====================================================================
BEGIN;

CREATE TABLE meta_entities (
  key           text PRIMARY KEY,
  table_name    text NOT NULL,
  label         text NOT NULL,
  label_plural  text NOT NULL,
  icon          text NOT NULL DEFAULT 'table',
  nav_group     text NOT NULL DEFAULT 'Records',
  sort_order    int  NOT NULL DEFAULT 100,
  default_sort  text NOT NULL DEFAULT 'created_at desc',
  title_column  text NOT NULL DEFAULT 'name',
  search_columns text[] NOT NULL DEFAULT '{}',
  hidden        boolean NOT NULL DEFAULT false,
  user_modified boolean NOT NULL DEFAULT false
);

CREATE TABLE meta_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key    text NOT NULL REFERENCES meta_entities(key) ON DELETE CASCADE,
  column_name   text NOT NULL,
  label         text NOT NULL,
  data_type     text NOT NULL,     -- text|number|currency|date|bool|uuid|array
  ui_control    text NOT NULL,     -- text|textarea|number|currency|date|toggle|select|ref|readonly
  ref_entity    text,              -- for ui_control='ref'
  lookup_list   text,              -- for ui_control='select'
  required      boolean NOT NULL DEFAULT false,
  show_in_list  boolean NOT NULL DEFAULT false,
  list_order    int NOT NULL DEFAULT 100,
  form_section  text NOT NULL DEFAULT 'Details',
  form_order    int NOT NULL DEFAULT 100,
  width         int,
  format        text,              -- date | money | mileage | phone | mono
  help          text,
  user_modified boolean NOT NULL DEFAULT false,
  UNIQUE (entity_key, column_name)
);

CREATE TABLE saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key  text NOT NULL REFERENCES meta_entities(key) ON DELETE CASCADE,
  name        text NOT NULL,
  owner_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  shared      boolean NOT NULL DEFAULT false,
  filters     jsonb NOT NULL DEFAULT '[]',
  sort        text,
  columns     text[],
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
