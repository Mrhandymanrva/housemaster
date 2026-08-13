/** Run with: node server/weekBoard.test.js
 *
 * The grid behind Home. What matters is not the arithmetic but what refuses to
 * disappear: a job with nobody assigned, an inspector with an empty week, and
 * a job late enough in the evening that reading it in UTC would move it to the
 * next day — which is the bug that had the phone counting a 7pm radon set as
 * tomorrow's work.
 */
import assert from 'node:assert/strict';
import { weekBoard, daysOf } from './lib/weekBoard.js';
import { periodRange } from './lib/zone.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const AT = new Date('2026-08-11T15:00:00Z');   // a Tuesday
const RANGE = periodRange('week', AT);

const job = (o) => ({
  id: o.id, order_number: o.id, order_url: null, total_fee: o.fee ?? '600',
  paid: o.paid ?? false, has_radon: o.radon ?? false,
  order_status: o.status ?? 'Scheduled',
  property_address: o.addr ?? '1 Main St', property_city: 'Richmond', client_name: null,
  scheduled_start: `${o.day}T13:00:00Z`, on_day: o.day, at_time: o.time ?? '9:00 AM',
  employee_id: o.who ?? null, inspector_name: o.name ?? null,
});

function db(jobs = [], people = [], radon = { out: 0, pending: 0 }) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push({ text, params: params || [] });
      if (/FROM isn_orders/.test(text)) return { rows: jobs };
      if (/FROM employees/.test(text)) return { rows: people };
      return { rows: [radon] };
    },
  };
}

console.log('\nthe shape of a week');

t('is seven office days, Sunday to Saturday', () => {
  const d = daysOf(RANGE);
  assert.equal(d.length, 7);
  assert.equal(d[0].weekday, 'Sun');
  assert.equal(d[6].weekday, 'Sat');
  assert.deepEqual(d.map((x) => x.day), [9, 10, 11, 12, 13, 14, 15]);
});

t('is still seven days across a daylight-saving change', () => {
  // The Sunday the clocks go back is 25 hours long. Stepping by 86,400,000ms
  // would land twice on the same date and shed a day off the end.
  const d = daysOf(periodRange('week', new Date('2026-11-03T15:00:00Z')));
  assert.equal(d.length, 7);
  assert.equal(new Set(d.map((x) => x.date)).size, 7, 'no day repeats');
});

console.log('\nwhat must not disappear');

await ta('a job with nobody assigned gets its own row, last', async () => {
  const out = await weekBoard(db([
    job({ id: 'a', day: '2026-08-10', who: 'emp-1', name: 'Bobby Hale' }),
    job({ id: 'b', day: '2026-08-12' }),
  ], [{ id: 'emp-1', full_name: 'Bobby Hale' }]), RANGE);

  const nobody = out.inspectors.find((x) => x.unassigned);
  assert.ok(nobody, 'the row exists');
  assert.equal(nobody.jobs, 1);
  assert.equal(out.inspectors[out.inspectors.length - 1], nobody, 'and it sorts last');
  assert.equal(out.totals.unassigned, 1);
});

await ta('an inspector with an empty week still gets a row', async () => {
  // The thing worth seeing. Dropping empty rows would hide exactly the person
  // somebody should be giving work to.
  const out = await weekBoard(db([], [
    { id: 'emp-1', full_name: 'Bobby Hale' }, { id: 'emp-2', full_name: 'Dana Moss' },
  ]), RANGE);
  assert.equal(out.inspectors.length, 2);
  assert.equal(out.inspectors[0].jobs, 0);
  assert.equal(Object.keys(out.inspectors[0].days).length, 7, 'seven empty days, not none');
});

await ta('an inspector ISN knows but the app has not adopted still shows', async () => {
  const out = await weekBoard(db([
    job({ id: 'a', day: '2026-08-10', who: null, name: 'Tyler Okafor' }),
  ], []), RANGE);
  const tyler = out.inspectors.find((x) => x.name === 'Tyler Okafor');
  assert.ok(tyler, 'named by ISN is named here');
  assert.equal(tyler.unassigned, false, 'and is not confused with nobody');
});

console.log('\nwhat lands where');

await ta('a job lands on the office\'s day, not the server\'s', async () => {
  // 8pm on the 12th in Richmond is the 13th in UTC. Read the wrong way it
  // moves to the next column and both days are then wrong.
  const evening = {
    ...job({ id: 'late', day: '2026-08-12', who: 'emp-1', name: 'Bobby Hale' }),
    scheduled_start: '2026-08-13T00:00:00Z', on_day: '2026-08-12', at_time: '8:00 PM',
  };
  const out = await weekBoard(db([evening], [{ id: 'emp-1', full_name: 'Bobby Hale' }]), RANGE);
  const bobby = out.inspectors[0];
  assert.equal(bobby.days['2026-08-12'].length, 1);
  assert.equal(bobby.days['2026-08-13'].length, 0);
});

await ta('adds a day up and totals the week', async () => {
  const out = await weekBoard(db([
    job({ id: 'a', day: '2026-08-10', fee: '600', who: 'emp-1', name: 'B', status: 'Complete' }),
    job({ id: 'b', day: '2026-08-10', fee: '700', who: 'emp-1', name: 'B', radon: true }),
    job({ id: 'c', day: '2026-08-12', fee: '500', who: 'emp-1', name: 'B' }),
  ], [{ id: 'emp-1', full_name: 'B' }]), RANGE);

  const mon = out.days.find((d) => d.date === '2026-08-10');
  assert.equal(mon.booked, 1300);
  assert.equal(mon.jobs, 2);
  assert.equal(out.totals.booked, 1800);
  assert.equal(out.totals.jobs, 3);
  assert.equal(out.totals.done, 1);
  assert.equal(out.totals.toCome, 2);
  assert.equal(out.totals.radonJobs, 1);
});

await ta('a numeric fee arrives as a number, not the string Postgres sends', async () => {
  const out = await weekBoard(db([job({ id: 'a', day: '2026-08-10', fee: '612.50', who: 'e', name: 'B' })], []), RANGE);
  assert.equal(out.totals.booked, 612.5);
  assert.equal(out.inspectors[0].days['2026-08-10'][0].fee, 612.5);
});

await ta('leaves a place for blocked time rather than implying there is none', async () => {
  const out = await weekBoard(db([], []), RANGE);
  assert.equal(out.blocked, null, 'null, not an empty list that reads as "checked, nothing there"');
});

console.log('\nwhat the database would have refused');

await ta('every statement gets exactly the parameters it declares', async () => {
  const c = db([], []);
  await weekBoard(c, RANGE);
  for (const q of c.seen) {
    const want = Math.max(0, ...[...q.text.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
    assert.equal(q.params.length, want, q.text.replace(/\s+/g, ' ').slice(0, 80));
  }
});

await ta('asks for one week and no more', async () => {
  const c = db([], []);
  await weekBoard(c, RANGE);
  const jobs = c.seen.find((x) => /FROM isn_orders/.test(x.text));
  assert.equal(jobs.params[0], RANGE.start);
  assert.equal(jobs.params[1], RANGE.end);
  assert.equal(RANGE.end - RANGE.start, 7 * 86400000);
});

console.log(`\n${pass} checks passed\n`);
