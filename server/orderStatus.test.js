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
import { realWork, statusIs, statusIsNot, NOT_WORK } from './lib/orderStatus.js';
import { readFileSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

/**
 * The SQL is a string here, so read it the way Postgres would: fold and trim
 * the value, then check it against the list the predicate carries.
 */
function wouldKeep(sql, status) {
  const list = /NOT IN \(([^)]*)\)/.exec(sql)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  return !list.includes(String(status ?? '').trim().toLowerCase());
}

console.log('\nwhat counts as work');

t('drops the ones that were never work, however they are written', () => {
  const sql = realWork('o');
  for (const s of ['Unscheduled', 'unscheduled', 'UNSCHEDULED', '  Unscheduled  ',
    'Canceled', 'cancelled', 'Deleted']) {
    assert.equal(wouldKeep(sql, s), false, `${JSON.stringify(s)} should not be work`);
  }
});

t('keeps everything else', () => {
  const sql = realWork('o');
  for (const s of ['Scheduled', 'Complete', 'In Progress', 'Pending', 'On Hold']) {
    assert.equal(wouldKeep(sql, s), true, `${s} is somebody's booked work`);
  }
});

t('covers both spellings of cancelled', () => {
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

console.log(`\n${pass} checks passed\n`);
