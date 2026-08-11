/** Run with: node server/import.test.js
 *
 * The importer's whole job is to refuse quietly-wrong data, so most of what is
 * here is bad input: a date that reads fine and means something else, a status
 * the dropdown has never heard of, two rows claiming the same van, a driver
 * who does not work here. Anything that gets past these lands in the records
 * looking exactly like something an admin typed on purpose.
 */
import assert from 'node:assert/strict';
import { parseTable, sniffDelimiter } from './lib/parseTable.js';
import { guessMapping, coerceCell, planImport, matchKey, importable, AMBIGUOUS }
  from './lib/importRows.js';
import { applyPlan } from './lib/importWrite.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
// Anything touching the fake client is async, and a t() that did not await it
// would count a failing assertion as a pass and report the failure separately
// as a stray rejection.
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

// A cut-down fleet screen, shaped exactly like the real catalog rows.
const FIELDS = [
  { column_name: 'unit_number', label: 'Unit', ui_control: 'text', required: true },
  { column_name: 'make', label: 'Make', ui_control: 'text' },
  { column_name: 'model_year', label: 'Year', ui_control: 'integer' },
  { column_name: 'current_mileage', label: 'Mileage', ui_control: 'integer' },
  { column_name: 'purchase_price', label: 'Price', ui_control: 'currency' },
  { column_name: 'registration_expiration', label: 'Registration', ui_control: 'date' },
  { column_name: 'warranty_applies', label: 'Under warranty', ui_control: 'toggle' },
  { column_name: 'status', label: 'Status', ui_control: 'select', options: [
    { value: 'In Service', label: 'In Service' },
    { value: 'Out of Service', label: 'Out of Service' },
  ] },
  { column_name: 'primary_driver_id', label: 'Primary driver', ui_control: 'ref', ref_entity: 'employees' },
  { column_name: 'created_at', label: 'Created', ui_control: 'readonly' },
];

const field = (col) => FIELDS.find((f) => f.column_name === col);

console.log('\nreading the paste');

t('takes what Excel puts on the clipboard, which is tabs', () => {
  const d = parseTable('Unit\tMake\n12\tFord\n14\tRAM');
  assert.equal(d.delimiter, '\t');
  assert.deepEqual(d.header, ['Unit', 'Make']);
  assert.deepEqual(d.rows, [['12', 'Ford'], ['14', 'RAM']]);
});

t('takes a saved csv too, without being told which it is', () => {
  const d = parseTable('Unit,Make\n12,Ford');
  assert.equal(d.delimiter, ',');
  assert.deepEqual(d.rows, [['12', 'Ford']]);
});

t('does not split an address on its own comma', () => {
  // The bug this exists for: comma wins on occurrences, so a tab-separated
  // sheet with "Richmond, VA" in it gets carved into the wrong columns.
  const text = 'Unit\tLocation\n12\tRichmond, VA\n14\tMidlothian, VA';
  assert.equal(sniffDelimiter(text), '\t');
  assert.deepEqual(parseTable(text).rows[0], ['12', 'Richmond, VA']);
});

t('keeps a quoted comma inside its cell', () => {
  const d = parseTable('Item,Where\nMonitor,"Shop, back shelf"');
  assert.deepEqual(d.rows, [['Monitor', 'Shop, back shelf']]);
});

t('keeps a quoted line break inside its cell', () => {
  const d = parseTable('Item,Notes\nMonitor,"cracked case\nstill reads fine"');
  assert.equal(d.rows.length, 1);
  assert.match(d.rows[0][1], /cracked case\nstill reads fine/);
});

t('unescapes a doubled quote', () => {
  assert.deepEqual(parseTable('A\n"he said ""ok"""').rows, [['he said "ok"']]);
});

t('squares off rows Excel left short', () => {
  const d = parseTable('Unit\tMake\tModel\n12\tFord');
  assert.deepEqual(d.rows, [['12', 'Ford', '']]);
});

t('drops blank lines rather than importing them as empty records', () => {
  assert.deepEqual(parseTable('Unit\n12\n\n14\n').rows, [['12'], ['14']]);
});

