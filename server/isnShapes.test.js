/** Run with: node server/isnShapes.test.js
 *
 * ISN's own docs describe what footprints mean but not how the reply is
 * wrapped, and the Swagger page that would say is rendered client-side. So the
 * reader tolerates the shapes an API of this vintage plausibly uses, and when
 * it cannot find a list it reports what arrived rather than failing three
 * frames later on "not iterable".
 */
import assert from 'node:assert/strict';
import { extractList, describeShape } from './integrations/isn.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('\nfinding the list');
t('a bare array is the list', () => {
  assert.deepEqual(extractList([{ id: 1 }], 'footprints'), [{ id: 1 }]);
});
t('an envelope named for the thing', () => {
  assert.deepEqual(extractList({ footprints: [{ id: 1 }] }, 'footprints'), [{ id: 1 }]);
});
t('a data envelope', () => {
  assert.deepEqual(extractList({ status: 'ok', data: [{ id: 2 }] }, 'footprints'), [{ id: 2 }]);
});
t('the only array in there, whatever it is called', () => {
  assert.deepEqual(extractList({ status: 'ok', orderStubs: [{ id: 3 }] }, 'footprints'), [{ id: 3 }]);
});
t('an object keyed by id', () => {
  assert.deepEqual(extractList({ a: { id: 1 }, b: { id: 2 } }, 'footprints'), [{ id: 1 }, { id: 2 }]);
});

console.log('\nnothing to do is not a failure');
t('an empty envelope is an empty list', () => {
  assert.deepEqual(extractList({}, 'footprints'), []);
});
t('a bare status is an empty list', () => {
  // An office login with no inspections of its own has no footprints. That is
  // a fact about the account, not a broken sync.
  assert.deepEqual(extractList({ status: 'ok' }, 'footprints'), []);
});
t('an empty array stays empty', () => {
  assert.deepEqual(extractList([], 'footprints'), []);
});

console.log('\nwhen it really is not a list');
t('it says what arrived instead', () => {
  assert.throws(() => extractList('nope', 'footprints'), /not a list of footprints/);
  assert.throws(() => extractList(42, 'footprints'), /number/);
});
t('two arrays are ambiguous, so it refuses to guess', () => {
  assert.throws(() => extractList({ a: [1], b: [2] }, 'footprints'), /not a list of footprints/);
});

console.log('\ndescribing without disclosing');
t('field names yes, values no', () => {
  const s = describeShape({ status: 'ok', footprints: [{ id: 'x', client: 'Jane Doe' }] });
  assert.match(s, /status: string/);
  assert.match(s, /footprints: array\(1\)/);
  assert.ok(!s.includes('Jane Doe'), 'a client name must never reach a log line');
  assert.ok(!s.includes('ok'.padStart(3, '"')), 'nor a value');
});
t('null and scalars describe cleanly', () => {
  assert.equal(describeShape(null), 'null');
  assert.equal(describeShape('x'), 'string');
});

console.log(`\n${pass} checks passed\n`);
