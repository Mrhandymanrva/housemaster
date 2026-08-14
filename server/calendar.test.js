/** Run with: node server/calendar.test.js
 *
 * The month, built from orders and nothing else.
 *
 * The long hunt through ISN's API was after one thing orders cannot carry —
 * time somebody has blocked off — and ISN does not expose it. Everything else
 * a calendar needs is already synced: a date, a time and an inspector on every
 * order. These are the checks that it gets drawn honestly.
 *
 * No database. The client is a recording fake, so what is being tested is the
 * shaping, which is where the mistakes live.
 */
import assert from 'node:assert/strict';
import { monthOf, gridOf, initialsOf, calendarMonth, unscheduledOrders } from './lib/calendar.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('\nwhich month');

t('reads the month it was given', () => {
  const m = monthOf('2026-02', new Date('2026-08-14T12:00:00Z'));
  assert.equal(m.id, '2026-02');
  assert.equal(m.label, 'February 2026');
  assert.equal(m.prev, '2026-01');
  assert.equal(m.next, '2026-03');
});

t('steps over the turn of the year in both directions', () => {
  assert.equal(monthOf('2026-01').prev, '2025-12');
  assert.equal(monthOf('2026-12').next, '2027-01');
});

t('falls back to this month rather than blowing up', () => {
  // A bad value in a URL should show somebody this month, not an error page.
  const now = new Date('2026-08-14T12:00:00Z');
  for (const bad of ['', null, 'nonsense', '2026-13', '0000-05', '2026-2']) {
    assert.equal(monthOf(bad, now).id, '2026-08', `${bad}`);
  }
});

t('starts the month at midnight in the office, not in UTC', () => {
  // August in Richmond is four hours behind UTC, so the first of the month
  // begins at 04:00Z. Starting at midnight UTC would pull the last evening of
  // July into August and move a job onto the wrong month.
  const m = monthOf('2026-08');
  assert.equal(m.start.toISOString(), '2026-08-01T04:00:00.000Z');
  assert.equal(m.end.toISOString(), '2026-09-01T04:00:00.000Z');
});

console.log('\nthe shape of the grid');

t('runs Sunday to Saturday in whole weeks', () => {
  const days = gridOf(monthOf('2026-08'));
  assert.equal(days.length % 7, 0, 'always whole weeks');
  assert.equal(days[0].date, '2026-07-26', 'the Sunday on or before the first');
  assert.equal(days[days.length - 1].date, '2026-09-05', 'through to the Saturday after the last');
});

t('marks the days that belong to the months either side', () => {
  const days = gridOf(monthOf('2026-08'));
  assert.equal(days.find((d) => d.date === '2026-07-31').inMonth, false);
  assert.equal(days.find((d) => d.date === '2026-08-01').inMonth, true);
  assert.equal(days.find((d) => d.date === '2026-09-01').inMonth, false);
});

t('does not pad a month out to six rows for the sake of it', () => {
  // February 2027 starts on a Monday and has 28 days. Six rows would leave a
  // trailing empty week that reads as a fortnight with nothing booked.
  const days = gridOf(monthOf('2027-02'));
  assert.equal(days.length, 35);
});

t('takes two letters off a name, and copes with one', () => {
  assert.equal(initialsOf('Brian Slazyk'), 'BS');
  assert.equal(initialsOf('Bobby  Ray  Hazelwood'), 'BR');
  assert.equal(initialsOf('Cher'), 'C');
  assert.equal(initialsOf(''), '');
});

console.log('\nputting the work on it');

const ORDERS = [
  { id: 'o1', order_number: '23495', on_day: '2026-08-03', at_time: '9:00 AM', total_fee: '450',
    employee_id: 'e1', inspector_name: 'Brian Slazyk', property_address: '12 Oak St',
    has_radon: true, order_status: 'Scheduled' },
  { id: 'o2', order_number: '23496', on_day: '2026-08-03', at_time: '1:00 PM', total_fee: '400',
    employee_id: 'e2', inspector_name: 'Randy Lima', property_address: '9 Elm Ave',
    order_status: 'Scheduled' },
  { id: 'o3', order_number: '23497', on_day: '2026-08-04', at_time: '9:00 AM', total_fee: '525',
    employee_id: 'e1', inspector_name: 'Brian Slazyk', property_address: '4 Pine Rd',
    order_status: 'Complete' },
  // On the grid but not in the month — the last Friday of July.
  { id: 'o4', order_number: '23490', on_day: '2026-07-31', at_time: '10:00 AM', total_fee: '300',
    employee_id: 'e2', inspector_name: 'Randy Lima', property_address: '1 Spill Way',
    order_status: 'Complete' },
  // Nobody assigned.
  { id: 'o5', order_number: '23499', on_day: '2026-08-05', at_time: '8:00 AM', total_fee: '380',
    employee_id: null, inspector_name: null, property_address: '77 Gap St',
    order_status: 'Scheduled' },
];

