import { entities } from './entities.js';
import { q, tx } from '../lib/db.js';

/**
 * Push the code-defined catalog into meta_entities / meta_fields.
 * Rows an admin has edited in the app (user_modified = true) are left alone,
 * so a deploy never overwrites a label somebody fixed in Setup → Screens.
 */
export async function syncCatalog() {
  await tx(async (c) => {
    for (const e of entities) {
      await c.query(
        `INSERT INTO meta_entities
           (key, table_name, label, label_plural, icon, nav_group, sort_order,
            default_sort, title_column, search_columns)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (key) DO UPDATE SET
           table_name = EXCLUDED.table_name,
           label        = CASE WHEN meta_entities.user_modified THEN meta_entities.label        ELSE EXCLUDED.label END,
           label_plural = CASE WHEN meta_entities.user_modified THEN meta_entities.label_plural ELSE EXCLUDED.label_plural END,
           icon         = CASE WHEN meta_entities.user_modified THEN meta_entities.icon         ELSE EXCLUDED.icon END,
           nav_group    = CASE WHEN meta_entities.user_modified THEN meta_entities.nav_group    ELSE EXCLUDED.nav_group END,
           sort_order   = CASE WHEN meta_entities.user_modified THEN meta_entities.sort_order   ELSE EXCLUDED.sort_order END,
           default_sort = EXCLUDED.default_sort,
           title_column = EXCLUDED.title_column,
           search_columns = EXCLUDED.search_columns`,
        [e.key, e.table, e.label, e.label_plural, e.icon, e.nav_group, e.sort_order,
         e.default_sort, e.title_column, e.search_columns]
      );

      for (const f of e.fields) {
        await c.query(
          `INSERT INTO meta_fields
             (entity_key, column_name, label, data_type, ui_control, ref_entity, lookup_list,
              required, show_in_list, list_order, form_section, form_order, width, format, help)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (entity_key, column_name) DO UPDATE SET
             data_type    = EXCLUDED.data_type,
             ui_control   = EXCLUDED.ui_control,
             ref_entity   = EXCLUDED.ref_entity,
             lookup_list  = EXCLUDED.lookup_list,
             required     = EXCLUDED.required,
             format       = EXCLUDED.format,
             help         = EXCLUDED.help,
             label        = CASE WHEN meta_fields.user_modified THEN meta_fields.label        ELSE EXCLUDED.label END,
             show_in_list = CASE WHEN meta_fields.user_modified THEN meta_fields.show_in_list ELSE EXCLUDED.show_in_list END,
             list_order   = CASE WHEN meta_fields.user_modified THEN meta_fields.list_order   ELSE EXCLUDED.list_order END,
             form_section = CASE WHEN meta_fields.user_modified THEN meta_fields.form_section ELSE EXCLUDED.form_section END,
             form_order   = CASE WHEN meta_fields.user_modified THEN meta_fields.form_order   ELSE EXCLUDED.form_order END,
             width        = CASE WHEN meta_fields.user_modified THEN meta_fields.width        ELSE EXCLUDED.width END`,
          [e.key, f.column_name, f.label, f.data_type, f.ui_control, f.ref_entity, f.lookup_list,
           f.required, f.show_in_list, f.list_order, f.form_section, f.form_order, f.width,
           f.format, f.help]
        );
      }

      // drop catalog rows for columns that no longer exist in code
      await c.query(
        `DELETE FROM meta_fields
          WHERE entity_key = $1 AND column_name <> ALL($2::text[])`,
        [e.key, e.fields.map((f) => f.column_name)]
      );
    }
  });
}

let cache = null;

/**
 * Resolved catalog, DB-authoritative, cached in process.
 *
 * A select field carries `lookup_list` — the name of the list, not its
 * contents — so the choices are resolved and attached here as `options`. That
 * is what the drawer renders, and doing it once at this level means every
 * dropdown in the app is populated by the same code path rather than each
 * screen fetching lists for itself.
 */
export async function getCatalog(force = false) {
  if (cache && !force) return cache;
  const ents = (await q(
    `SELECT * FROM meta_entities WHERE hidden = false ORDER BY sort_order, label_plural`
  )).rows;
  const fields = (await q(`SELECT * FROM meta_fields ORDER BY entity_key, form_order`)).rows;
  const choices = (await q(
    `SELECT list_key, value, label, color FROM lookup_values
      WHERE active ORDER BY list_key, sort, label`
  )).rows;

  const byList = {};
  for (const c of choices) {
    (byList[c.list_key] ||= []).push({ value: c.value, label: c.label, color: c.color });
  }
  const byEntity = {};
  for (const f of fields) {
    (byEntity[f.entity_key] ||= []).push(
      f.lookup_list ? { ...f, options: byList[f.lookup_list] || [] } : f
    );
  }

  cache = ents.map((e) => ({ ...e, fields: byEntity[e.key] || [] }));
  return cache;
}

export const bustCatalog = () => { cache = null; };

export async function getEntity(key) {
  const cat = await getCatalog();
  return cat.find((e) => e.key === key);
}
