/**
 * Reading the workbook back in.
 *
 * There is one import engine, in importRows.js, and this does not duplicate
 * it: every sheet goes through the same planImport that a pasted table does,
 * so a date, a dropdown choice or a missing required field behaves identically
 * whichever door it came in by. What lives here is the three things a single
 * sheet never had to think about.
 *
 * Which sheet is which screen. By the name the generator wrote, so the two
 * agree by construction; a renamed or invented sheet is reported and skipped
 * rather than guessed at.
 *
 * What order to write them in. A van names its driver, an asset names its van.
 * Load the sheets in the order the pointers run and a workbook that introduces
 * a new inspector and the van they drive works in one go — which is the whole
 * reason for doing this as a workbook rather than eighteen pastes.
 *
 * Which row is which record. Every row carries the id it came down with, so
 * an edit is an edit even when the name changed. A row typed underneath with
 * no id is new, and if its name is already on file that is a mistake worth
 * stopping for rather than a second van called 12.
 */
import { planImport, guessMapping, importable, matchKey } from './importRows.js';
import { importableFields, sheetName, workbookEntities, ID_HEADER } from './workbook.js';

/**
 * A reference to something being created further up the same upload.
 *
 * Only ever seen while previewing. The commit re-reads each sheet after the
 * one before it has been written, by which point the real id exists — so this
 * value is never written to a record.
 */
export const PENDING = '__pending__';

const isIdHeader = (h) => String(h || '').trim().toLowerCase().startsWith('id');

/** Excel hands back dates, numbers, formulas and rich text. Records take text. */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Written as a date, read as a date. Taking the UTC parts keeps the day
    // the typist saw — going through the local calendar can move it by one.
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${
      String(value.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    if ('hyperlink' in value) return cellText(value.text ?? value.hyperlink);
    return '';
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).trim();
}

/** Every sheet as a heading row and the rows under it. */
export function readSheets(workbook) {
  const out = [];
  for (const ws of workbook.worksheets) {
    if (ws.state === 'veryHidden') continue;          // the dropdown lists
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = cellText(cell.value); });
    if (!header.filter(Boolean).length) continue;

    const rows = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const cells = [];
      const row = ws.getRow(r);
      for (let c = 1; c <= header.length; c++) cells[c - 1] = cellText(row.getCell(c).value);
      if (cells.some((x) => x !== '')) rows.push(cells);
    }
    out.push({ name: ws.name, header, rows });
  }
  return out;
}

/**
 * Sheets to screens, by the name the generator wrote.
 *
 * An empty sheet is not a matched sheet with nothing in it — it is left out
 * entirely, so "you did not touch Vendors" and "you emptied Vendors" never get
 * confused with each other.
 */
export function matchSheets(sheets, catalog) {
  const byName = new Map(workbookEntities(catalog).map((e) => [sheetName(e).toLowerCase(), e]));
  const matched = [];
  const unknown = [];
  const empty = [];

  for (const sheet of sheets) {
    const name = sheet.name.trim().toLowerCase();
    if (name === 'start here' || name === 'choices') continue;
    const entity = byName.get(name);
    if (!entity) { unknown.push(sheet.name); continue; }
    if (!sheet.rows.length) { empty.push(sheet.name); continue; }

    // The id column is not a field. It is pulled out here and used for
    // matching; leaving it in would have the planner try to write it.
    const idAt = sheet.header.findIndex(isIdHeader);
    matched.push({
      entity,
      sheet: sheet.name,
      header: sheet.header.filter((_, i) => i !== idAt),
      rows: sheet.rows.map((r) => r.filter((_, i) => i !== idAt)),
      ids: idAt < 0 ? sheet.rows.map(() => '') : sheet.rows.map((r) => (r[idAt] || '').trim()),
    });
  }
  return { matched, unknown, empty };
}