function db({ orders = ORDERS, people = [
  { id: 'e1', full_name: 'Brian Slazyk' },
  { id: 'e2', full_name: 'Randy Lima' },
  { id: 'e3', full_name: 'John Candler' },
] } = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push({ text: text.replace(/\s+/g, ' ').trim(), params: params || [] });
      if (/FROM isn_orders/.test(text)) return { rows: orders };
      if (/FROM employees/.test(text)) return { rows: people };
      return { rows: [] };
    },
  };
}

const cellOf = (cal, date) => cal.weeks.flat().find((c) => c.date === date);

await ta('puts every job on the day it is scheduled for', async () => {
  const cal = await calendarMonth(db(), '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  assert.equal(cellOf(cal, '2026-08-03').jobs, 2);
  assert.equal(cellOf(cal, '2026-08-04').jobs, 1);
  assert.equal(cellOf(cal, '2026-08-06').jobs, 0);
  assert.deepEqual(cellOf(cal, '2026-08-03').items.map((i) => i.initials), ['BS', 'RL']);
});

await ta('asks for the whole grid, not just the month', async () => {
  // A job on a spillover square is real work on somebody's Monday. Querying
  // only the month would leave the square blank and the week looking free.
  const c = db();
  const cal = await calendarMonth(c, '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const asked = c.seen.find((x) => /FROM isn_orders/.test(x.text));
  assert.equal(asked.params[0].toISOString(), '2026-07-26T04:00:00.000Z');
  assert.equal(asked.params[1].toISOString(), '2026-09-06T04:00:00.000Z');
  assert.equal(cellOf(cal, '2026-07-31').jobs, 1, 'and the spillover job is shown');
});

await ta("counts only the month's own days in the month's totals", async () => {
  // Otherwise a total changes depending on which month you were looking at
  // when you read it.
  const cal = await calendarMonth(db(), '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  assert.equal(cal.totals.jobs, 4, 'the July job is drawn but not counted');
  assert.equal(cal.totals.booked, 450 + 400 + 525 + 380);
  assert.equal(cal.totals.workingDays, 3);
  assert.equal(cal.totals.radon, 1);
});

await ta('gives a job with nobody on it its own name rather than dropping it', async () => {
  const cal = await calendarMonth(db(), '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const orphan = cellOf(cal, '2026-08-05').items[0];
  assert.equal(orphan.unassigned, true);
  assert.equal(orphan.inspector, 'Nobody assigned');
  assert.equal(cal.totals.unassigned, 1);
  assert.equal(cal.inspectors[cal.inspectors.length - 1].unassigned, true, 'and it sorts last');
});

await ta('offers a quiet inspector in the filter', async () => {
  // John Candler has nothing booked. Listing only people with work would hide
  // exactly the person somebody is looking for a slot for.
  const cal = await calendarMonth(db(), '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const john = cal.inspectors.find((p) => p.name === 'John Candler');
  assert.ok(john, 'still in the list');
  assert.equal(john.jobs, 0);
});

await ta('adds up each day by inspector', async () => {
  const cal = await calendarMonth(db(), '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const day = cellOf(cal, '2026-08-03');
  assert.deepEqual(day.byInspector.map((p) => [p.initials, p.jobs]), [['BS', 1], ['RL', 1]]);
  const brian = cal.inspectors.find((p) => p.name === 'Brian Slazyk');
  assert.equal(brian.jobs, 2);
  assert.equal(brian.booked, 975);
});

await ta('puts the work on the month when the day arrives as a Date', async () => {
  // What emptied the calendar in production while all sixteen of these passed.
  // A Postgres `date` column is decoded into a JS Date, not a string, so
  // String(on_day) reads "Mon Aug 03 2026 00:00:00 GMT+0000", matches no
  // square, and every job is dropped without a word. The fake handed back
  // strings because strings were convenient — which is why nothing caught it.
  const asDriver = (d) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1,
    Number(d.slice(8, 10)));
  const cal = await calendarMonth(
    db({ orders: ORDERS.map((o) => ({ ...o, on_day: asDriver(o.on_day) })) }),
    '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  assert.equal(cellOf(cal, '2026-08-03').jobs, 2);
  assert.equal(cal.totals.jobs, 4);
});

await ta('asks Postgres for the day as text, so it cannot come back a Date', async () => {
  const c = db();
  await calendarMonth(c, '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const asked = c.seen.find((x) => /FROM isn_orders/.test(x.text));
  assert.match(asked.text, /to_char\(o\.scheduled_start AT TIME ZONE \$3, 'YYYY-MM-DD'\) AS on_day/);
});

await ta('leaves out work that is not work', async () => {
  const c = db();
  await calendarMonth(c, '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const asked = c.seen.find((x) => /FROM isn_orders/.test(x.text));
  // Folded and trimmed, so "unscheduled" cannot slip past a filter that was
  // looking for "Unscheduled" — see orderStatus.test.js.
  assert.match(asked.text, /lower\(btrim\(coalesce\(o\.order_status/);
  assert.match(asked.text, /NOT IN \('canceled','cancelled','deleted','unscheduled'\)/);
  assert.match(asked.text, /scheduled_start IS NOT NULL/);
});

await ta('reads the day off the office clock', async () => {
  // A 7pm inspection must not appear on tomorrow because the server thinks in
  // UTC. The day comes out of Postgres already converted, on the zone passed in.
  const c = db();
  await calendarMonth(c, '2026-08', { now: new Date('2026-08-14T12:00:00Z') });
  const asked = c.seen.find((x) => /FROM isn_orders/.test(x.text));
  assert.equal(asked.params[2], 'America/New_York');
  assert.match(asked.text, /to_char\(o\.scheduled_start AT TIME ZONE \$3, 'YYYY-MM-DD'\)/);
});

console.log('\nwaiting to be booked');

const WAITING = [
  { id: 'u1', order_number: '23501', order_url: 'https://isn/23501', client_name: 'Ana Reyes',
    property_address: '5 Cary St', property_city: 'Richmond', total_fee: '425',
    order_status: 'Unscheduled', scheduled_start: null, booked_on: '2026-07-30', total: 3 },
  { id: 'u2', order_number: '23502', order_url: null, client_name: null,
    property_address: '8 Broad St', property_city: 'Richmond', total_fee: '500',
    order_status: 'Pending', scheduled_start: null, booked_on: null, total: 3 },
  { id: 'u3', order_number: '23503', order_url: null, client_name: 'Kai Brooks',
    property_address: null, property_city: null, total_fee: '0',
    order_status: 'Unscheduled', scheduled_start: '2026-08-20T13:00:00Z',
    booked_on: '2026-08-13', total: 3 },
];

const NOW = new Date('2026-08-14T12:00:00Z');

function waitingDb(rows = WAITING) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push({ text: text.replace(/\s+/g, ' ').trim(), params: params || [] });
      return { rows };
    },
  };
}

await ta('lists what has no day on it, and how long it has waited', async () => {
  const out = await unscheduledOrders(waitingDb(), { now: NOW });
  assert.equal(out.count, 3);
  assert.equal(out.items[0].waitingDays, 15);
  assert.equal(out.items[0].address, '5 Cary St, Richmond');
  assert.equal(out.items[0].fee, 425);
});

await ta('says nothing rather than zero when ISN did not say when it came in', async () => {
  // An unknown wait shown as "0 days" reads as fresh, which is the opposite of
  // what an order sitting with no date usually is.
  const out = await unscheduledOrders(waitingDb(), { now: NOW });
  assert.equal(out.items[1].waitingDays, null);
  assert.equal(out.items[1].bookedOn, null);
});

await ta('falls back to the client when there is no address', async () => {
  const out = await unscheduledOrders(waitingDb(), { now: NOW });
  assert.equal(out.items[2].address, 'Kai Brooks');
});

await ta('keeps the date on an order ISN calls unscheduled', async () => {
  // ISN contradicting itself is worth showing, not quietly resolving.
  const out = await unscheduledOrders(waitingDb(), { now: NOW });
  assert.equal(out.items[2].hadDate, '2026-08-20T13:00:00Z');
});

await ta('asks for orders with no date or an unscheduled status, oldest first', async () => {
  const c = waitingDb();
  await unscheduledOrders(c, { now: NOW });
  const asked = c.seen[0];
  assert.match(asked.text, /scheduled_start IS NULL OR lower\(btrim\(coalesce\(order_status/);
  assert.match(asked.text, /<> 'deleted'/, 'a deleted order is not waiting for anything');
  assert.match(asked.text, /<> 'canceled'/);
  assert.match(asked.text, /ORDER BY \(raw->>'orderdate'\) ASC NULLS LAST/);
});

await ta('is honest about a list longer than it fetched', async () => {
  const out = await unscheduledOrders(waitingDb(WAITING.map((r) => ({ ...r, total: 240 }))),
    { now: NOW });
  assert.equal(out.count, 240, 'the real number');
  assert.equal(out.shown, 3, 'and how many of them are here');
});

await ta('says none rather than blowing up on an empty branch', async () => {
  const out = await unscheduledOrders(waitingDb([]), { now: NOW });
  assert.equal(out.count, 0);
  assert.deepEqual(out.items, []);
});

console.log(`\n${pass} checks passed\n`);
