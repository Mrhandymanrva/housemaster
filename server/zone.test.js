/** Run with: node server/zone.test.js
 *
 * "This week" had a start and no end, so every job booked into the future
 * counted as this week's — which is why the phone read 13 where the office's
 * own board read 8. Every range here is half-open and both ends are pinned.
 */
import assert from 'node:assert/strict';
import { officeRanges, officeParts, fromOfficeWallClock, OFFICE_ZONE } from './lib/zone.js';

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

console.log(`\n${pass} checks passed\n`);
