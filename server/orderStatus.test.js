/** Run with: node server/orderStatus.test.js
 *
 * Which orders count as work — one rule, not six copies of it.
 *
 * The rule was written out by hand in six queries as an exact, case-sensitive
 * list. That holds only while ISN writes "Unscheduled" in exactly that case,
 * and it fails in the worst direction when it doesn't: an order ISN calls
 * "unscheduled" walks past a filter looking for "Unscheduled" and lands on the
 * calendar as though somebody had booked it.
 */
import assert from 'node:assert/strict';
import { realWork, statusIs, statusIsNot, NOT_WORK, statusCensus, setStatusRule,
  countsAsRevenue, REVENUE_EXCLUDES } from './lib/orderStatus.js';
import { readFileSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/**
 * Read the predicate the way Postgres would, with a stand-in for the rules
 * table: fold and trim the value, then apply the exclusions.
 */
function wouldKeep(sql, status, excluded = ['canceled', 'cancelled', 'deleted', 'unscheduled']) {
  const v = String(status ?? '').trim().toLowerCase();
  if (!/NOT IN \(SELECT status FROM isn_status_rules WHERE NOT counts_as_work\)/.test(sql)) {
    throw new Error('the exclusions no longer come from the rules table');
  }
  if (excluded.includes(v)) return false;
  // Any literal the caller tacked on, e.g. realWork('', ['complete']).
  for (const m of sql.matchAll(/<> '([^']*)'/g)) if (m[1] === v) return false;
  return true;
}

console.log('\nwhat counts as work');

t('asks the office rather than deciding for itself', () => {
  // The rule used to be a list written in this file, which is a guess at
  // another company's vocabulary — and it was wrong twice. What each of ISN's
  // words means is a fact about how this branch runs, so it lives in a table
  // the owner can see and change.
  assert.match(realWork('o'),
    /NOT IN \(SELECT status FROM isn_status_rules WHERE NOT counts_as_work\)/);
});

t('drops whatever the rules exclude, however it is written', () => {
  const sql = realWork('o');
  for (const s of ['Unscheduled', 'unscheduled', 'UNSCHEDULED', '  Unscheduled  ',
    'Canceled', 'cancelled', 'Deleted']) {
    assert.equal(wouldKeep(sql, s), false, `${JSON.stringify(s)} should not be work`);
  }
});

t('keeps everything else, including a word nobody has ruled on', () => {
  // A new status appearing in ISN shows up on the calendar and gets turned off
  // deliberately. The other way round it would vanish and never be missed.
  const sql = realWork('o');
  for (const s of ['Scheduled', 'Complete', 'In Progress', 'Pending', 'On Hold']) {
    assert.equal(wouldKeep(sql, s), true, `${s} is somebody's booked work`);
  }
});

t('seeds both spellings of cancelled', () => {
  // ISN is American and the office is not. Whichever comes back, it is the
  // same job that is not happening.
  assert.ok(NOT_WORK.includes('canceled') && NOT_WORK.includes('cancelled'));
});

t('folds and trims the column before comparing, and survives a null', () => {
  const sql = realWork('o');
  assert.match(sql, /lower\(btrim\(coalesce\(o\.order_status, ''\)\)\)/);
  // A null status is unknown, not cancelled — coalescing to '' keeps the row
  // rather than making NOT IN return null and dropping it.
  assert.equal(wouldKeep(sql, null), true);
});

t('takes an extra status when a caller needs one', () => {
  assert.equal(wouldKeep(realWork('', ['complete']), 'Complete'), false);
  assert.equal(wouldKeep(realWork(''), 'Complete'), true, 'and not otherwise');
});

t('reads one named status the same forgiving way', () => {
  assert.equal(statusIs('o', 'Complete'),
    "lower(btrim(coalesce(o.order_status, ''))) = 'complete'");
  assert.equal(statusIsNot('', 'Deleted'),
    "lower(btrim(coalesce(order_status, ''))) <> 'deleted'");
});

t('works with and without a table alias', () => {
  assert.match(realWork('o'), /o\.order_status/);
  assert.match(realWork(''), /coalesce\(order_status,/);
});

console.log('\nand nowhere writes it out by hand any more');

t('no query carries its own copy of the status list', () => {
  // Six copies of a rule is six chances for one of them to drift. This is the
  // check that keeps them folded into one.
  const files = ['lib/calendar.js', 'lib/weekBoard.js', 'lib/money.js',
    'lib/revenueCheck.js', 'routes/ops.js'];
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.ok(!/order_status NOT IN \(/.test(src),
      `${f} still writes the status list out by hand`);
  }
});

console.log('\nmoney is not a display preference');

t('revenue has one definition and no switch on it', () => {
  // The switches were wired into the revenue queries as well as the grids.
  // Turning Complete off to tidy up a calendar took 1,406 finished jobs out of
  // the month's takings, silently, and made the number useless. A finished job
  // is revenue. What gets drawn on a calendar is a different question.
  const sql = countsAsRevenue('o');
  assert.ok(!/isn_status_rules/.test(sql), 'no switch reaches this');
  assert.deepEqual(REVENUE_EXCLUDES, ['canceled', 'cancelled', 'deleted', 'unscheduled']);
  assert.match(sql, /lower\(btrim\(coalesce\(o\.order_status, ''\)\)\)/, 'still case-blind');
});

t('no money query can be moved by a switch', () => {
  // The line that must not be crossed again, checked rather than remembered.
  for (const f of ['lib/money.js', 'lib/revenueCheck.js']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.ok(!/realWork/.test(src), `${f} reads the schedule switches`);
    assert.ok(/countsAsRevenue/.test(src), `${f} should define revenue for itself`);
  }
});

t("the dashboard's booked figure is money too", () => {
  // It sits on Home next to schedule counts, which is exactly how it got the
  // wrong filter in the first place.
  const src = readFileSync(new URL('./routes/ops.js', import.meta.url), 'utf8');
  const money = src.slice(src.indexOf('SUM(total_fee) FILTER'), src.indexOf('R.weekStart, R.weekEnd, R.monthStart'));
  assert.match(money, /countsAsRevenue/);
});

console.log('\nwhat ISN actually calls things');

const census = (seen, rules) => ({
  async query(text) {
    if (/FROM isn_status_rules/.test(text)) return { rows: rules };
    return { rows: seen };
  },
});

await ta('lists every status ISN has sent, busiest first', async () => {
  const out = await statusCensus(census([
    { status: 'scheduled', orders: 120, dated: 120, as_written: 'Scheduled', latest: null },
    { status: 'complete', orders: 300, dated: 300, as_written: 'Complete', latest: null },
  ], []));
  assert.deepEqual(out.map((s) => s.status), ['complete', 'scheduled']);
  assert.equal(out[0].asWritten, 'Complete', 'as ISN writes it, so it is recognisable');
  assert.equal(out[0].countsAsWork, true, 'and a status nobody has ruled on is work');
});

await ta('sinks the ones already turned off to the bottom', async () => {
  // The list is for finding a word that should not be on the calendar, so the
  // ones still on it lead.
  const out = await statusCensus(census([
    { status: 'canceled', orders: 90, dated: 90, as_written: 'Canceled', latest: null },
    { status: 'scheduled', orders: 12, dated: 12, as_written: 'Scheduled', latest: null },
  ], [{ status: 'canceled', counts_as_work: false, note: 'Called off.' }]));
  assert.deepEqual(out.map((s) => s.status), ['scheduled', 'canceled']);
  assert.equal(out[1].note, 'Called off.');
});

await ta('shows a rule with no orders behind it rather than hiding it', async () => {
  // Otherwise a rule sits there doing nothing and nobody can tell.
  const out = await statusCensus(census([], [{ status: 'deleted', counts_as_work: false }]));
  assert.equal(out.length, 1);
  assert.equal(out[0].orders, 0);
});

await ta('counts how many carry a date, which is what reaches the calendar', async () => {
  const out = await statusCensus(census([
    { status: 'pending', orders: 20, dated: 3, as_written: 'Pending', latest: null },
  ], []));
  assert.equal(out[0].orders, 20);
  assert.equal(out[0].dated, 3, 'only these could be drawn on a day');
});

await ta('folds a status on the way in, because that is how they are stored', async () => {
  const seen = [];
  await setStatusRule({ async query(text, params) { seen.push(params); return { rows: [] }; } },
    '  PENDING ', false);
  assert.deepEqual(seen[0], ['pending', false]);
});

console.log(`\n${pass} checks passed\n`);
