/** Run with: node server/roles.test.js
 *
 * Authority was decided in five places, four of them by rank and one by asking
 * whether a role appeared in a list. Outranking everybody does not help
 * against a membership test, which is how the owner could be locked out of a
 * phone form nobody had ticked for them.
 *
 * These pin the rule that replaced it: the owner is allowed everything, and
 * every gate asks the same function.
 */
import assert from 'node:assert/strict';
import { RANK, ROLES, TOP, atLeast, outranks, may } from '../field/app/roles.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('\nthe owner is allowed everything');

t('reaches every bar there is', () => {
  for (const min of ROLES) assert.equal(atLeast('owner', min), true, min);
});

t('sees anything switched on for anyone', () => {
  assert.equal(may('owner', ['field']), true);
  assert.equal(may('owner', ['office', 'admin']), true);
});

t('sees what nobody was ticked for at all', () => {
  // The actual lockout: a module created with no access rows was invisible to
  // the person who runs the branch.
  assert.equal(may('owner', []), true);
  assert.equal(may('owner', null), true);
  assert.equal(may('owner', undefined), true);
});

t('is the top of the order, so nobody outranks them', () => {
  assert.equal(TOP, 'owner');
  for (const r of ROLES) assert.equal(outranks(r, 'owner'), false, r);
});

console.log('\nand everybody else still is not');

t('a tech only gets what a tech was given', () => {
  assert.equal(may('field', ['field']), true);
  assert.equal(may('field', ['office', 'admin']), false);
  assert.equal(may('field', []), false);
});

t('an admin does not quietly become the owner', () => {
  assert.equal(atLeast('admin', 'owner'), false);
  assert.equal(may('admin', ['field']), false);
  assert.equal(outranks('admin', 'owner'), false);
});

t('rank runs field, office, admin, owner', () => {
  assert.deepEqual(ROLES, ['field', 'office', 'admin', 'owner']);
  assert.ok(RANK.field < RANK.office && RANK.office < RANK.admin && RANK.admin < RANK.owner);
});

t('an unknown or missing role reaches nothing', () => {
  // A token from before a rename, or a user row with a typo in it.
  assert.equal(atLeast(undefined, 'field'), false);
  assert.equal(atLeast('supervisor', 'field'), false);
  assert.equal(may(undefined, ['field']), false);
  assert.equal(outranks('supervisor', 'field'), false);
});

t('everyone reaches their own level, nobody reaches the one above', () => {
  ROLES.forEach((role, i) => {
    assert.equal(atLeast(role, role), true, `${role} reaches ${role}`);
    if (ROLES[i + 1]) assert.equal(atLeast(role, ROLES[i + 1]), false, `${role} stops below ${ROLES[i + 1]}`);
  });
});

console.log(`\n${pass} checks passed\n`);
