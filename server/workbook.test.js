/** Run with: node server/workbook.test.js
 *
 * A real workbook is written, read back, and planned — the same three steps
 * the office triggers by clicking download, typing, and clicking upload. The
 * awkward parts are all in the joins between them: a sheet name Excel had to
 * truncate, a date that has been through two file formats, and a van naming a
 * driver who is being created three sheets earlier in the same file.
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildWorkbook, sheetName, workbookEntities, importableFields, ID_HEADER, NO_IMPORT }
  from './lib/workbook.js';
import { readSheets, matchSheets, orderEntities, planSheet, pendingNames, cellText, PENDING }
  from './lib/workbookImport.js';
import { matchKey } from './lib/importRows.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const F = (column_name, label, ui_control, extra = {}) => ({
  column_name, label, ui_control, required: false, ref_entity: null, lookup_list: null,
  options: null, ...extra,
});

const EMPLOYEES = {
  key: 'employees', table_name: 'employees', label: 'Employee', label_plural: 'Team',
  title_column: 'full_name',
  fields: [F('full_name', 'Name', 'text', { required: true }), F('email', 'Email', 'email'),
    F('created_at', 'Created', 'readonly')],
};
const VEHICLES = {
  key: 'vehicles', table_name: 'vehicles', label: 'Vehicle', label_plural: 'Fleet',
  title_column: 'unit_number',
  fields: [
    F('unit_number', 'Unit', 'text', { required: true }),
    F('model_year', 'Year', 'integer'),
    F('registration_expiration', 'Registration', 'date'),
    F('status', 'Status', 'select', { lookup_list: 'vehicle_status', options: [
      { value: 'In Service', label: 'In Service' }, { value: 'Out of Service', label: 'Out of Service' }] }),
    F('primary_driver_id', 'Primary driver', 'ref', { ref_entity: 'employees' }),
  ],
};
const EQUIPMENT = {
  key: 'equipment', table_name: 'equipment', label: 'Asset', label_plural: 'Equipment',
  title_column: 'name',
  fields: [F('name', 'Asset', 'text', { required: true }),
    F('assigned_vehicle_id', 'On vehicle', 'ref', { ref_entity: 'vehicles' })],
};
const LEDGER = {
  key: 'radon_custody_events', table_name: 'radon_custody_events', label: 'Custody event',
  label_plural: 'Custody events', title_column: 'event_type', fields: [F('event_type', 'Event', 'text')],
};
const CATALOG = [EQUIPMENT, VEHICLES, EMPLOYEES, LEDGER];

const load = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
};

console.log('\nthe workbook that comes down');

const buffer = await buildWorkbook({
  catalog: CATALOG,
  data: {
    employees: [{ id: 'emp-1', full_name: 'Bobby Hale', email: 'bobby@hm.com' }],
    vehicles: [{ id: 'veh-1', unit_number: '12', model_year: 2019,
      registration_expiration: '2026-03-09', status: 'In Service',
      primary_driver_id: 'emp-1', primary_driver_id__label: 'Bobby Hale' }],
    equipment: [],
  },
  refs: { employees: [{ id: 'emp-1', label: 'Bobby Hale' }], vehicles: [{ id: 'veh-1', label: '12' }] },
  generatedOn: 'August 11, 2026',
});
const book = await load(buffer);

await ta('has a sheet for every screen, and none for the ledgers', async () => {
  const names = book.worksheets.map((w) => w.name);
  assert.ok(names.includes('Team') && names.includes('Fleet') && names.includes('Equipment'));
  assert.ok(!names.includes('Custody events'), 'evidence you can edit is not evidence');
  assert.ok(NO_IMPORT.has('radon_custody_events'));
});

await ta('opens on a sheet that explains itself', async () => {
  assert.equal(book.worksheets[0].name, 'Start here');
  const text = book.worksheets[0].getColumn(2).values.filter(Boolean).join(' ');
  assert.match(text, /id column/);
  assert.match(text, /month first/);
  assert.match(text, /August 11, 2026/);
});

await ta('leads every sheet with the id, and stars what cannot be blank', async () => {
  const head = book.getWorksheet('Fleet').getRow(1).values.filter(Boolean);
  assert.equal(head[0], ID_HEADER);
  assert.ok(head.includes('Unit *'), 'required columns are starred');
  assert.ok(head.includes('Year'));
});

await ta('brings the rows down filled in, with pointers as names', async () => {
  const ws = book.getWorksheet('Fleet');
  const row = ws.getRow(2).values.filter((x) => x !== undefined && x !== null);
  assert.ok(row.includes('veh-1'), 'the row carries its own id');
  assert.ok(row.includes('12'));
  assert.ok(row.includes('Bobby Hale'), 'the driver is a name, not a uuid');
});

await ta('puts a real dropdown on the choice columns', async () => {
  const ws = book.getWorksheet('Fleet');
  const at = ws.getRow(1).values.indexOf('Status');
  const v = ws.getCell(3, at).dataValidation;   // a row nobody has typed in yet
  assert.equal(v?.type, 'list');
  assert.match(v.formulae[0], /Choices!/);
  assert.equal(v.errorStyle, 'stop', 'a bad choice is refused in the cell, not on upload');
});

await ta('hides the list of choices rather than leaving it as a sheet', async () => {
  assert.equal(book.getWorksheet('Choices').state, 'veryHidden');
});

console.log('\nthe workbook that comes back');

const sheets = readSheets(book);

t('skips the hidden choices sheet when reading', () => {
  assert.ok(!sheets.some((s) => s.name === 'Choices'));
});

t('matches sheets to screens, and says what it did not recognise', () => {
  const withStray = [...sheets, { name: 'My notes', header: ['a'], rows: [['1']] }];
  const { matched, unknown, empty } = matchSheets(withStray, CATALOG);
  assert.deepEqual(unknown, ['My notes']);
  assert.ok(matched.some((m) => m.entity.key === 'vehicles'));
  assert.ok(empty.includes('Equipment'), 'a sheet with no rows is untouched, not emptied');
});

t('pulls the id column out so it is never written as a field', () => {
  const { matched } = matchSheets(sheets, CATALOG);
  const fleet = matched.find((m) => m.entity.key === 'vehicles');
  assert.ok(!fleet.header.some((h) => h.toLowerCase().startsWith('id')));
  assert.deepEqual(fleet.ids, ['veh-1']);
});

t('reads a date back as the day somebody typed', () => {
  // Through a JS Date, into xlsx, and back out. A timezone slip here moves a
  // registration expiry by a day and nothing on screen looks wrong.
  const { matched } = matchSheets(sheets, CATALOG);
  const fleet = matched.find((m) => m.entity.key === 'vehicles');
  const at = fleet.header.indexOf('Registration');
  assert.equal(fleet.rows[0][at], '2026-03-09');
});

t('turns Excel\'s awkward cells into text', () => {
  assert.equal(cellText({ richText: [{ text: 'Radon ' }, { text: 'monitor' }] }), 'Radon monitor');
  assert.equal(cellText({ formula: 'A1&B1', result: 'RM-1181' }), 'RM-1181');
  assert.equal(cellText({ text: 'hm.com', hyperlink: 'https://hm.com' }), 'hm.com');
  assert.equal(cellText(null), '');
  assert.equal(cellText(true), 'Yes');
});

console.log('\nthe order sheets are written in');

t('writes whoever is pointed at first', () => {
  const order = orderEntities(workbookEntities(CATALOG)).map((e) => e.key);
  assert.ok(order.indexOf('employees') < order.indexOf('vehicles'), 'drivers before vans');
  assert.ok(order.indexOf('vehicles') < order.indexOf('equipment'), 'vans before what is on them');
});

t('does not wait for itself when a screen points at its own kind', () => {
  const selfy = { ...EMPLOYEES, fields: [...EMPLOYEES.fields,
    F('manager_id', 'Manager', 'ref', { ref_entity: 'employees' })] };
  const order = orderEntities([selfy, VEHICLES]).map((e) => e.key);
  assert.deepEqual(order, ['employees', 'vehicles']);
});

t('still returns every screen when two point at each other', () => {
  const a = { key: 'a', label_plural: 'A', title_column: 'n', fields: [F('b_id', 'B', 'ref', { ref_entity: 'b' })] };
  const b = { key: 'b', label_plural: 'B', title_column: 'n', fields: [F('a_id', 'A', 'ref', { ref_entity: 'a' })] };
  assert.deepEqual(orderEntities([a, b]).map((e) => e.key).sort(), ['a', 'b']);
});

console.log('\nwhat a filled-in sheet would do');

const plan = (entity, header, rows, opts = {}) =>
  planSheet({ entity, header, rows, ...opts });

t('an untouched row that came down is an update, not a second van', () => {
  const p = plan(VEHICLES, ['Unit', 'Year'], [['12', '2019']], {
    ids: ['veh-1'], existingIds: new Set(['veh-1']),
    existingByTitle: new Map([[matchKey('12'), 'veh-1']]),
  });
  assert.equal(p.rows[0].action, 'update');
  assert.equal(p.rows[0].matchId, 'veh-1');
});

t('a renamed row still updates, because the id says which one it is', () => {
  const p = plan(VEHICLES, ['Unit'], [['12A']], {
    ids: ['veh-1'], existingIds: new Set(['veh-1']),
    existingByTitle: new Map([[matchKey('12'), 'veh-1']]),
  });
  assert.equal(p.rows[0].action, 'update');
  assert.equal(p.rows[0].values.unit_number, '12A');
});

t('a row typed underneath with no id is new', () => {
  const p = plan(VEHICLES, ['Unit'], [['14']], {
    ids: [''], existingIds: new Set(['veh-1']),
    existingByTitle: new Map([[matchKey('12'), 'veh-1']]),
  });
  assert.equal(p.rows[0].action, 'create');
});

t('stops somebody adding a second van called 12', () => {
  const p = plan(VEHICLES, ['Unit'], [['12']], {
    ids: [''], existingIds: new Set(['veh-1']),
    existingByTitle: new Map([[matchKey('12'), 'veh-1']]),
  });
  assert.equal(p.rows[0].action, 'problem');
  assert.match(p.rows[0].errors[0].message, /already on file/);
  // The likeliest cause is a workbook uploaded once already, so the message
  // has to send them for a fresh one rather than to hunt for a duplicate.
  assert.match(p.rows[0].errors[0].message, /download a fresh one/);
});

t('refuses an id that is not on file', () => {
  const p = plan(VEHICLES, ['Unit'], [['14']], { ids: ['made-up'], existingIds: new Set(['veh-1']) });
  assert.equal(p.rows[0].action, 'problem');
  assert.match(p.rows[0].errors[0].message, /not on file/);
});

t('refuses two rows carrying the same id', () => {
  // What a copied row looks like, and it would otherwise write twice to one
  // record with the last one silently winning.
  const p = plan(VEHICLES, ['Unit'], [['12'], ['12B']], {
    ids: ['veh-1', 'veh-1'], existingIds: new Set(['veh-1']),
  });
  assert.equal(p.rows[1].action, 'problem');
  assert.match(p.rows[1].errors[0].message, /same id is on line 2/);
});

console.log('\npointing at something in the same file');

t('finds the names being created on another sheet', () => {
  const teamSheet = {
    entity: EMPLOYEES, sheet: 'Team',
    header: ['Name', 'Email'],
    rows: [['Dana Moss', 'dana@hm.com'], ['Bobby Hale', 'bobby@hm.com']],
    ids: ['', 'emp-1'],   // Dana is new, Bobby came down
  };
  assert.deepEqual(pendingNames(EMPLOYEES, [teamSheet]), ['Dana Moss']);
});

t('lets a van name a driver from the same upload', () => {
  // Without this the workbook would fail its own preview: Dana is real, she
  // just has not been written yet.
  const index = new Map([[matchKey('Dana Moss'), PENDING]]);
  const p = plan(VEHICLES, ['Unit', 'Primary driver'], [['16', 'Dana Moss']], {
    ids: [''], refIndex: { primary_driver_id: index },
  });
  assert.equal(p.rows[0].action, 'create');
  assert.equal(p.rows[0].values.primary_driver_id, PENDING);
});

t('still refuses a driver who is nowhere at all', () => {
  const p = plan(VEHICLES, ['Unit', 'Primary driver'], [['16', 'Nobody Here']], {
    ids: [''], refIndex: { primary_driver_id: new Map() },
  });
  assert.equal(p.rows[0].action, 'problem');
  assert.match(p.rows[0].errors[0].message, /No primary driver called/);
});

console.log('\nsheet names');

t('fits a long screen name into what Excel allows', () => {
  const long = { key: 'x', label_plural: 'Licenses & Certifications and then some more words',
    title_column: 'n', fields: [] };
  assert.ok(sheetName(long).length <= 31);
});

t('strips the characters Excel will not take in a name', () => {
  assert.equal(sheetName({ label_plural: 'Calibration / Service [2]', key: 'x' }),
    'Calibration   Service  2');
});

t('names sheets the same way on the way out and the way back', () => {
  // Matching is by name, so the generator and the reader agreeing is what
  // makes the round trip work at all.
  const entity = { key: 'licenses', label_plural: 'Licenses & Certifications', title_column: 'n', fields: [] };
  const { matched } = matchSheets(
    [{ name: sheetName(entity), header: ['Name'], rows: [['x']] }], [entity]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].entity.key, 'licenses');
});

console.log(`\n${pass} checks passed\n`);
