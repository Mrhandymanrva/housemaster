/** Run with: node server/kitClaim.test.js
 *
 * The dangerous reading of this screen is that an unticked box means "I do not
 * have it, take it off me". Most of the list is somebody else's kit that the
 * tech scrolled straight past, and treating that silence as a hand-back would
 * empty the shop the first time anyone signed for anything. Most of what is
 * here pins down what happens to things nobody said anything about.
 */
import assert from 'node:assert/strict';
import { planClaim, changesAnything } from './lib/kitClaim.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ME = 'emp-me';
const BOBBY = 'emp-bobby';

const ITEMS = [
  { id: 'a', name: 'Radon monitor 1', assigned_employee_id: ME, assigned_vehicle_id: 'van-1',
    condition: 'Good', holder_name: 'Me' },
  { id: 'b', name: 'Radon monitor 2', assigned_employee_id: null, assigned_vehicle_id: null,
    condition: 'Good', holder_name: null },
  { id: 'c', name: 'Bobby ladder', assigned_employee_id: BOBBY, assigned_vehicle_id: 'van-2',
    condition: 'Fair', holder_name: 'Bobby Hale' },
  { id: 'd', name: 'Sewer scope', assigned_employee_id: BOBBY, assigned_vehicle_id: 'van-2',
    condition: 'Good', holder_name: 'Bobby Hale' },
];

const plan = (claimed, vehicleId = 'van-1') =>
  planClaim({ me: ME, items: ITEMS, claimed, vehicleId });

console.log('\nwhat a tick means');

t('picks up something nobody had', () => {
  const p = plan([{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(p.take.map((x) => x.id), ['b']);
  assert.equal(p.take[0].from, null);
  assert.equal(p.release.length, 0);
});

t('takes something off a colleague, and remembers whose it was', () => {
  const p = plan([{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(p.take.map((x) => x.id), ['c']);
  assert.equal(p.take[0].from, BOBBY);
  assert.equal(p.take[0].fromName, 'Bobby Hale');
});

t('leaves alone what was already yours and has not moved', () => {
  const p = plan([{ id: 'a' }]);
  assert.equal(p.take.length, 0);
  assert.equal(p.update.length, 0);
  assert.equal(p.release.length, 0);
  assert.equal(changesAnything(p), false);
});

console.log('\nwhat leaving a box unticked means');

t('hands back your own kit when you say you do not have it', () => {
  const p = plan([]);
  assert.deepEqual(p.release.map((x) => x.id), ['a']);
});

t('does not touch somebody else\'s kit you scrolled past', () => {
  // The one that matters. c and d are Bobby's and unticked; nothing about
  // them may end up in any of the three lists.
  const p = plan([{ id: 'a' }]);
  const touched = [...p.take, ...p.update, ...p.release].map((x) => x.id);
  assert.ok(!touched.includes('c'), 'Bobby kept his ladder');
  assert.ok(!touched.includes('d'), 'Bobby kept his scope');
});

t('does not hand back kit that is spare and unticked', () => {
  const p = plan([{ id: 'a' }]);
  assert.ok(![...p.release].some((x) => x.id === 'b'));
});

console.log('\nthe van and the condition');

t('moves your kit to the van you are in today', () => {
  const p = plan([{ id: 'a' }], 'van-3');
  assert.deepEqual(p.update.map((x) => x.id), ['a']);
  assert.equal(p.vehicleId, 'van-3');
});

t('records a condition you changed on kit already yours', () => {
  const p = plan([{ id: 'a', condition: 'Poor' }]);
  assert.deepEqual(p.update.map((x) => x.id), ['a']);
  assert.equal(p.update[0].condition, 'Poor');
});

t('says nothing changed when the condition is the one already on file', () => {
  const p = plan([{ id: 'a', condition: 'Good' }]);
  assert.equal(changesAnything(p), false);
});

t('carries the condition onto something being picked up', () => {
  const p = plan([{ id: 'a' }, { id: 'b', condition: 'Fair' }]);
  assert.equal(p.take[0].condition, 'Fair');
});

t('treats no van as a real answer rather than no answer', () => {
  const p = plan([{ id: 'a' }], null);
  assert.equal(p.vehicleId, null);
  assert.deepEqual(p.update.map((x) => x.id), ['a']); // off van-1, onto nothing
});

console.log('\nawkward answers');

t('ignores a tick for something that is not on the list', () => {
  // A phone holding a stale list must not be able to assign a retired asset.
  const p = plan([{ id: 'a' }, { id: 'gone' }]);
  assert.equal(p.take.length, 0);
  assert.equal(p.holding, 1);
});

t('counts the same thing once when it is ticked twice', () => {
  const p = plan([{ id: 'b' }, { id: 'b' }]);
  assert.equal(p.take.length, 1);
  assert.equal(p.holding, 1);
});

t('reports what the tech will be holding, not what changed', () => {
  const p = plan([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.equal(p.holding, 3);
});

t('refuses to plan for nobody', () => {
  assert.throws(() => planClaim({ me: null, items: ITEMS, claimed: [] }), /Nobody/);
});

t('an empty shop is not an error', () => {
  const p = planClaim({ me: ME, items: [], claimed: [] });
  assert.equal(changesAnything(p), false);
  assert.equal(p.holding, 0);
});

console.log(`\n${pass} checks passed\n`);
