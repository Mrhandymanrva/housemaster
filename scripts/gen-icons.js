/**
 * Draws the field app's home-screen icons.
 *
 * A build dependency for three flat images is a poor trade, so this plots the
 * pixels and writes the PNG itself. Re-run after changing the mark:
 *   node scripts/gen-icons.js
 */
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

const RED = [0xd3, 0x3a, 0x2c];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  // one filter byte per row, then RGB triples
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let i = 0;
  for (let y = 0; y < size; y++) {
    raw[i++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[i++] = r; raw[i++] = g; raw[i++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A house: roof, walls, doorway. Kept inside the middle 60% so a round or
 *  squircle mask on any phone never clips it. */
function mark(size) {
  const c = size / 2;
  const s = size * 0.30;              // half-width of the house
  const roofTop = c - s * 1.05;
  const eaves = c - s * 0.25;
  const base = c + s * 0.95;
  const wall = s * 0.78;
  const doorW = s * 0.26;
  const doorTop = c + s * 0.15;

  return (x, y) => {
    const dx = x - c;
    // roof: widen linearly from apex down to the eaves
    if (y >= roofTop && y <= eaves) {
      const t = (y - roofTop) / (eaves - roofTop);
      if (Math.abs(dx) <= s * t) return WHITE;
    }
    if (y > eaves && y <= base && Math.abs(dx) <= wall) {
      const inDoor = y >= doorTop && y <= base && Math.abs(dx) <= doorW;
      return inDoor ? RED : WHITE;
    }
    return RED;
  };
}

for (const size of [180, 192, 512]) {
  const file = new URL(`../field/app/icon-${size}.png`, import.meta.url);
  await writeFile(file, png(size, mark(size)));
  console.log(`icon-${size}.png`);
}
