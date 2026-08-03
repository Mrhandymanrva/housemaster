import assert from 'node:assert/strict';
import { extractList, describeShape } from './server/integrations/isn.js';
let pass = 0;
const t = (n, f) => { f(); pass++; console.log('  ok  ' + n); };

t('a bare array is the list', () => assert.deepEqual(extractList([{id:1}], 'footprints'), [{id:1}]));
t('an envelope named for the thing', () => assert.deepEqual(extractList({footprints:[{id:1}]}, 'footprints'), [{id:1}]));
t('a data envelope', () => assert.deepEqual(extractList({status:'ok', data:[{id:2}]}, 'footprints'), [{id:2}]));
t('the only array, whatever it is called', () => assert.deepEqual(extractList({status:'ok', orderStubs:[{id:3}]}, 'footprints'), [{id:3}]));
t('keyed by id', () => assert.deepEqual(extractList({'a':{id:1},'b':{id:2}}, 'footprints'), [{id:1},{id:2}]));
t('an empty envelope is an empty list', () => assert.deepEqual(extractList({}, 'footprints'), []));
t('status-only is an empty list', () => assert.deepEqual(extractList({status:'ok'}, 'footprints'), []));
t('anything else says what arrived', () => {
  assert.throws(() => extractList('nope', 'footprints'), /not a list of footprints.*string/s);
});
t('shape names fields without values', () => {
  const s = describeShape({status:'ok', footprints:[{id:'x', client:'Jane Doe'}]});
  assert.match(s, /status: string/); assert.match(s, /footprints: array\(1\)/);
  assert.ok(!s.includes('Jane Doe'), 'never echoes values');
});
console.log(`\n${pass} checks passed\n`);
