/** Run with: node server/radonIntake.test.js
 *
 * Covers the translation only — phone submission to the shape /api/radon/tests
 * accepts. What happens to that shape in the database is the trigger's job and
 * is tested by placing a set.
 */
import assert from 'node:assert/strict';
import { radonSetFromSubmission } from './radonIntake.js';

const sub = {
  id: 'sub-1',
  employee_id: 'emp-7',
  captured_at: '2026-08-03T14:02:00.000Z',
  gps_lat: 37.54,
  gps_lng: -77.43,
};

const ordinary = {
  primary_device: 'eq-1',
  address: '19 Cary St',
  placement_floor: 'Basement',
  placement_photo: 'data:image/jpeg;base64,AAAA',
  closed_house_confirmed: true,
  notes: 'Sump pit sealed.',
  _qa: {
    believed_sequence: 3, interval: 10, confident: true,
    duplicate_required: false, duplicate_placed: false,
    device_synced_at: '2026-08-03T07:00:00.000Z',
    captured_offline: false,
    queued_at: '2026-08-03T14:02:00.000Z',
  },
};

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('\nan ordinary set');
t('the address and the monitor come across', () => {
  const b = radonSetFromSubmission(sub, ordinary);
  assert.equal(b.property_address, '19 Cary St');
  assert.equal(b.primary.equipment_id, 'eq-1');
  assert.equal(b.primary.placement_floor, 'Basement');
});
t('the tech is the inspector', () => {
  assert.equal(radonSetFromSubmission(sub, ordinary).inspector_id, 'emp-7');
});
t('where it was placed rides along', () => {
  assert.deepEqual(radonSetFromSubmission(sub, ordinary).gps, { lat: 37.54, lng: -77.43 });
});
t('no duplicate on an ordinary set', () => {
  assert.equal(radonSetFromSubmission(sub, ordinary).duplicate, null);
});
t('a set placed with signal is marked as such', () => {
  assert.equal(radonSetFromSubmission(sub, ordinary).source, 'field_online');
});
t('the photo is pointed at, not copied', () => {
  const b = radonSetFromSubmission(sub, ordinary);
  assert.equal(b.primary.photo_ref, 'field_submission:sub-1#placement_photo');
  assert.ok(!b.primary.photo_ref.includes('base64'), 'the image itself stays in the payload');
});

console.log('\na QA set');
const qaSet = {
  ...ordinary,
  duplicate_device: 'eq-2',
  duplicate_distance: 4,
  duplicate_seal: 'TS-991',
  duplicate_photo: 'data:image/jpeg;base64,BBBB',
  _qa: { ...ordinary._qa, believed_sequence: 10, duplicate_required: true, duplicate_placed: true },
};
t('the second monitor becomes the duplicate', () => {
  const b = radonSetFromSubmission(sub, qaSet);
  assert.equal(b.duplicate.equipment_id, 'eq-2');
  assert.equal(b.duplicate.distance_inches, 4);
  assert.equal(b.duplicate.tamper_seal_number, 'TS-991');
});
t('the pair photo is pointed at too', () => {
  assert.equal(radonSetFromSubmission(sub, qaSet).duplicate.photo_ref,
    'field_submission:sub-1#duplicate_photo');
});
t('both monitors are recorded on the same floor', () => {
  const b = radonSetFromSubmission(sub, qaSet);
  assert.equal(b.duplicate.placement_floor, b.primary.placement_floor);
});

console.log('\nwhat the phone believed');
t('an offline set says so, so the trigger can let it through', () => {
  const b = radonSetFromSubmission(sub, { ...ordinary, _qa: { ...ordinary._qa, captured_offline: true } });
  assert.equal(b.source, 'field_offline');
});
t('the believed sequence and last sync survive the trip', () => {
  const b = radonSetFromSubmission(sub, qaSet);
  assert.equal(b.device_believed_sequence, 10);
  assert.equal(b.device_synced_at, '2026-08-03T07:00:00.000Z');
});

console.log('\nwhen the phone sends less than it should');
t('a submission with no QA block still opens a set', () => {
  const b = radonSetFromSubmission(sub, { primary_device: 'eq-1', address: '4 Main' });
  assert.equal(b.source, 'field_online');
  assert.equal(b.device_believed_sequence, null);
  assert.equal(b.primary.equipment_id, 'eq-1');
});
t('a missing address does not become an empty one', () => {
  // property_address is NOT NULL. Losing the set over a blank field would be
  // worse than filing it under something a human will obviously notice.
  const b = radonSetFromSubmission(sub, { primary_device: 'eq-1' });
  assert.equal(b.property_address, 'Address not recorded');
});
t('no gps means no gps, not zero', () => {
  const b = radonSetFromSubmission({ ...sub, gps_lat: null, gps_lng: null }, ordinary);
  assert.equal(b.gps, null);
});
t('closed-house is only true when the tech said so', () => {
  assert.equal(radonSetFromSubmission(sub, { primary_device: 'e' }).closed_house_confirmed, false);
});

console.log(`\n${pass} checks passed\n`);
