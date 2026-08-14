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

function db(jobs = [], people = [], { events = [], conn = null, free = [], radon = { out: 0, pending: 0 } } = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push({ text, params: params || [] });
      if (/FROM isn_orders/.test(text)) return { rows: jobs };
      if (/FROM employees/.test(text)) return { rows: people };
      if (/FROM isn_events/.test(text)) return { rows: events };
      if (/FROM isn_connection/.test(text)) return { rows: conn ? [conn] : [{}] };
      if (/FROM isn_availability/.test(text)) return { rows: free };
      return { rows: [radon] };
    },
  };
}

const ASKED = { events_path: '/events', events_kind: 'events',
  events_checked_at: '2026-08-11T14:00:00Z', events_note: '3 from /events' };

const block = (o) => ({
  isn_event_id: o.id, title: o.title, all_day: o.allDay ?? true,
  starts_at: new Date(o.from), ends_at: o.to ? new Date(o.to) : null,
  employee_id: o.who ?? null, inspector_name: o.name ?? null,
});

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

console.log('\nblocked time');

await ta('greys the day somebody is off, on their own row', async () => {
  const out = await weekBoard(db([], [{ id: 'emp-1', full_name: 'Brian Slazyk' }], {
    events: [block({ id: '33398', title: 'Off (Brian Slazyk)', from: '2026-08-13T04:00:00Z', who: 'emp-1' })],
    conn: ASKED,
  }), RANGE);
  const day = out.inspectors[0].days['2026-08-13'];
  assert.equal(day.length, 1);
  assert.equal(day[0].kind, 'block');
  assert.equal(day[0].reason, 'Off', 'the name comes off the reason — the row already says who');
  assert.equal(out.inspectors[0].blocked, 1);
});

await ta('covers every day a multi-day block touches', async () => {
  // "Off" Wednesday to Friday has to grey all three, not just the first.
  const out = await weekBoard(db([], [{ id: 'emp-1', full_name: 'B' }], {
    events: [block({ id: 'e', title: 'PTO (B)', from: '2026-08-12T04:00:00Z', to: '2026-08-14T23:00:00Z', who: 'emp-1' })],
    conn: ASKED,
  }), RANGE);
  const days = Object.entries(out.inspectors[0].days).filter(([, v]) => v.length).map(([d]) => d);
  assert.deepEqual(days, ['2026-08-12', '2026-08-13', '2026-08-14']);
});

await ta('keeps a block that began before the week and runs into it', async () => {
  const out = await weekBoard(db([], [{ id: 'emp-1', full_name: 'B' }], {
    events: [block({ id: 'e', title: 'Off (B)', from: '2026-08-07T04:00:00Z', to: '2026-08-10T23:00:00Z', who: 'emp-1' })],
    conn: ASKED,
  }), RANGE);
  const days = Object.entries(out.inspectors[0].days).filter(([, v]) => v.length).map(([d]) => d);
  assert.ok(days.includes('2026-08-09') && days.includes('2026-08-10'), 'the days inside the week');
  assert.ok(!days.includes('2026-08-07'), 'and nothing outside it');
});

await ta('sets a block nobody could be matched to aside rather than guessing', async () => {
  // Putting it on the wrong row is worse than saying it could not be placed.
  const out = await weekBoard(db([], [{ id: 'emp-1', full_name: 'B' }], {
    events: [block({ id: 'e', title: 'Office closed', from: '2026-08-13T04:00:00Z' })],
    conn: ASKED,
  }), RANGE);
  assert.equal(out.inspectors[0].days['2026-08-13'].length, 0, 'not on somebody else');
  assert.equal(out.blocked.unmatched.length, 1);
  assert.equal(out.blocked.unmatched[0].reason, 'Office closed');
});

await ta('never asked is not the same as asked and nothing blocked', async () => {
  // The difference between "the app has no idea" and "the app checked".
  const never = await weekBoard(db([], [], { conn: {} }), RANGE);
  assert.equal(never.blocked, null, 'nobody has managed to ask ISN');

  const asked = await weekBoard(db([], [], { conn: ASKED, events: [] }), RANGE);
  assert.ok(asked.blocked, 'asked');
  assert.equal(asked.blocked.count, 0, 'and nothing is blocked');
  assert.equal(asked.blocked.path, '/events');
});

console.log('\nwhat ISN can only infer');

await ta('marks a day the inspector cannot take work', async () => {
  const out = await weekBoard(db([], [{ id: 'emp-1', full_name: 'B' }], {
    free: [{ employee_id: 'emp-1', day: '2026-08-10', slots: 4 },
           { employee_id: 'emp-1', day: '2026-08-11', slots: 0 }],
  }), RANGE);
  const days = out.inspectors[0].days;
  assert.equal(days['2026-08-10'].length, 0, 'a day with slots is just an open day');
  assert.equal(days['2026-08-11'][0].kind, 'unavailable');
  assert.equal(days['2026-08-11'][0].reason, 'Not available',
    'and it never claims to know why');
});

await ta('says nothing at all about an inspector it could not ask', async () => {
  // Zero slots across the whole window means the question was wrong for them,
  // not that they are off for two months. Shading it would be the confident
  // kind of wrong.
  const out = await weekBoard(db([], [
    { id: 'emp-1', full_name: 'Asked' }, { id: 'emp-2', full_name: 'Not asked' },
  ], { free: [{ employee_id: 'emp-1', day: '2026-08-10', slots: 2 }] }), RANGE);
  const notAsked = out.inspectors.find((x) => x.name === 'Not asked');
  assert.ok(Object.values(notAsked.days).every((d) => d.length === 0), 'left blank, not shaded');
  assert.ok(!notAsked.availabilityKnown);
});

await ta('does not shade over work that is already booked', async () => {
  const out = await weekBoard(db([
    job({ id: 'a', day: '2026-08-11', who: 'emp-1', name: 'B' }),
  ], [{ id: 'emp-1', full_name: 'B' }], {
    free: [{ employee_id: 'emp-1', day: '2026-08-10', slots: 3 }],
  }), RANGE);
  const day = out.inspectors[0].days['2026-08-11'];
  assert.equal(day.length, 1);
  assert.equal(day[0].kind, 'job', 'a fully booked day is not an unavailable one');
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
