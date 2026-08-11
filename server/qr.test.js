/** Run with: node server/qr.test.js
 *
 * A QR code that does not scan fails silently — it looks like a QR code, and
 * the first anyone hears is a tech saying nothing happened. The encoding is
 * the library's job; what is tested here is everything around it, which is
 * where a hand-rolled renderer goes wrong: the quiet zone, the module grid,
 * and a PNG whose bytes have to be right the first time.
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { qrMatrix, qrSvg, qrPng, publicOrigin } from './lib/qr.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const URL_ = 'https://housemaster-production-a2be.up.railway.app/phone/';
const MARGIN = 4;

console.log('\nthe matrix');
const m = qrMatrix(URL_);

t('is square and a legal QR size', () => {
  // Every version is 21 modules plus a multiple of four.
  assert.equal(m.dark.length, m.size);
  assert.ok(m.dark.every((row) => row.length === m.size));
  assert.equal((m.size - 21) % 4, 0);
});

t('carries a finder pattern in three corners', () => {
  // Without these a scanner cannot orient the code at all. Each is a 7x7 ring:
  // dark border, light gap, 3x3 dark core.
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        assert.equal(m.dark[r0 + r][c0 + c], edge || core,
          `finder at ${r0},${c0} wrong on ${r},${c}`);
      }
    }
  };
  finder(0, 0);
  finder(0, m.size - 7);
  finder(m.size - 7, 0);
});

t('refuses to encode nothing', () => {
  assert.throws(() => qrMatrix(''), /Nothing to encode/);
});

t('grows with the data rather than truncating it', () => {
  const big = qrMatrix(URL_ + '?' + 'x'.repeat(400));
  assert.ok(big.size > m.size);
});

console.log('\nthe svg');
const svg = qrSvg(URL_);

t('leaves the four-module quiet zone a scanner needs', () => {
  assert.match(svg, new RegExp(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`));
});

t('draws one square per dark module, and no more', () => {
  const drawn = (svg.match(/M-?\d+ -?\d+h1v1h-1z/g) || []).length;
  const expected = m.dark.flat().filter(Boolean).length;
  assert.equal(drawn, expected);
});

t('offsets every square into the quiet zone', () => {
  const xs = [...svg.matchAll(/M(\d+) (\d+)h/g)].map((x) => [+x[1], +x[2]]);
  assert.ok(xs.every(([x, y]) => x >= MARGIN && y >= MARGIN));
  assert.ok(xs.every(([x, y]) => x < m.size + MARGIN && y < m.size + MARGIN));
});

t('paints the quiet zone light rather than leaving it transparent', () => {
  // Printed on green letterhead, a transparent background is a code that does
  // not scan.
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#FFFFFF"\/>/);
});

console.log('\nthe png');
const scale = 6;
const png = qrPng(URL_, { scale });
const px = (m.size + MARGIN * 2) * scale;

t('is a png', () => {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});

t('declares the size it actually is', () => {
  assert.equal(png.readUInt32BE(16), px);
  assert.equal(png.readUInt32BE(20), px);
  assert.equal(png[24], 8);   // eight bits a sample
  assert.equal(png[25], 0);   // greyscale
});

// Pull the pixels back out the way a reader would, and check them against the
// matrix. This is the test that would have caught an off-by-one in the
// scanline stride, which is the mistake that makes a PNG look like static.
function pixels() {
  let at = 8;
  const parts = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('ascii');
    if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  assert.equal(raw.length, (px + 1) * px, 'one filter byte plus one row of samples, per row');
  return (x, y) => {
    assert.equal(raw[y * (px + 1)], 0, 'row filter should be none');
    return raw[y * (px + 1) + 1 + x];
  };
}

t('every module lands where the matrix says, at full scale', () => {
  const at = pixels();
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      const want = m.dark[r][c] ? 0x00 : 0xff;
      const x = (c + MARGIN) * scale;
      const y = (r + MARGIN) * scale;
      // both corners of the module, so a module drawn a pixel short shows up
      assert.equal(at(x, y), want, `module ${r},${c} top-left`);
      assert.equal(at(x + scale - 1, y + scale - 1), want, `module ${r},${c} bottom-right`);
    }
  }
});

t('keeps the quiet zone white all the way round', () => {
  const at = pixels();
  for (let i = 0; i < px; i++) {
    for (const [x, y] of [[i, 0], [i, px - 1], [0, i], [px - 1, i]]) {
      assert.equal(at(x, y), 0xff, `edge pixel ${x},${y} should be white`);
    }
  }
});

console.log('\nthe address it encodes');
t('uses the forwarded scheme, not the one on the socket', () => {
  // Railway ends TLS in front of us, so the socket always says http. A code
  // that pointed at http:// would break the service worker, which needs https.
  const req = { protocol: 'http', headers: { 'x-forwarded-proto': 'https', host: 'ops.example.com' } };
  assert.equal(publicOrigin(req), 'https://ops.example.com');
});

t('follows the forwarded host, so a custom domain prints itself', () => {
  const req = { protocol: 'https',
    headers: { 'x-forwarded-host': 'field.hmrichmond.com', host: 'internal:8080' } };
  assert.equal(publicOrigin(req), 'https://field.hmrichmond.com');
});

t('takes the first hop when a chain of proxies has piled up', () => {
  const req = { protocol: 'http', headers: { 'x-forwarded-proto': 'https, http', host: 'a.com, b.com' } };
  assert.equal(publicOrigin(req), 'https://a.com');
});

t('works off a bare host header, which is what localhost sends', () => {
  assert.equal(publicOrigin({ protocol: 'http', headers: { host: 'localhost:8080' } }),
    'http://localhost:8080');
});

console.log(`\n${pass} checks passed\n`);
