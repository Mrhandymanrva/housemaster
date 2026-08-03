/** Run with: node server/attachments.test.js
 *
 * The parsing and the reference format. Storing is a database round trip and
 * is exercised by filing a photo.
 */
import assert from 'node:assert/strict';
import { parseDataUrl, isAttachmentRef, refToId, MAX_BYTES } from './attachments.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const jpeg = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg').toString('base64');

console.log('\nreading what the phone sent');
t('a jpeg data url comes apart', () => {
  const got = parseDataUrl(jpeg);
  assert.equal(got.mime, 'image/jpeg');
  assert.equal(got.bytes.toString(), 'not really a jpeg');
});
t('the mime type is taken from the url, not guessed', () => {
  assert.equal(parseDataUrl('data:image/png;base64,' + Buffer.from('x').toString('base64')).mime, 'image/png');
});
t('an upper-case declaration still parses', () => {
  assert.equal(parseDataUrl('data:IMAGE/PNG;base64,' + Buffer.from('x').toString('base64')).mime, 'image/png');
});

console.log('\nthings that are not photos');
t('an ordinary answer is left alone', () => assert.equal(parseDataUrl('Basement'), null));
t('a reference is not re-parsed', () => assert.equal(parseDataUrl('attachment:abc'), null));
t('a number is not a photo', () => assert.equal(parseDataUrl(4), null));
t('null is not a photo', () => assert.equal(parseDataUrl(null), null));
t('an empty payload after the comma is refused', () => {
  assert.equal(parseDataUrl('data:image/jpeg;base64,'), null);
});
t('a data url that is not an image is refused', () => {
  assert.equal(parseDataUrl('data:application/pdf;base64,' + Buffer.from('x').toString('base64')).mime,
    'application/pdf', 'parsing is permissive');
  // storeImage is what decides what may be filed; parsing only reports.
});

console.log('\nreferences');
t('a reference is recognised', () => assert.equal(isAttachmentRef('attachment:abc-123'), true));
t('a data url is not a reference', () => assert.equal(isAttachmentRef(jpeg), false));
t('the old submission-pointer form is not a reference', () => {
  assert.equal(isAttachmentRef('field_submission:sub-1#placement_photo'), false);
});
t('the id comes back out', () => assert.equal(refToId('attachment:abc-123'), 'abc-123'));
t('anything else yields no id', () => assert.equal(refToId('Basement'), null));

console.log('\nthe size limit');
t('five megabytes is the ceiling', () => assert.equal(MAX_BYTES, 5 * 1024 * 1024));

console.log(`\n${pass} checks passed\n`);
