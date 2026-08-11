/**
 * The database half of the workbook: what goes into it, and what a filled-in
 * sheet means against what is already on file.
 *
 * Everything takes a client rather than reaching for the pool, for two
 * reasons. The commit runs inside a transaction and has to see the rows it
 * wrote a moment ago — that is what lets a van name a driver added three
 * sheets earlier in the same upload. And it means the whole path can be driven
 * in a harness without a database, which is the only way any of this gets
 * exercised before it meets real records.
 */
import { matchKey, AMBIGUOUS } from './importRows.js';
import { importableFields } from './workbook.js';
import { planSheet, pendingNames, PENDING } from './workbookImport.js';

const ident = (s) => `"${String(s).replace(/"/g, '')}"`;

/** Everything on one screen, with pointer columns resolved to readable names. */
export async function sheetRows(client, entity, catalog, limit = 5000) {
  const joins = [];
  const selects = [];
  entity.fields.filter((f) => f.ui_control === 'ref' && f.ref_entity).forEach((f, i) => {
    const target = catalog.find((x) => x.key === f.ref_entity);
    if (!target) return;
    joins.push(`LEFT JOIN ${ident(target.table_name)} r${i} ON r${i}.id = t.${ident(f.column_name)}`);
    selects.push(`r${i}.${ident(target.title_column)} AS ${ident(f.column_name + '__label')}`);
  });
  const { rows } = await client.query(
    `SELECT t.*${selects.length ? ', ' + selects.join(', ') : ''}
       FROM ${ident(entity.table_name)} t ${joins.join(' ')}
      ORDER BY t.${ident(entity.title_column)} NULLS LAST LIMIT ${limit}`);
  return rows;
}

/** Every record on a screen, by the name it goes by and by its id. */
export async function nameIndex(client, entity) {
  const { rows } = await client.query(
    `SELECT id, ${ident(entity.title_column)} AS label FROM ${ident(entity.table_name)}`);
  const byName = new Map();
  const ids = new Set();
  for (const row of rows) {
    ids.add(row.id);
    const key = matchKey(row.label);
    if (!key) continue;
    // Two vans both called 12 cannot be told apart, and picking either is
    // worse than saying so.
    byName.set(key, byName.has(key) ? AMBIGUOUS : row.id);
  }
  return { byName, ids };
}

/**
 * Plan one sheet against the database as this client sees it.
 *
 * While previewing, a name belonging to a row further up the same workbook
 * counts as resolvable — it is real, it just has not been written yet. While
 * committing it must not, because by then it either exists or it does not.
 */
export async function planOne(client, s, sheets, catalog, { pending = true } = {}) {
  const refIndex = {};
  for (const f of importableFields(s.entity)) {
    if (f.ui_control !== 'ref' || !f.ref_entity) continue;
    const target = catalog.find((x) => x.key === f.ref_entity);
    if (!target) continue;
    const { byName } = await nameIndex(client, target);
    if (pending) {
      for (const name of pendingNames(target, sheets)) {
        const key = matchKey(name);
        if (key && !byName.has(key)) byName.set(key, PENDING);
      }
    }
    refIndex[f.column_name] = byName;
  }

  const mine = await nameIndex(client, s.entity);
  return planSheet({
    entity: s.entity, header: s.header, rows: s.rows, ids: s.ids,
    refIndex, existingIds: mine.ids, existingByTitle: mine.byName,
  });
}
