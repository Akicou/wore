// Dependency-free PNG generator for the WoRe app icon (1024×1024).
// Produces app-icon.png, then `tauri icon` derives every required size/format.
import zlib from "node:zlib";
import fs from "node:fs";

const S = 1024;
const px = new Uint8Array(S * S * 4);

const idx = (x, y) => (y * S + x) * 4;

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = idx(x, y);
  const aa = a / 255;
  px[i] = Math.round(px[i] * (1 - aa) + r * aa);
  px[i + 1] = Math.round(px[i + 1] * (1 - aa) + g * aa);
  px[i + 2] = Math.round(px[i + 2] * (1 - aa) + b * aa);
  px[i + 3] = Math.min(255, px[i + 3] + a);
}

function fillRoundedRect(x, y, w, h, r, fn) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const dx = Math.max(x + r - i, i - (x + w - 1 - r), 0);
      const dy = Math.max(y + r - j, j - (y + h - 1 - r), 0);
      const d = Math.hypot(dx, dy);
      if (d <= r) {
        const { r: rr, g: gg, b: bb, a = 255 } = fn(i, j);
        blend(i, j, rr, gg, bb, a);
      }
    }
  }
}

function distToSeg(px0, py0, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px0 - x1, wy = py0 - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px0 - x1, py0 - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px0 - x2, py0 - y2);
  const t = c1 / c2;
  return Math.hypot(px0 - (x1 + t * vx), py0 - (y1 + t * vy));
}

function thickLine(x1, y1, x2, y2, thick, color) {
  const minX = Math.floor(Math.min(x1, x2) - thick);
  const maxX = Math.ceil(Math.max(x1, x2) + thick);
  const minY = Math.floor(Math.min(y1, y2) - thick);
  const maxY = Math.ceil(Math.max(y1, y2) + thick);
  const r = thick / 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distToSeg(x, y, x1, y1, x2, y2);
      if (d <= r) {
        const edge = Math.max(0, d - (r - 2));
        const a = Math.round(255 * (1 - edge / 2));
        blend(x, y, color[0], color[1], color[2], a);
      }
    }
  }
}

// Background: amber gradient rounded square.
fillRoundedRect(0, 0, S, S, 228, (x, y) => {
  const t = y / S;
  const r = Math.round(214 - t * 60);
  const g = Math.round(150 - t * 40);
  const b = Math.round(58 - t * 18);
  return { r, g, b, a: 255 };
});

// White document page.
fillRoundedRect(286, 220, 452, 600, 28, () => ({ r: 252, g: 248, b: 240, a: 255 }));
// Folded corner shadow.
fillRoundedRect(600, 220, 138, 138, 0, (x, y) => {
  const onFold = x + (y - 220) > 660;
  return onFold ? { r: 226, g: 218, b: 200, a: 255 } : { r: 252, g: 248, b: 240, a: 255 };
});

// Amber check mark (two thick strokes), echoing the logo.
const amber = [176, 106, 18];
thickLine(388, 520, 478, 612, 46, amber);
thickLine(478, 612, 660, 408, 46, amber);

// ---- PNG encode ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// raw scanlines with filter byte 0
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copyWithin ? null : null;
  for (let x = 0; x < S; x++) {
    const o = y * (S * 4 + 1) + 1 + x * 4;
    const s = idx(x, y);
    raw[o] = px[s];
    raw[o + 1] = px[s + 1];
    raw[o + 2] = px[s + 2];
    raw[o + 3] = px[s + 3];
  }
}
const idat = zlib.deflateSync(raw, { level: 9 });
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(new URL("../app-icon.png", import.meta.url), png);
console.log("✓ wrote app-icon.png", png.length, "bytes");
