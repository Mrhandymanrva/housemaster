import { Router } from 'express';
import { q } from '../lib/db.js';
import { getCatalog, getEntity } from '../catalog/sync.js';
import { wrap, bad, notFound } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';

const r = Router();
const ident = (s) => `"${String(s).replace(/"/g, '')}"`;

/** Every column name that reaches SQL is checked against the catalog first. */
function columns(entity) {
  return new Set(entity.fields.map((f) => f.column_name));
}

r.get('/catalog', requireAuth, wrap(async (_req, res) => {
  res.json({ entities: await getCatalog() });
}));

// ---------------------------------------------------------------- list
r.get('/:entity', requireAuth, wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound(`No screen called "${req.params.entity}"`);
  const cols = columns(e);

  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const params = [];
  const where = [];

  // free-text search across the entity's search columns
  if (req.query.search && e.search_columns?.length) {
    params.push(`%${req.query.search}%`);
    const p = `$${params.length}`;
    where.push(
      '(' + e.search_columns.map((c) => `t.${ident(c)}::text ILIKE ${p}`).join(' OR ') + ')'
    );
  }

  // filters: ?f=column:op:value  (op = eq, ne, lt, gt, lte, gte, like, null, notnull)
  const raw = [].concat(req.query.f || []);
  for (const spec of raw) {
    const [col, op, ...rest] = String(spec).split(':');
    const val = rest.join(':');
    if (!cols.has(col)) throw bad(`Unknown column "${col}"`);
    const ops = { eq: '=', ne: '<>', lt: '<', gt: '>', lte: '<=', gte: '>=' };
    if (op === 'null') { where.push(`t.${ident(col)} IS NULL`); continue; }
    if (op === 'notnull') { where.push(`t.${ident(col)} IS NOT NULL`); continue; }
    if (op === 'like') { params.push(`%${val}%`); where.push(`t.${ident(col)}::text ILIKE $${params.length}`); continue; }
    if (!ops[op]) throw bad(`Unknown filter "${op}"`);
    params.push(val);
    where.push(`t.${ident(col)} ${ops[op]} $${params.length}`);
  }

  // sort
  let sort = e.default_sort;
  if (req.query.sort) {
    const [col, dir] = String(req.query.sort).split(':');
    if (!cols.has(col)) throw bad(`Cannot sort by "${col}"`);
    sort = `${col} ${dir === 'desc' ? 'desc' : 'asc'}`;
  }
  const [sortCol, sortDir] = sort.split(/\s+/);

  // resolve reference columns to a readable label in one pass
  const refSelects = [];
  const joins = [];
  const cat = await getCatalog();
  e.fields.filter((f) => f.ui_control === 'ref' && f.ref_entity).forEach((f, i) => {
    const target = cat.find((x) => x.key === f.ref_entity);
    if (!target) return;
    const alias = `r${i}`;
    joins.push(`LEFT JOIN ${ident(target.table_name)} ${alias} ON ${alias}.id = t.${ident(f.column_name)}`);
    refSelects.push(`${alias}.${ident(target.title_column)} AS ${ident(f.column_name + '__label')}`);
  });

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT t.*${refSelects.length ? ',\n           ' + refSelects.join(',\n           ') : ''}
      FROM ${ident(e.table_name)} t
      ${joins.join('\n      ')}
      ${whereSql}
     ORDER BY t.${ident(sortCol)} ${sortDir} NULLS LAST
     LIMIT ${limit} OFFSET ${offset}`;

  const [rows, count] = await Promise.all([
    q(sql, params),
    q(`SELECT count(*)::int AS n FROM ${ident(e.table_name)} t ${whereSql}`, params),
  ]);

  res.json({ entity: e.key, total: count.rows[0].n, limit, offset, rows: rows.rows });
}));

// -------------------------------------------------------------- one row
r.get('/:entity/:id', requireAuth, wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound();
  const { rows } = await q(`SELECT * FROM ${ident(e.table_name)} WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound();
  const files = await q(
    `SELECT id, kind, filename, mime_type, byte_size, created_at
       FROM attachments WHERE entity = $1 AND entity_id = $2 ORDER BY created_at DESC`,
    [e.key, req.params.id]
  );
  res.json({ record: rows[0], attachments: files.rows });
}));

// -------------------------------------------------------------- create
r.post('/:entity', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound();
  const writable = e.fields.filter((f) => f.ui_control !== 'readonly').map((f) => f.column_name);
  const entries = Object.entries(req.body).filter(([k]) => writable.includes(k));
  if (!entries.length) throw bad('Nothing to save');

  const cols = entries.map(([k]) => ident(k)).join(', ');
  const ph = entries.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await q(
    `INSERT INTO ${ident(e.table_name)} (${cols}) VALUES (${ph}) RETURNING *`,
    entries.map(([, v]) => (v === '' ? null : v))
  );
  await audit(req, e.key, rows[0].id, 'create', req.body);
  res.status(201).json({ record: rows[0] });
}));

// -------------------------------------------------------------- update
r.patch('/:entity/:id', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound();
  const writable = e.fields.filter((f) => f.ui_control !== 'readonly').map((f) => f.column_name);
  const entries = Object.entries(req.body).filter(([k]) => writable.includes(k));
  if (!entries.length) throw bad('Nothing to save');

  const set = entries.map(([k], i) => `${ident(k)} = $${i + 1}`).join(', ');
  const vals = entries.map(([, v]) => (v === '' ? null : v));
  vals.push(req.params.id);
  const { rows } = await q(
    `UPDATE ${ident(e.table_name)} SET ${set} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows[0]) throw notFound();
  await audit(req, e.key, req.params.id, 'update', req.body);
  res.json({ record: rows[0] });
}));

// -------------------------------------------------------------- delete
r.delete('/:entity/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound();
  await q(`DELETE FROM ${ident(e.table_name)} WHERE id = $1`, [req.params.id]);
  await audit(req, e.key, req.params.id, 'delete', null);
  res.status(204).end();
}));

// ------------------------------------------- choices for ref controls
r.get('/:entity/_options/list', requireAuth, wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound();
  // These fill a dropdown, not a typeahead, so the whole list has to come
  // back — twenty-five would have quietly hidden the twenty-sixth van.
  const term = `%${req.query.q || ''}%`;
  const limit = Math.min(Number(req.query.limit) || 500, 1000);
  const { rows } = await q(
    `SELECT id, ${ident(e.title_column)} AS label
       FROM ${ident(e.table_name)}
      WHERE ${ident(e.title_column)}::text ILIKE $1
      ORDER BY ${ident(e.title_column)} LIMIT ${limit}`,
    [term]
  );
  res.json({ options: rows, capped: rows.length === limit });
}));

async function audit(req, entity, id, action, diff) {
  await q(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES ($1,$2,$3,$4,$5)`,
    [req.user?.id || null, entity, id, action, diff ? JSON.stringify(diff) : null]
  );
}

export default r;
