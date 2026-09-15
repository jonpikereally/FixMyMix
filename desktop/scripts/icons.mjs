// Renders the tray template icons and the macOS app icon with no dependencies:
// a few shapes rasterised with supersampling, wrapped in PNG and ICNS by hand.
// Run with `npm run icons`; the outputs are committed.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- PNG -------------------------------------------------------------------

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICNS ------------------------------------------------------------------

const ICNS_TYPES = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };

function icns(images) {
  const elements = images.map(({ size, data }) => {
    const header = Buffer.alloc(8);
    header.write(ICNS_TYPES[size], 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(elements);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// --- Rasteriser ------------------------------------------------------------

function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

// Each shape is a unit-square coverage test; `render` supersamples it.
const roundedRect = (x, y, w, h, r) => (px, py) => {
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return px >= x && px <= x + w && py >= y && py <= y + h && dx * dx + dy * dy <= r * r;
};
const circle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

function render(size, layers, samples = 4) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / samples;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + 0.5) * step) / size;
          const py = (y + (sy + 0.5) * step) / size;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const { shape, color, alpha = 1 } of layers) {
            if (!shape(px, py)) continue;
            const [lr, lg, lb] = color;
            cr = lr * alpha + cr * (1 - alpha);
            cg = lg * alpha + cg * (1 - alpha);
            cb = lb * alpha + cb * (1 - alpha);
            ca = alpha + ca * (1 - alpha);
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = samples * samples;
      const i = (y * size + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

// Three faders, the same drawing as public/icon.svg.
const FADERS = [
  { x: 0.22, top: 0.16, knob: 0.58 },
  { x: 0.5, top: 0.08, knob: 0.36 },
  { x: 0.78, top: 0.28, knob: 0.68 },
];

function trayLayers(alpha = 1) {
  const black = [0, 0, 0];
  return FADERS.flatMap(({ x, top, knob }) => [
    { shape: roundedRect(x - 0.06, top, 0.12, 0.92 - top, 0.06), color: black, alpha },
    { shape: circle(x, knob, 0.17), color: black, alpha },
  ]);
}

function appLayers() {
  const colors = ['#3dd0ff', '#ffc043', '#ff8a3d'].map(hex);
  const white = hex('#f2f4f8');
  const inset = 0.05; // macOS icons sit inside a margin
  const scale = (v) => inset + v * (1 - 2 * inset);
  return [
    { shape: roundedRect(inset, inset, 1 - 2 * inset, 1 - 2 * inset, 0.2), color: hex('#0b0d12') },
    ...FADERS.flatMap(({ x, top, knob }, i) => [
      { shape: roundedRect(scale(x) - 0.05, scale(top), 0.1, scale(0.92) - scale(top), 0.05), color: colors[i] },
      { shape: circle(scale(x), scale(knob), 0.075), color: white },
    ]),
  ];
}

writeFileSync(path.join(OUT, 'trayTemplate.png'), png(16, 16, render(16, trayLayers(), 8)));
writeFileSync(path.join(OUT, 'trayTemplate@2x.png'), png(32, 32, render(32, trayLayers(), 8)));
// Dimmed variant shown while the server is stopped.
writeFileSync(path.join(OUT, 'trayStoppedTemplate.png'), png(16, 16, render(16, trayLayers(0.4), 8)));
writeFileSync(path.join(OUT, 'trayStoppedTemplate@2x.png'), png(32, 32, render(32, trayLayers(0.4), 8)));

const appIcons = [32, 64, 128, 256, 512, 1024].map((size) => ({
  size,
  data: png(size, size, render(size, appLayers(), size >= 512 ? 2 : 4)),
}));
writeFileSync(path.join(OUT, 'icon.icns'), icns(appIcons));
writeFileSync(path.join(OUT, 'icon.png'), appIcons.find((i) => i.size === 512).data);
console.log('Wrote desktop/trayTemplate(.png,@2x), trayStoppedTemplate(.png,@2x), icon.icns, icon.png');
