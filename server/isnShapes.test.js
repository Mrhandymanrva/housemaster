/** Run with: node server/isnShapes.test.js
 *
 * Fixtures follow ISN's published schemas — FootprintEntry, Order,
 * OrdersResponse, Client, Agent, User. The first pull failed on "(footprints
 * || []) is not iterable" because the code assumed a bare array where ISN
 * sends { status, footprints: [...] }, and the field names underneath were
 * guesses too. These pin both down.
 */
import assert from 'node:assert/strict';
import { extractList, describeShape, unwrap, normalizeOrder, hasRadon, radonFee, bool }
  from './integrations/isn.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

// ---------------------------------------------------------------- envelopes
console.log('\nISN wraps everything');
t('FootprintResponse', () => {
  assert.deepEqual(
    extractList({ status: 'ok', footprints: [{ id: 'f1' }] }, 'footprints'), [{ id: 'f1' }]);
});
t('OrdersResponse, with its count and after', () => {
  assert.deepEqual(
    extractList({ status: 'ok', after: '2026-01-01', count: 1, orders: [{ id: 'o1' }] }, 'orders'),
    [{ id: 'o1' }]);
});
t('MeResponse unwraps to the person', () => {
  assert.deepEqual(unwrap({ status: 'ok', me: { firstname: 'Dale' } }, 'me'), { firstname: 'Dale' });
});
t('OrderResponse unwraps to the order', () => {
  assert.deepEqual(unwrap({ status: 'ok', order: { id: 'o1' } }, 'order'), { id: 'o1' });
});
t('an already-bare payload passes through', () => {
  assert.deepEqual(unwrap({ id: 'o1' }, 'order'), { id: 'o1' });
});
t('a bare array is the list', () => {
  assert.deepEqual(extractList([{ id: 1 }], 'footprints'), [{ id: 1 }]);
});
t('an object keyed by id', () => {
  assert.deepEqual(extractList({ a: { id: 1 }, b: { id: 2 } }, 'x'), [{ id: 1 }, { id: 2 }]);
});

console.log('\nnothing to do is not a failure');
t('status-only means an empty list', () => {
  // An office login with no inspections of its own has no footprints. That is
  // a fact about the account, not a broken sync.
  assert.deepEqual(extractList({ status: 'ok' }, 'footprints'), []);
});
t('an empty envelope', () => assert.deepEqual(extractList({}, 'footprints'), []));
t('an empty array', () => assert.deepEqual(extractList([], 'orders'), []));

console.log('\nwhen it really is not a list');
t('it says what arrived', () => {
  assert.throws(() => extractList('nope', 'footprints'), /not a list of footprints/);
});
t('two arrays are ambiguous, so it will not guess', () => {
  assert.throws(() => extractList({ a: [1], b: [2] }, 'orders'), /not a list of orders/);
});
t('field names yes, values never', () => {
  const s = describeShape({ status: 'ok', footprints: [{ id: 'x', client: 'Jane Doe' }] });
  assert.match(s, /footprints: array\(1\)/);
  assert.ok(!s.includes('Jane Doe'), 'a client name must never reach a log line');
});

// ------------------------------------------------------------------- orders
const ORDER = {
  id: 'ord-1', oid: 4821,
  datetime: '2026-08-04T13:00:00Z', duration: '180',
  canceled: 'no', complete: 'no', paid: 'yes',
  address1: '19 Cary St', address2: 'Unit B', city: 'Richmond',
  state: 'Virginia', stateabbreviation: 'VA', zip: '23220',
  squarefeet: '2410', yearbuilt: '1974', foundation: 'crawl-uuid',
  client: 'cli-1', buyersagent: 'agt-1',
  inspector1: 'usr-9', inspector2: 'usr-3', inspector3: '',
  services: [{ uuid: 's1', name: 'Home Inspection' }, { uuid: 's2', name: 'Radon Testing' }],
  fees: [{ id: 'f1', name: 'Radon Testing', amount: 150 }],
};
const CLIENT = { id: 'cli-1', first: 'Jane', last: 'Doe', display: 'Jane Doe',
                 email: 'jane@example.com', mobilephone: '804-555-0111', homephone: '' };
const AGENT = { id: 'agt-1', firstname: 'Sam', lastname: 'Reed', displayname: 'Sam Reed',
                email: 'sam@realty.example' };
const USER = { id: 'usr-9', firstname: 'Dale', lastname: 'Whitfield',
               displayname: 'Dale Whitfield', emailaddress: 'dale@hmrichmond.com', inspector: true };

