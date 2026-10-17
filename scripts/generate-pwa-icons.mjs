import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ACCENT = [0x11, 0x75, 0x6c];
const WHITE = [0xff, 0xff, 0xff];
const outDir = resolve('public');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), row + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The initial "L" of the product name "Ledgerly" as two bars in unit coordinates
// of the glyph box.
function inLetterL(u, v) {
  const stem = u >= 0.2 && u <= 0.4 && v >= 0.1 && v <= 0.9;
  const foot = u >= 0.2 && u <= 0.8 && v >= 0.72 && v <= 0.9;
  return stem || foot;
}

function render(size, { glyphScale, cornerRadius }) {
  const box = size * glyphScale;
  const origin = (size - box) / 2;
  const r = size * cornerRadius;
  return encodePng(size, (x, y) => {
    const dx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r));
    const dy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r));
    if (r > 0 && Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
    const lit = inLetterL((x + 0.5 - origin) / box, (y + 0.5 - origin) / box);
    return [...(lit ? WHITE : ACCENT), 255];
  });
}

const icons = [
  ['icons/icon-192.png', 192, { glyphScale: 0.62, cornerRadius: 0.2 }],
  ['icons/icon-512.png', 512, { glyphScale: 0.62, cornerRadius: 0.2 }],
  ['icons/icon-maskable-512.png', 512, { glyphScale: 0.5, cornerRadius: 0 }],
  ['apple-touch-icon.png', 180, { glyphScale: 0.62, cornerRadius: 0 }],
];

for (const [name, size, options] of icons) {
  const file = resolve(outDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size, options));
  console.log(`wrote ${name}`);
}
