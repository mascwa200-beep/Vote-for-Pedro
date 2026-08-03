// Generates the PWA icon set. Run once; the outputs are committed.
//
// PNGs are written by hand (deflate-stored IDAT + CRC) rather than pulling in
// an image library, because the project has zero dependencies and this is the
// only place raster output is needed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- SVG

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#000000"/>
  <path d="M256 84 L392 190 A170 170 0 0 1 256 428 A170 170 0 0 1 120 190 Z"
        fill="none" stroke="#ff9c00" stroke-width="26" stroke-linejoin="round"/>
  <path d="M256 150 L256 300" stroke="#ffcc66" stroke-width="22" stroke-linecap="round"/>
  <path d="M196 246 L256 300 L316 246" fill="none" stroke="#ffcc66"
        stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="256" cy="352" r="17" fill="#99ccff"/>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), SVG);

// ---------------------------------------------------------------- PNG

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePNG(path, size, draw) {
  // RGBA pixel buffer with a filter byte per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const p = rowStart + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// Signed distance helpers so the raster icon matches the SVG closely enough.
const dist = (x, y, x2, y2) => Math.hypot(x - x2, y - y2);

function segmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

function drawIcon(padding) {
  return (x, y, size) => {
    const s = size / 512;
    const inset = padding * size;
    const scale = (size - inset * 2) / size;
    const cx = (x - inset) / scale;
    const cy = (y - inset) / scale;
    const u = cx / s;
    const v = cy / s;

    const orange = [255, 156, 0, 255];
    const amber = [255, 204, 102, 255];
    const ice = [153, 204, 255, 255];
    const black = [0, 0, 0, 255];

    // Delta outline (approximated by its three edges).
    const edges = [
      [256, 84, 392, 190], [392, 190, 256, 428], [256, 428, 120, 190], [120, 190, 256, 84],
    ];
    let dOutline = Infinity;
    for (const [ax, ay, bx, by] of edges) {
      dOutline = Math.min(dOutline, segmentDist(u, v, ax, ay, bx, by));
    }
    if (dOutline < 14) return orange;

    // Vertical stroke and chevron.
    if (segmentDist(u, v, 256, 150, 256, 300) < 12) return amber;
    if (segmentDist(u, v, 196, 246, 256, 300) < 12) return amber;
    if (segmentDist(u, v, 256, 300, 316, 246) < 12) return amber;

    // Sensor dot.
    if (dist(u, v, 256, 352) < 18) return ice;

    return black;
  };
}

for (const size of [192, 512]) {
  writePNG(join(OUT, `icon-${size}.png`), size, drawIcon(0));
  // Maskable variants keep the mark inside the Android safe zone.
  writePNG(join(OUT, `icon-maskable-${size}.png`), size, drawIcon(0.11));
}

console.log(`Icons written to ${OUT}`);

// ---------------------------------------------------------------- Android

// Launcher icons for the APK. Legacy square icons per density, plus an
// adaptive foreground whose art sits inside the 66% safe circle so the
// launcher can mask it to whatever shape the device uses.
const ANDROID_RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'res');
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

for (const [density, size] of Object.entries(DENSITIES)) {
  const dir = join(ANDROID_RES, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  writePNG(join(dir, 'ic_launcher.png'), size, drawIcon(0.06));
  // Adaptive foregrounds are 108dp with only the middle 72dp guaranteed
  // visible, so the mark is inset further than the legacy icon.
  writePNG(join(dir, 'ic_launcher_foreground.png'), Math.round(size * 1.5), drawIcon(0.26));
}

console.log(`Android launcher icons written to ${ANDROID_RES}`);