t('survives windows line endings and a byte-order mark', () => {
  const d = parseTable('﻿Unit\tMake\r\n12\tFord\r\n');
  assert.deepEqual(d.header, ['Unit', 'Make']);
  assert.deepEqual(d.rows, [['12', 'Ford']]);
});

console.log('\nmatching headings to fields');

t('matches on the label, whatever the punctuation and case', () => {
  assert.deepEqual(
    guessMapping(['Unit', 'MAKE', 'Under Warranty'], FIELDS),
    ['unit_number', 'make', 'warranty_applies']
  );
});

t('matches on the column name, for a sheet exported from somewhere else', () => {
  assert.deepEqual(guessMapping(['unit_number', 'model_year'], FIELDS),
    ['unit_number', 'model_year']);
});

t('leaves a heading it does not recognise unmapped rather than guessing', () => {
  assert.deepEqual(guessMapping(['Unit', 'Colour'], FIELDS), ['unit_number', null]);
});

t('never points two columns at the same field', () => {
  assert.deepEqual(guessMapping(['Unit', 'unit_number'], FIELDS), ['unit_number', null]);
});

t('will not map a column the app maintains itself', () => {
  assert.deepEqual(guessMapping(['Created'], FIELDS), [null]);
  assert.equal(importable(field('created_at')), false);
});

console.log('\ndates');
const date = (s) => coerceCell(field('registration_expiration'), s);

t('reads a slashed date month first, the way this office types', () => {
  assert.equal(date('3/9/2026').value, '2026-03-09');
});
t('reads an iso date', () => assert.equal(date('2026-03-09').value, '2026-03-09'));
t('reads a two-digit year', () => assert.equal(date('3/9/26').value, '2026-03-09'));
t('reads a written month', () => {
  assert.equal(date('Jan 5, 2026').value, '2026-01-05');
  assert.equal(date('5 Feb 2026').value, '2026-02-05');
});
t('refuses a day that does not exist instead of rolling into next month', () => {
  // Date(2026, 1, 30) is 2 March, and an expiry two days late is invisible.
  assert.match(date('2/30/2026').error, /not a real date/);
});
t('refuses a month past twelve', () => assert.match(date('13/1/2026').error, /not a/));
t('refuses something that is not a date at all', () => {
  assert.match(date('sometime in spring').error, /not a date/);
});
t('treats an empty cell as nothing to say, not as an error', () => {
  assert.equal(date('').value, null);
});

console.log('\nnumbers');
t('strips the formatting a spreadsheet adds', () => {
  assert.equal(coerceCell(field('purchase_price'), '$32,450.00').value, 32450);
  assert.equal(coerceCell(field('current_mileage'), '112,340').value, 112340);
  assert.equal(coerceCell(field('current_mileage'), '98,000 mi').value, 98000);
});
t('refuses a whole-number column with a fraction in it', () => {
  assert.match(coerceCell(field('current_mileage'), '112340.5').error, /whole number/);
});
t('refuses text in a number column', () => {
  assert.match(coerceCell(field('model_year'), 'unknown').error, /not a number/);
});

console.log('\nyes and no');
t('takes the spellings a spreadsheet actually contains', () => {
  for (const yes of ['Yes', 'y', 'TRUE', '1', 'x']) {
    assert.equal(coerceCell(field('warranty_applies'), yes).value, true, yes);
  }
  for (const no of ['No', 'n', 'false', '0']) {
    assert.equal(coerceCell(field('warranty_applies'), no).value, false, no);
  }
});
t('refuses a maybe', () => {
  assert.match(coerceCell(field('warranty_applies'), 'expired').error, /not a yes or a no/);
});

console.log('\ndropdowns');
t('accepts a choice that is on the list', () => {
  assert.equal(coerceCell(field('status'), 'in service').value, 'In Service');
});
t('refuses one that is not, and says what the choices are', () => {
  const out = coerceCell(field('status'), 'Sold');
  assert.match(out.error, /not on the list/);
  assert.match(out.error, /In Service/);
});

console.log('\npointing at another record');
const drivers = new Map([['bobbyhale', 'emp-1'], ['danamoss', 'emp-2'], ['chrislee', AMBIGUOUS]]);
const ref = (s) => coerceCell(field('primary_driver_id'), s, { refIndex: { primary_driver_id: drivers } });

