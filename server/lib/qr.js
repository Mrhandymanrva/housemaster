/**
 * The QR code that puts the field app on a phone.
 *
 * It is generated from the address the request came in on rather than baked
 * into a file, so the code on the wall is always the code for wherever the app
 * actually lives. Put a custom domain in front of Railway and the printed page
 * starts pointing at it the next time someone loads it; nobody has to remember
 * that a picture somewhere needs regenerating.
 *
 * Two renderings, because a QR code gets used two ways. The SVG is for the
 * page a tech scans or the office prints — it stays sharp at any size. The PNG
 * is for sending: texting, Slack, an email to a new hire, a slide. Both come
 * off the same matrix, so they cannot disagree.
 */
import zlib from 'node:zlib';
import qrcode from 'qrcode-generator';

/**
 * Error correction M — a quarter of the code can be lost and still read. A
 * printed page picks up thumbprints and creases, and this is the level that
 * survives them without making the modules noticeably finer.
 */
export function qrMatrix(text, level = 'M') {
  if (!text) throw new Error('Nothing to encode.');
  const q = qrcode(0, level); // 0 = pick the smallest version that fits
  q.addData(String(text));
  q.make();
  const size = q.getModuleCount();
  const dark = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(q.isDark(r, c));
    dark.push(row);
  }
  return { size, dark };
}

/**
 * A scanner needs light space around the code to find its edges — four modules
 * is what the spec asks for, and a code butted against dark page furniture is
 * the usual reason a phone sees nothing.
 */
const MARGIN = 4;

/** Scalable, for the install page and for print. */
export function qrSvg(text, { dark = '#16202C', light = '#FFFFFF', level = 'M' } = {}) {
  const m = qrMatrix(text, level);
  const span = m.size + MARGIN * 2;

  let path = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark[r][c]) path += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `width="${span * 8}" height="${span * 8}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR code to install the HouseMaster field app">` +
    `<rect width="${span}" height="${span}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`
  );
}

// ------------------------------------------------------------------- PNG
// Small enough to write out rather than take a dependency for: a QR code is
// one bit per module, which is the simplest picture a PNG can hold.

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Greyscale, one byte a pixel. `scale` is how many pixels wide one module is:
 * at 8 a typical code lands near 300px, which is about as small as a phone
 * camera reads reliably off a screen across a desk.
 */
export function qrPng(text, { scale = 8, level = 'M' } = {}) {
  const m = qrMatrix(text, level);
  const span = m.size + MARGIN * 2;
  const px = span * scale;

  // Each scanline carries a leading filter byte; 0 means "stored as-is",
  // which is right here — deflate handles the long runs of white better than
  // any of the predictive filters would on an image this blocky.
  const raw = Buffer.alloc((px + 1) * px, 0xff);
  for (let y = 0; y < px; y++) raw[y * (px + 1)] = 0;

  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.dark[r][c]) continue;
      const x0 = (c + MARGIN) * scale;
      const y0 = (r + MARGIN) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        raw.fill(0x00, y * (px + 1) + 1 + x0, y * (px + 1) + 1 + x0 + scale);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // colour type: greyscale
  // 10, 11, 12 stay 0: deflate, adaptive filtering, no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Where the app is, as seen from wherever the request came in.
 *
 * Railway terminates TLS in front of the process, so the socket says http and
 * only the forwarded header knows better. Trusting it is safe for building a
 * link back to ourselves — the worst a spoofed header can do is print a QR
 * code that points somewhere else, and whoever spoofed it could have printed
 * their own QR code anyway.
 */
export function publicOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim();
  return `${proto}://${host}`;
}
