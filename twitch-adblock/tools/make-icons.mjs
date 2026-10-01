// Draws the toolbar icons (a purple shield with a white play triangle) and
// writes them to icons/. Dependency-free: a 4x4-supersampled rasteriser and a
// minimal PNG encoder. Run with `node tools/make-icons.mjs`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PURPLE = [145, 70, 255];
const DARK = [100, 40, 200];
const WHITE = [255, 255, 255];

// Shape tests in a 0..1 unit square.
function inShield(x, y) {
  if (y < 0.08 || y > 0.94) return false;
  if (y <= 0.55) return x >= 0.12 && x <= 0.88;
  const t = (y - 0.55) / (0.94 - 0.55); // taper to a point
  const half = 0.38 * Math.sqrt(1 - t * t);
  return Math.abs(x - 0.5) <= half;
}
function inPlay(x, y) {
  const ax = 0.38, top = 0.27, bottom = 0.67, tip = 0.68;
  if (x < ax || x > tip) return false;
  const mid = (top + bottom) / 2;
  const half = ((bottom - top) / 2) * (1 - (x - ax) / (tip - ax));
  return Math.abs(y - mid) <= half;
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (!inShield(x, y)) continue;
          const c = inPlay(x, y) ? WHITE : y > 0.5 ? DARK.map((d, i) => d + (PURPLE[i] - d) * (1 - (y - 0.5) * 2)) : PURPLE;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
      }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), render(size));
}
console.log('icons written');