t('turns a name into the record it means', () => {
  assert.equal(ref('Bobby Hale').value, 'emp-1');
  assert.equal(ref('  bobby hale ').value, 'emp-1');
});
t('refuses a name nobody here has', () => {
  assert.match(ref('Sam Carter').error, /No primary driver called "Sam Carter" yet/);
});
t('refuses a name two people share rather than picking one', () => {
  assert.match(ref('Chris Lee').error, /More than one/);
});

console.log('\nwhat the paste would do');

const HEADER = ['Unit', 'Make', 'Year', 'Status'];
const plan = (rows, opts = {}) => planImport({
  fields: FIELDS, header: HEADER, rows,
  mapping: guessMapping(HEADER, FIELDS),
  ...opts,
});

t('counts new records', () => {
  const p = plan([['12', 'Ford', '2021', 'In Service'], ['14', 'RAM', '2019', 'In Service']]);
  assert.deepEqual(p.summary, { total: 2, create: 2, update: 0, problems: 0 });
  assert.equal(p.rows[0].values.unit_number, '12');
  assert.equal(p.rows[0].values.model_year, 2021);
});

t('updates instead of duplicating when the office matches on a column', () => {
  const p = plan([['12', 'Ford', '2021', 'In Service'], ['14', 'RAM', '2019', 'In Service']], {
    matchOn: 'unit_number',
    existing: new Map([['12', 'veh-1']]),
  });
  assert.deepEqual(p.summary, { total: 2, create: 1, update: 1, problems: 0 });
  assert.equal(p.rows[0].action, 'update');
  assert.equal(p.rows[0].matchId, 'veh-1');
  assert.equal(p.rows[1].action, 'create');
});

t('creates twice over when no match column is chosen', () => {
  // Running the same paste again without matching is how a fleet ends up with
  // two of every van, so this is stated rather than assumed.
  const p = plan([['12', 'Ford', '2021', 'In Service']], { existing: new Map([['12', 'veh-1']]) });
  assert.equal(p.rows[0].action, 'create');
  assert.equal(p.matchOn, null);
});

t('catches two rows claiming the same record before either is written', () => {
  const p = plan([['12', 'Ford', '2021', 'In Service'], ['12', 'RAM', '2019', 'In Service']], {
    matchOn: 'unit_number', existing: new Map(),
  });
  assert.equal(p.summary.problems, 1);
  assert.match(p.rows[1].errors[0].message, /Same as line 2/);
});

t('numbers rows the way the spreadsheet does, heading included', () => {
  const p = plan([['12', 'Ford', '2021', 'In Service']]);
  assert.equal(p.rows[0].line, 2);
});

t('flags a required cell left blank', () => {
  const p = plan([['', 'Ford', '2021', 'In Service']]);
  assert.equal(p.rows[0].action, 'problem');
  assert.match(p.rows[0].errors[0].message, /Unit cannot be blank/);
});

t('says up front when nothing maps to a required field', () => {
  const header = ['Make', 'Year'];
  const p = planImport({ fields: FIELDS, header, rows: [['Ford', '2021']],
    mapping: guessMapping(header, FIELDS) });
  assert.deepEqual(p.missingRequired, ['Unit']);
});

t('keeps a bad cell out of the values it would write', () => {
  const p = plan([['12', 'Ford', 'twenty twenty one', 'In Service']]);
  assert.equal(p.rows[0].action, 'problem');
  assert.equal(p.rows[0].values.model_year, undefined);
  assert.equal(p.rows[0].values.unit_number, '12'); // the good cells still parsed
});

t('refuses a mapping aimed at a column the app maintains', () => {
  const p = planImport({ fields: FIELDS, header: ['Unit', 'Created'],
    rows: [['12', '2020-01-01']], mapping: ['unit_number', 'created_at'] });
  assert.deepEqual(p.mapping, ['unit_number', null]);
  assert.equal(p.rows[0].values.created_at, undefined);
});

t('ignores a match column that is not actually mapped', () => {
  const p = plan([['12', 'Ford', '2021', 'In Service']], { matchOn: 'purchase_price' });
  assert.equal(p.matchOn, null);
});

