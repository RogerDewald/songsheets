#!/usr/bin/env node
/* Draws the Songsheets icon (a "[G]" mark) as SVG files and rasterises PNG sizes with no dependencies.
 * Usage: node tools/make-icons.js */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'icons');
const BLUE = [0x1f, 0x45, 0xff];
const WHITE = [0xff, 0xff, 0xff];

// geometry in a 512 box
const STROKE = 36;
const BRACKET_L = [[150, 136], [106, 136], [106, 376], [150, 376]];
const BRACKET_R = [[362, 136], [406, 136], [406, 376], [362, 376]];
const G = { cx: 256, cy: 256, r: 80, gapFrom: -45, gapTo: 0, bar: [[336, 256], [272, 256]] };
const gStart = [G.cx + G.r * Math.cos(G.gapFrom * Math.PI / 180), G.cy + G.r * Math.sin(G.gapFrom * Math.PI / 180)];

function svg(maskable) {
  const s = maskable ? 0.78 : 1;
  const t = maskable ? (512 - 512 * s) / 2 : 0;
  const pts = (arr) => arr.map(([x, y]) => `${x} ${y}`).join(' L');
  const bg = maskable ? '<rect width="512" height="512" fill="#1f45ff"/>' : '<rect width="512" height="512" rx="112" fill="#1f45ff"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${bg}
  <g transform="translate(${t} ${t}) scale(${s})" fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${pts(BRACKET_L)}"/>
    <path d="M${pts(BRACKET_R)}"/>
    <path d="M${gStart[0].toFixed(1)} ${gStart[1].toFixed(1)} A${G.r} ${G.r} 0 1 0 ${G.bar[0][0]} ${G.bar[0][1]} L${G.bar[1][0]} ${G.bar[1][1]}"/>
  </g>
</svg>
`;
}

function distSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inStrokes(x, y) {
  const hw = STROKE / 2;
  for (const poly of [BRACKET_L, BRACKET_R, G.bar]) {
    for (let i = 0; i + 1 < poly.length; i++) if (distSeg(x, y, poly[i], poly[i + 1]) <= hw) return true;
  }
  const d = Math.hypot(x - G.cx, y - G.cy);
  if (Math.abs(d - G.r) <= hw) {
    const a = Math.atan2(y - G.cy, x - G.cx) * 180 / Math.PI;
    if (!(a > G.gapFrom && a < G.gapTo)) return true;
  }
  if (Math.hypot(x - gStart[0], y - gStart[1]) <= hw) return true;       // round cap at the G's start
  return false;
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
  return x >= 0 && y >= 0 && x <= 512 && y <= 512 && Math.hypot(x - cx, y - cy) <= r;
}

function raster(size, maskable) {
  const SS = 4;
  const s = maskable ? 0.78 : 1;
  const t = maskable ? (512 - 512 * s) / 2 : 0;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0, fg = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const X = ((i + (si + 0.5) / SS) / size) * 512;
          const Y = ((j + (sj + 0.5) / SS) / size) * 512;
          const inside = maskable ? true : inRoundRect(X, Y, 112);
          if (!inside) continue;
          if (inStrokes((X - t) / s, (Y - t) / s)) fg++; else bg++;
        }
      }
      const n = SS * SS;
      const cov = (bg + fg) / n;
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = cov ? Math.round((BLUE[c] * bg + WHITE[c] * fg) / (bg + fg)) : 0;
      px[o + 3] = Math.round(cov * 255);
    }
  }
  return png(size, size, px);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(false));
fs.writeFileSync(path.join(OUT, 'icon-maskable.svg'), svg(true));
fs.writeFileSync(path.join(OUT, 'icon-180.png'), raster(180, true));     // iOS applies its own corner mask
fs.writeFileSync(path.join(OUT, 'icon-192.png'), raster(192, false));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), raster(512, false));
console.log('icons written to', OUT);
