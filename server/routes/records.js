import { Router } from 'express';
import { q, tx } from '../lib/db.js';
import { getCatalog, getEntity } from '../catalog/sync.js';
import { wrap, bad, notFound } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { parseTable } from '../lib/parseTable.js';
import { planImport, guessMapping, importable, matchKey, AMBIGUOUS } from '../lib/importRows.js';
import { applyPlan } from '../lib/importWrite.js';
import ExcelJS from 'exceljs';
import { buildWorkbook, workbookEntities, NO_IMPORT } from '../lib/workbook.js';
import { readSheets, matchSheets, orderEntities } from '../lib/workbookImport.js';
import { sheetRows, planOne } from '../lib/workbookIo.js';
import { OFFICE_ZONE } from '../lib/zone.js';

const r = Router();
const ident = (s) => `"${String(s).replace(/"/g, '')}"`;

/** Every column name that reaches SQL is checked against the catalog first. */
function columns(entity) {
  return new Set(entity.fields.map((f) => f.column_name));
}

r.get('/catalog', requireAuth, wrap(async (_req, res) => {
  res.json({ entities: await getCatalog() });
}));

// ------------------------------------------------------------ workbook
/*
 * Everything in one file, out and back.
 *
 * Screen-at-a-time importing meant eighteen separate pastes in an order the
 * office had to work out for itself, because a van cannot name a driver who
 * does not exist yet. This is the same import engine with one door: every
 * screen is a sheet, it goes home on a laptop, and the ordering is sorted out
 * at this end.
 */

r.get('/workbook', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const catalog = await getCatalog();
  const entities = workbookEntities(catalog);

  const data = {};
  const refs = {};
  for (const e of entities) {
    data[e.key] = await sheetRows({ query: q }, e, catalog);
    // Choices for the dropdowns: every screen that something points at.
    refs[e.key] = data[e.key].map((row) => ({ id: row.id, label: row[e.title_column] }))
      .filter((x) => x.label);
  }

  const buffer = await buildWorkbook({
    catalog, data, refs,
    generatedOn: new Date().toLocaleDateString('en-US',
      { timeZone: OFFICE_ZONE, month: 'long', day: 'numeric', year: 'numeric' }),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="housemaster-records-${stamp}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

/**
 * The workbook coming back.
 *
 * Sent as base64 in JSON rather than as a file upload: the app already takes
 * photos that way, and one more body shape is one more thing to keep in step.
 */
r.post('/workbook', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const { file, commit = false } = req.body || {};
  if (typeof file !== 'string' || !file) throw bad('No file came through.');

  const buffer = Buffer.from(file.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buffer.length) throw bad('That file is empty.');

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw bad('That is not a workbook this can read. Send the .xlsx it came down as, '
      + 'not a PDF or a CSV.');
  }

  const catalog = await getCatalog();
  const { matched, unknown, empty } = matchSheets(readSheets(wb), catalog);
  if (!matched.length) {
    throw bad('None of the sheets in that file line up with a screen in the app. '
      + 'Download a fresh workbook and fill that one in.');
  }

  // Whoever is pointed at is loaded first, so a van can name a driver who is
  // being added on the Team sheet of this same workbook.
  const order = orderEntities(matched.map((m) => m.entity));
  const sheets = order.map((e) => matched.find((m) => m.entity.key === e.key));

  const plans = [];
  for (const s of sheets) {
    plans.push({ ...s, plan: await planOne({ query: q }, s, sheets, catalog) });
  }

  const body = {
    unknown, empty,
    sheets: plans.map(({ entity, sheet, plan }) => ({
      entity: entity.key, label: entity.label_plural, sheet,
      summary: plan.summary, missingRequired: plan.missingRequired,
      rows: sampleRows(plan.rows),
      truncated: plan.rows.length > SAMPLE,
    })),
    totals: plans.reduce((acc, { plan }) => ({
      create: acc.create + plan.summary.create,
      update: acc.update + plan.summary.update,
      problems: acc.problems + plan.summary.problems,
    }), { create: 0, update: 0, problems: 0 }),
    committed: null,
  };

  if (!commit) return res.json(body);

  if (body.totals.problems) {
    throw bad(`${body.totals.problems} row${body.totals.problems > 1 ? 's have' : ' has'} `
      + 'something wrong. Nothing was saved.');
  }
  const blocked = plans.find(({ plan }) => plan.missingRequired.length && plan.summary.create);
  if (blocked) {
    throw bad(`The ${blocked.sheet} sheet has no ${blocked.plan.missingRequired.join(' or ')} column, `
      + 'and new rows need one. Download a fresh workbook and copy your rows into it.');
  }

  // One transaction for the whole file. Each sheet is planned again against
  // the database as it stands at that moment, so a driver written a step ago
  // is a real id by the time the van that names them is written.
  const done = await tx(async (c) => {
    const out = [];
    for (const s of sheets) {
      const plan = await planOne(c, s, sheets, catalog, { pending: false });
      if (plan.summary.problems) {
        const first = plan.rows.find((x) => x.action === 'problem');
        throw bad(`${s.sheet}, line ${first.line}: ${first.errors[0].message} Nothing was saved.`);
      }
      const counts = await applyPlan(c, {
        table: s.entity.table_name, entityKey: s.entity.key, plan, userId: req.user?.id || null,
      });
      out.push({ sheet: s.sheet, label: s.entity.label_plural, ...counts });
    }
    return out;
  });

  res.json({ ...body, committed: done });
}));