t('matches names the way the caller indexes them', () => {
  // The route builds its lookups with this; keyed one way and read another,
  // every match silently misses.
  assert.equal(matchKey(' Unit-12 '), matchKey('unit 12'));
});

console.log('\nwriting it down');

/** A database that records what it was asked to do instead of doing it. */
function fakeClient(failOnCall = null) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      if (calls.length === failOnCall) {
        throw new Error('duplicate key value violates unique constraint');
      }
      return { rows: [{ id: `new-${calls.length}` }] };
    },
  };
}

const asPlan = (rows) => ({ rows });

await ta('inserts a new row with its placeholders lined up', async () => {
  const c = fakeClient();
  const out = await applyPlan(c, { table: 'vehicles', entityKey: 'vehicles', userId: 'u1',
    plan: asPlan([{ line: 2, action: 'create', values: { unit_number: '12', model_year: 2021 } }]) });
  assert.deepEqual(out, { created: 1, updated: 0 });
  assert.equal(c.calls[0].text,
    'INSERT INTO "vehicles" ("unit_number", "model_year") VALUES ($1, $2) RETURNING id');
  assert.deepEqual(c.calls[0].params, ['12', 2021]);
});

await ta('updates the row it matched, and only that row', async () => {
  const c = fakeClient();
  const out = await applyPlan(c, { table: 'vehicles', entityKey: 'vehicles',
    plan: asPlan([{ line: 2, action: 'update', matchId: 'veh-1', values: { current_mileage: 98000 } }]) });
  assert.deepEqual(out, { created: 0, updated: 1 });
  assert.equal(c.calls[0].text, 'UPDATE "vehicles" SET "current_mileage" = $1 WHERE id = $2');
  assert.deepEqual(c.calls[0].params, [98000, 'veh-1']);
});

await ta('leaves blank cells alone rather than erasing what is there', async () => {
  // This is what makes a half-filled sheet safe to paste over live records.
  const c = fakeClient();
  await applyPlan(c, { table: 'vehicles', entityKey: 'vehicles',
    plan: asPlan([{ line: 2, action: 'update', matchId: 'veh-1',
      values: { current_mileage: 98000, plate_number: null } }]) });
  assert.equal(c.calls[0].text, 'UPDATE "vehicles" SET "current_mileage" = $1 WHERE id = $2');
  assert.ok(!c.calls[0].text.includes('plate_number'));
});

await ta('skips a row with nothing left in it instead of writing an empty record', async () => {
  const c = fakeClient();
  const out = await applyPlan(c, { table: 'vehicles', entityKey: 'vehicles',
    plan: asPlan([{ line: 2, action: 'create', values: { unit_number: null } }]) });
  assert.deepEqual(out, { created: 0, updated: 0 });
  assert.equal(c.calls.length, 0);
});

await ta('leaves the same audit trail a hand edit would', async () => {
  const c = fakeClient();
  await applyPlan(c, { table: 'vehicles', entityKey: 'vehicles', userId: 'u1',
    plan: asPlan([{ line: 7, action: 'create', values: { unit_number: '12' } }]) });
  const audit = c.calls[1];
  assert.match(audit.text, /INSERT INTO audit_log/);
  assert.equal(audit.params[0], 'u1');
  assert.equal(audit.params[1], 'vehicles');
  assert.equal(audit.params[3], 'create');
  const diff = JSON.parse(audit.params[4]);
  assert.equal(diff.source, 'import');
  assert.equal(diff.line, 7);
});

await ta('names the line when the database refuses one, and says nothing was saved', async () => {
  const c = fakeClient(3);   // the second row's insert
  await assert.rejects(
    applyPlan(c, { table: 'vehicles', entityKey: 'vehicles', plan: asPlan([
      { line: 2, action: 'create', values: { unit_number: '12' } },
      { line: 3, action: 'create', values: { unit_number: '12' } },
    ]) }),
    (err) => /Line 3 could not be saved/.test(err.message) && /Nothing was saved/.test(err.message)
  );
});

console.log(`\n${pass} checks passed\n`);
