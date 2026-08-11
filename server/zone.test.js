/** Run with: node server/zone.test.js
 *
 * "This week" had a start and no end, so every job booked into the future
 * counted as this week's — which is why the phone read 13 where the office's
 * own board read 8. Every range here is half-open and both ends are pinned.
 */
import assert from 'node:assert/strict';
import { officeRanges, officeParts, fromOfficeWallClock, periodRange, PERIODS, OFFICE_ZONE }
  from './lib/zone.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const local = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: OFFICE_ZONE, weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
}).format(d);

// Wednesday 5 August 2026, mid-morning in Richmond
const wed = new Date('2026-08-05T15:00:00Z');

console.log('\ntoday');
const r = officeRanges(wed);
t('starts at midnight at the office', () => assert.match(local(r.dayStart), /Aug 5, 12:00 AM/));
t('ends at midnight the next day', () => assert.match(local(r.dayEnd), /Aug 6, 12:00 AM/));
t('is exactly one day long', () => {
  assert.equal(r.dayEnd - r.dayStart, 86400000);
});

console.log('\nthis week');
t('runs Sunday to Sunday, the way the office board reads', () => {
  assert.match(local(r.weekStart), /Sun, Aug 2, 12:00 AM/);
  assert.match(local(r.weekEnd), /Sun, Aug 9, 12:00 AM/);
});
t('is seven days, not open-ended', () => {
  assert.equal(r.weekEnd - r.weekStart, 7 * 86400000);
});
t('today falls inside it', () => {
  assert.ok(wed >= r.weekStart && wed < r.weekEnd);
});
t('next week does not', () => {
  const nextWed = new Date('2026-08-12T15:00:00Z');
  assert.ok(nextWed >= r.weekEnd, 'a job seven days out is not this week');
});

console.log('\nSunday and Saturday are the awkward ones');
t('on a Sunday the week starts that morning', () => {
  const sun = officeRanges(new Date('2026-08-02T15:00:00Z'));
  assert.match(local(sun.weekStart), /Sun, Aug 2/);
  assert.match(local(sun.weekEnd), /Sun, Aug 9/);
});
t('on a Saturday the week still ends the next morning', () => {
  const sat = officeRanges(new Date('2026-08-08T15:00:00Z'));
  assert.match(local(sat.weekStart), /Sun, Aug 2/);
  assert.match(local(sat.weekEnd), /Sun, Aug 9/);
});

console.log('\nthis month');
t('first of the month to first of the next', () => {
  assert.match(local(r.monthStart), /Aug 1, 12:00 AM/);
  assert.match(local(r.monthEnd), /Sep 1, 12:00 AM/);
});
t('December rolls into January', () => {
  const dec = officeRanges(new Date('2026-12-20T15:00:00Z'));
  assert.match(local(dec.monthEnd), /Jan 1, 12:00 AM/);
});

console.log('\nthe clocks changing does not stretch a week');
t('the week the clocks go forward is still seven days', () => {
  // 8 March 2026: 2am becomes 3am, so that day is 23 hours long.
  const w = officeRanges(new Date('2026-03-10T15:00:00Z'));
  assert.equal(w.weekEnd - w.weekStart, 7 * 86400000 - 3600000,
    'seven calendar days, one hour shorter in real time');
  assert.match(local(w.weekStart), /Sun, Mar 8, 12:00 AM/);
  assert.match(local(w.weekEnd), /Sun, Mar 15, 12:00 AM/);
});
t('and the week they go back is still seven days', () => {
  const w = officeRanges(new Date('2026-11-03T15:00:00Z'));
  assert.equal(w.weekEnd - w.weekStart, 7 * 86400000 + 3600000);
  assert.match(local(w.weekStart), /Sun, Nov 1, 12:00 AM/);
});
t('a day that loses an hour still starts at midnight', () => {
  const d = officeRanges(new Date('2026-03-08T18:00:00Z'));
  assert.match(local(d.dayStart), /Mar 8, 12:00 AM/);
  assert.equal(d.dayEnd - d.dayStart, 23 * 3600000);
});

console.log('\nreading the office calendar');
t('the date is the office’s, not the server’s', () => {
  // 1am UTC on the 6th is still the evening of the 5th in Richmond.
  const p = officeParts(new Date('2026-08-06T01:00:00Z'));
  assert.deepEqual([p.year, p.month, p.day], [2026, 8, 5]);
  assert.equal(p.dow, 3, 'Wednesday');
});
t('a wall-clock reading round-trips', () => {
  const d = fromOfficeWallClock({ year: 2026, month: 8, day: 5, hour: 9 });
  assert.match(local(d), /Aug 5, 9:00 AM/);
});

console.log('\nnamed periods');

t('each period starts where you would say it does', () => {
  const at = new Date('2026-08-11T15:00:00Z');   // a Tuesday
  assert.match(local(periodRange('week', at).start), /Sun, Aug 9/);
  assert.match(local(periodRange('month', at).start), /Aug 1/);
  assert.match(local(periodRange('quarter', at).start), /Jul 1/);
  assert.match(local(periodRange('year', at).start), /Jan 1/);
});

t('compares against the same elapsed stretch, not a whole one', () => {
  // Eleven days of August against thirty-one of July reads as a collapse, and
  // somebody would act on it.
  const r = periodRange('month', new Date('2026-08-11T15:00:00Z'));
  assert.match(local(r.priorStart), /Jul 1/);
  assert.match(local(r.priorEnd), /Jul 11/);
  assert.equal(r.priorEnd - r.priorStart, r.elapsed);
});

t('a quarter looks back a quarter, not a month', () => {
  assert.match(local(periodRange('quarter', new Date('2026-08-11T15:00:00Z')).priorStart), /Apr 1/);
});

t('falls back to the month when asked for something it does not know', () => {
  const at = new Date('2026-08-11T15:00:00Z');
  assert.equal(periodRange('fortnight', at).start.getTime(), periodRange('month', at).start.getTime());
  assert.equal(periodRange(undefined, at).period, 'month');
});

t('every period is half-open, contains now, and knows its own length', () => {
  const at = new Date('2026-08-11T15:00:00Z');
  for (const p of PERIODS) {
    const r = periodRange(p, at);
    assert.ok(at >= r.start && at < r.end, p);
    assert.equal(r.total, r.end - r.start, `${p} total`);
  }
});

console.log(`\n${pass} checks passed\n`);