console.log('\nan order, in our words');
const o = normalizeOrder(ORDER, { client: CLIENT, agent: AGENT, inspector: USER });
t('the inspection time is `datetime`', () => {
  assert.equal(new Date(o.scheduled_start).toISOString(), '2026-08-04T13:00:00.000Z');
});
t('duration gives the end', () => {
  assert.equal(new Date(o.scheduled_end).toISOString(), '2026-08-04T16:00:00.000Z');
});
t('address1 and address2 join up', () => assert.equal(o.property_address, '19 Cary St Unit B'));
t('the state abbreviation wins over the full name', () => assert.equal(o.property_state, 'VA'));
t('numbers arrive as strings and leave as numbers', () => {
  assert.equal(o.square_feet, 2410);
  assert.equal(o.year_built, 1974);
});
t('the order number is the OID a person would quote', () => assert.equal(o.order_number, '4821'));
t('inspector1 is whose day this is', () => assert.equal(o.inspector_isn_id, 'usr-9'));
t('the whole crew is kept', () => assert.deepEqual(o.crew, ['usr-9', 'usr-3']));
t('the inspector is named from /user, since the order only has ids', () => {
  assert.equal(o.inspector_name, 'Dale Whitfield');
});
t('client and agent names come off their own records', () => {
  assert.equal(o.client_name, 'Jane Doe');
  assert.equal(o.client_phone, '804-555-0111');
  assert.equal(o.agent_name, 'Sam Reed');
});
t('an empty string is not a phone number', () => {
  const bare = normalizeOrder(ORDER, { client: { ...CLIENT, mobilephone: '', homephone: '' } });
  assert.equal(bare.client_phone, null);
});
t('services and fees are both kept, because radon can be either', () => {
  assert.equal(o.services.length, 3);
});

console.log('\nyes and no are strings in ISN');
t('a live order is Scheduled', () => assert.equal(o.order_status, 'Scheduled'));
t('canceled reads as canceled', () => {
  assert.equal(normalizeOrder({ ...ORDER, canceled: 'yes' }, {}).order_status, 'Canceled');
});
t('complete reads as complete', () => {
  assert.equal(normalizeOrder({ ...ORDER, complete: 'yes' }, {}).order_status, 'Complete');
});
t('no date means unscheduled, not a crash', () => {
  const u = normalizeOrder({ ...ORDER, datetime: '', scheduleddatetime: '' }, {});
  assert.equal(u.order_status, 'Unscheduled');
  assert.equal(u.scheduled_start, null);
  assert.equal(u.scheduled_end, null);
});
t('an order with no crew still normalises', () => {
  const bare = normalizeOrder({ id: 'x', address1: '1 Main' }, {});
  assert.equal(bare.inspector_isn_id, null);
  assert.deepEqual(bare.crew, []);
});

console.log('\nradon is whatever the office called it');
t('found in the services list', () => {
  assert.equal(hasRadon(o.services, ['radon']), true);
});
t('found in the fees when it was written up as one', () => {
  assert.equal(hasRadon([{ id: 'f1', name: 'Radon Testing', amount: 150 }], ['radon']), true);
});
t('an ordinary inspection is not radon', () => {
  assert.equal(hasRadon([{ uuid: 's1', name: 'Home Inspection' }], ['radon']), false);
});
t('the fee comes off the fee entry', () => assert.equal(radonFee(o.services), 150));

console.log('\n"yes" and "no" are not booleans');
t('"no" is false, not truthy', () => {
  // !!"no" is true, which is how all 250 users came back flagged as both an
  // inspector and an owner.
  assert.equal(bool('no'), false);
  assert.equal(bool('No'), false);
  assert.equal(bool('0'), false);
});
t('"yes" is true', () => {
  assert.equal(bool('yes'), true);
  assert.equal(bool('YES'), true);
  assert.equal(bool(true), true);
});
t('unset stays unset rather than defaulting to true', () => {
  assert.equal(bool(undefined), false);
  assert.equal(bool(''), false);
  assert.equal(bool(null, true), true, 'an explicit fallback is honoured');
});
t('an explicit false beats the fallback', () => assert.equal(bool(false, true), false));
t('something unrecognised falls back rather than guessing', () => {
  assert.equal(bool('maybe', true), true);
});

console.log('\nwhich branch a job belongs to');
t('the office comes off the order', () => {
  assert.equal(normalizeOrder({ id: 'x', office: 'off-1' }, {}).isn_office_id, 'off-1');
});
t('no office is null, not an empty string', () => {
  assert.equal(normalizeOrder({ id: 'x', office: '' }, {}).isn_office_id, null);
});

console.log(`\n${pass} checks passed\n`);