const SAMPLE = 200;

/** Problems first — they are what the office came to the preview to see. */
function sampleRows(rows) {
  return [...rows]
    .sort((a, b) => (a.action === 'problem' ? 0 : 1) - (b.action === 'problem' ? 0 : 1) || a.line - b.line)
    .slice(0, SAMPLE)
    .map(({ line, action, display, errors }) => ({ line, action, display, errors }));
}

// -------------------------------------------------------------- import
/*
 * The quick way in, for a handful of rows on one screen. NO_IMPORT is the same
 * set the workbook leaves out — ledgers, which are records of things the app
 * watched happen and are not editable by either door.
 */
const MAX_ROWS = 2000;

r.post('/:entity/import', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const e = await getEntity(req.params.entity);
  if (!e) throw notFound(`No screen called "${req.params.entity}"`);
  if (NO_IMPORT.has(e.key)) {
    throw bad(`${e.label_plural} are written by the app as things happen, so they cannot be imported.`);
  }

  const { text, mapping, matchOn = null, commit = false } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) throw bad('Nothing was pasted.');

  const parsed = parseTable(text);
  if (parsed.header.length < 1) throw bad('That paste has no heading row.');
  if (!parsed.rows.length) {
    throw bad('That is a heading row with nothing under it. Include the rows as well.');
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw bad(`${parsed.rows.length} rows at once is more than this handles. Paste ${MAX_ROWS} or fewer.`);
  }

  // A mapping the client sends is honoured; the first look at a paste has none,
  // so the headings are matched to fields and the client shows what it guessed.
  const use = Array.isArray(mapping) && mapping.length === parsed.header.length
    ? mapping.map((m) => m || null)
    : guessMapping(parsed.header, e.fields);

  // What each mapped reference column can point at, by name. Read once per
  // column rather than per cell — forty rows naming the same van should not be
  // forty queries.
  const cat = await getCatalog();
  const refIndex = {};
  for (const col of [...new Set(use.filter(Boolean))]) {
    const f = e.fields.find((x) => x.column_name === col);
    if (f?.ui_control !== 'ref' || !f.ref_entity) continue;
    const target = cat.find((x) => x.key === f.ref_entity);
    if (!target) continue;
    const { rows } = await q(
      `SELECT id, ${ident(target.title_column)} AS label FROM ${ident(target.table_name)}`);
    const index = new Map();
    for (const row of rows) {
      const key = matchKey(row.label);
      if (!key) continue;
      // Two vans both called "12" cannot be told apart, and picking either is
      // worse than saying so.
      index.set(key, index.has(key) ? AMBIGUOUS : row.id);
    }
    refIndex[col] = index;
  }

  // Which rows already exist, by whatever column the office is matching on.
  const existing = new Map();
  const matchField = matchOn && e.fields.find((f) => f.column_name === matchOn && importable(f));
  if (matchField && use.includes(matchOn)) {
    const { rows } = await q(
      `SELECT id, ${ident(matchOn)} AS key FROM ${ident(e.table_name)}
        WHERE ${ident(matchOn)} IS NOT NULL`);
    for (const row of rows) existing.set(matchKey(row.key), row.id);
  }

  const plan = planImport({
    fields: e.fields, header: parsed.header, rows: parsed.rows,
    mapping: use, matchOn, refIndex, existing,
  });

  const body = {
    entity: e.key, header: parsed.header, delimiter: parsed.delimiter,
    ...plan, committed: null,
  };

  if (!commit) return res.json(body);

  // ------------------------------------------------------------- writing
  if (plan.summary.problems) {
    throw bad(`${plan.summary.problems} row${plan.summary.problems > 1 ? 's still have' : ' still has'} `
      + 'something wrong with it. Nothing was saved.');
  }
  if (plan.missingRequired.length && plan.summary.create) {
    throw bad(`Every new ${e.label.toLowerCase()} needs ${plan.missingRequired.join(' and ')}. `
      + 'Map a column to it, or match on an existing record instead.');
  }

  // One transaction for the lot. A paste that lands two thirds of the way in
  // is the worst outcome available: the office cannot tell what took without
  // reading all of it, so a failure anywhere takes the whole paste back out.
  const done = await tx((c) => applyPlan(c, {
    table: e.table_name, entityKey: e.key, plan, userId: req.user?.id || null,
  }));

  res.json({ ...body, committed: done });
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
