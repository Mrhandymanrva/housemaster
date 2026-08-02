/** Run with: node field/qa-guard.test.js */
import assert from 'node:assert/strict';
import { decide, validateDeployment, advance, merge } from './qa-guard.js';

const now = new Date('2026-08-02T12:00:00Z');
// fresh(n, local) = the server last said set n was next, then local sets were placed offline
const fresh = (seq, local = 0, days = 1) => ({
  equipmentId: 'q1', name: 'Radon CRM #1', interval: 10,
  completedSets: seq - 1, localSetsSinceSync: local,
  syncedAt: new Date(now - days * 86400000).toISOString(),
});

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('\nthe count');
t('set 9 asks for one monitor', () => {
  const d = decide(fresh(9), now);
  assert.equal(d.requiresDuplicate, false);
  assert.match(d.reason, /due on set 10/);
});
t('set 10 asks for two', () => assert.equal(decide(fresh(10), now).requiresDuplicate, true));
t('set 20 asks for two', () => assert.equal(decide(fresh(20), now).requiresDuplicate, true));
t('sets placed offline move the count', () => {
  assert.equal(decide(fresh(7, 3), now).sequence, 10);
  assert.equal(decide(fresh(7, 3), now).requiresDuplicate, true);
});

console.log('\nwhen it cannot be sure, it takes two');
t('a monitor this phone has never synced', () => {
  const d = decide(null, now);
  assert.equal(d.requiresDuplicate, true);
  assert.equal(d.confident, false);
});
t('a ledger older than two weeks', () => {
  const d = decide(fresh(3, 0, 21), now);
  assert.equal(d.requiresDuplicate, true);
  assert.equal(d.confident, false);
  assert.match(d.reason, /21 days ago/);
});
t('more offline sets than the interval', () => {
  assert.equal(decide(fresh(2, 11), now).confident, false);
  assert.equal(decide(fresh(2, 11), now).requiresDuplicate, true);
});
t('a normal set is confident', () => assert.equal(decide(fresh(4), now).confident, true));

console.log('\nthe submit tap');
const ok = { primary_device: 'q1', duplicate_device: 'q5', duplicate_distance: 4, duplicate_photo: 'blob:1' };
t('a QA set with everything goes', () => {
  assert.equal(validateDeployment(fresh(10), ok, now).ok, true);
});
t('a QA set with no second monitor is blocked', () => {
  const v = validateDeployment(fresh(10), { ...ok, duplicate_device: null }, now);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /second monitor/);
});
t('the same unit twice is blocked', () => {
  const v = validateDeployment(fresh(10), { ...ok, duplicate_device: 'q1' }, now);
  assert.match(v.problems[0], /different unit/);
});
t('units too far apart are blocked', () => {
  const v = validateDeployment(fresh(10), { ...ok, duplicate_distance: 40 }, now);
  assert.match(v.problems[0], /too far apart/);
});
t('no photo of the pair is blocked', () => {
  const v = validateDeployment(fresh(10), { ...ok, duplicate_photo: null }, now);
  assert.match(v.problems[0], /both units/);
});
t('an ordinary set needs none of it', () => {
  assert.equal(validateDeployment(fresh(3), { primary_device: 'q1' }, now).ok, true);
});

console.log('\nafter it is queued');
t('an ordinary set advances the count', () => {
  assert.equal(advance(fresh(4), { placedDuplicate: false }).localSetsSinceSync, 1);
});
t('a duplicate resets the cycle', () => {
  const a = advance(fresh(10), { placedDuplicate: true });
  assert.equal(a.completedSets, 0);
  assert.equal(a.localSetsSinceSync, 0);
  assert.equal(decide(a, now).sequence, 1, 'the cycle starts over at one');
  assert.equal(decide(a, now).requiresDuplicate, false, 'and does not immediately ask again');
});

console.log('\nsyncing');
t('server truth wins but queued sets survive', () => {
  const local = [{ ...fresh(4, 2), dirty: true }];
  const merged = merge(local, [{ equipmentId: 'q1', name: 'Radon CRM #1', sequence: 6, interval: 10 }]);
  assert.equal(merged[0].completedSets, 5, 'server says set 6 is next → five finished');
  assert.equal(merged[0].localSetsSinceSync, 2, 'two unsent sets still count');
  assert.equal(decide(merged[0], now).sequence, 8);
});
t('a clean phone takes the server count as is', () => {
  const merged = merge([{ ...fresh(4, 0) }], [{ equipmentId: 'q1', sequence: 9, interval: 10 }]);
  assert.equal(decide(merged[0], now).sequence, 9);
});

console.log(`\n${pass} checks passed\n`);