/**
 * The order the sheets have to be written in.
 *
 * Whoever is pointed at goes first. Kahn's algorithm over the pointer columns,
 * with self-references ignored — an employee may name their manager, and a
 * sheet cannot wait for itself. A cycle between two screens would deadlock the
 * sort, so anything still standing when nothing is ready is appended in
 * catalog order and left to the reference lookup to complain about.
 */
export function orderEntities(entities) {
  const keys = new Set(entities.map((e) => e.key));
  const needs = new Map(entities.map((e) => [
    e.key,
    new Set(importableFields(e)
      .filter((f) => f.ui_control === 'ref' && f.ref_entity && f.ref_entity !== e.key)
      .map((f) => f.ref_entity)
      .filter((k) => keys.has(k))),
  ]));

  const done = new Set();
  const order = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const e of entities) {
      if (done.has(e.key)) continue;
      if ([...needs.get(e.key)].every((k) => done.has(k))) {
        order.push(e); done.add(e.key); moved = true;
      }
    }
  }
  for (const e of entities) if (!done.has(e.key)) order.push(e);
  return order;
}

/**
 * One sheet's plan, with the id column folded back in.
 *
 * `existingIds` is every id currently on that table; `existingByTitle` maps a
 * record's name to its id. The first decides whether an id is real, the second
 * catches somebody adding a second van called 12 instead of editing the first.
 */
export function planSheet({ entity, header, rows, ids = [], refIndex = {}, existingIds = new Set(), existingByTitle = new Map() }) {
  const mapping = guessMapping(header, entity.fields);
  const plan = planImport({ fields: entity.fields, header, rows, mapping, refIndex });

  const title = entity.title_column;
  const titleField = entity.fields.find((f) => f.column_name === title && importable(f));
  const seenIds = new Map();

  plan.rows.forEach((row, i) => {
    const id = (ids[i] || '').trim();
    const add = (message) => {
      row.errors.push({ column: 'id', label: 'Row', raw: id, message });
      row.action = 'problem';
    };

    if (id) {
      if (seenIds.has(id)) {
        add(`The same id is on line ${seenIds.get(id)}. Two rows cannot be the same record.`);
        return;
      }
      seenIds.set(id, row.line);
      if (!existingIds.has(id)) {
        add('That id is not on file. To add a record, leave the id column empty.');
        return;
      }
      if (row.action !== 'problem') { row.action = 'update'; row.matchId = id; }
      return;
    }

    // No id: a new record. A name already on file is refused rather than
    // matched onto, because names are not unique the way ids are — three
    // assets can honestly be called "Radon monitor", and quietly updating
    // whichever one came first would be worse than stopping.
    //
    // The likeliest cause is not a duplicate at all: it is a workbook that has
    // already been uploaded once. Those rows exist now and carry ids, but this
    // copy still has them blank, so the message says so.
    if (titleField && row.values[title]) {
      const clash = existingByTitle.get(matchKey(row.values[title]));
      if (clash) {
        add(`${row.display[title]} is already on file. If you have uploaded this workbook `
          + 'before, download a fresh one and carry on in that — rows you added last time '
          + 'come back with their id filled in, and this copy still has them blank.');
      }
    }
  });

  plan.summary = {
    total: plan.rows.length,
    create: plan.rows.filter((r) => r.action === 'create').length,
    update: plan.rows.filter((r) => r.action === 'update').length,
    problems: plan.rows.filter((r) => r.action === 'problem').length,
  };
  return plan;
}

/**
 * Names a pointer column may use that are not on file yet, because they are
 * being created further up this same workbook.
 *
 * Without this, a workbook that adds an inspector and the van they drive would
 * fail its own preview — the driver is real, it just has not been written yet.
 */
export function pendingNames(entity, sheets) {
  const sheet = sheets.find((s) => s.entity.key === entity.key);
  if (!sheet) return [];
  const at = guessMapping(sheet.header, entity.fields).indexOf(entity.title_column);
  if (at < 0) return [];
  return sheet.rows
    .map((r, i) => (sheet.ids[i] ? null : (r[at] || '').trim()))   // only rows being created
    .filter(Boolean);
}
