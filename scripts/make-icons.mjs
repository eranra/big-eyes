// Generates the tray icons (two eyes) as PNG files without any image library.
//   assets/icons/trayTemplate.png / @2x   macOS menu bar (black + alpha, the system tints it)
//   assets/icons/tray.png / @2x           Windows and Linux tray (white outline, dark pupils)
//   assets/icons/icon.png                 1024 px app icon used by electron-builder
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets/icons');

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
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges.
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
          acc = acc.map((v, i) => v + p[i] * (i === 3 ? 1 : p[3]));
        }
      const a = acc[3] / 16;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Two eyes in a 0..1 square. Returns 'outline' | 'pupil' | null. */
function eyes(u, v) {
  for (const cx of [0.29, 0.71]) {
    const dx = (u - cx) / 0.2;
    const dy = (v - 0.5) / 0.3;
    const r = Math.hypot(dx, dy);
    const pd = Math.hypot(u - (cx + 0.05), v - 0.55);
    if (r <= 1 && r >= 0.72) return 'outline';
    if (r < 0.72 && pd < 0.085) return 'pupil';
  }
  return null;
}

const template = (u, v) => (eyes(u, v) ? [0, 0, 0, 1] : [0, 0, 0, 0]);
const tray = (u, v) => {
  const e = eyes(u, v);
  if (e === 'outline') return [240, 236, 248, 1];
  if (e === 'pupil') return [240, 236, 248, 1];
  return [0, 0, 0, 0];
};
function appIcon(u, v) {
  // Rounded square background with a soft violet gradient, big white eyes with blue irises.
  const m = 0.06;
  const r = 0.2;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  for (const cx of [0.33, 0.67]) {
    const d = Math.hypot((u - cx) / 0.15, (v - 0.5) / 0.19);
    const id = Math.hypot(u - (cx + 0.035), v - 0.53);
    if (d <= 1) {
      if (id < 0.035) return [8, 6, 16, 1];
      if (Math.hypot(u - (cx + 0.015), v - 0.505) < 0.018) return [255, 255, 255, 1];
      if (id < 0.085) return [61 + (1 - id / 0.085) * 60, 133 + (1 - id / 0.085) * 50, 220, 1];
      return [250, 249, 255, 1];
    }
    if (d <= 1.12) return [30, 22, 44, 1];
  }
  const t = v;
  return [Math.round(52 - 20 * t), Math.round(38 - 16 * t), Math.round(82 - 34 * t), 1];
}

await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'trayTemplate.png'), png(18, template));
await writeFile(join(dir, 'trayTemplate@2x.png'), png(36, template));
await writeFile(join(dir, 'tray.png'), png(22, tray));
await writeFile(join(dir, 'tray@2x.png'), png(44, tray));
await writeFile(join(dir, 'icon.png'), png(1024, appIcon));
console.log(`Icons written to ${dir}`);
