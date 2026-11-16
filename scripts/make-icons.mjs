// node scripts/make-icons.mjs — rasterises the app icon to PNGs (no dependencies).
// Same artwork as public/icon.svg: dark tile, two overlapping circles (you + partner), bright overlap.
import fs from "node:fs";
import zlib from "node:zlib";

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
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex("#1c1d21");
const A = hex("#748ffc");
const B = hex("#f06595");
const W = [255, 255, 255];

/**
 * @param size output px
 * @param opts.rounded transparent rounded corners (for "any" icons); false = full-bleed square (iOS/maskable)
 * @param opts.scale artwork scale inside the tile (maskable icons need ~0.8 safe zone)
 */
const render = (size, { rounded, scale }) => {
  const SS = 4; // supersampling for anti-aliasing
  const out = Buffer.alloc(size * size * 4);
  const u = 512 / size; // design units per px
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * u;
          const y = (py + (sy + 0.5) / SS) * u;
          // tile
          if (rounded) {
            const R = 112;
            const cx = Math.min(Math.max(x, R), 512 - R);
            const cy = Math.min(Math.max(y, R), 512 - R);
            if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
          }
          let col = [...BG];
          // artwork in design space, scaled about the centre
          const ax = 256 + (x - 256) / scale;
          const ay = 256 + (y - 256) / scale;
          const inA = (ax - 206) ** 2 + (ay - 256) ** 2 <= 92 * 92;
          const inB = (ax - 306) ** 2 + (ay - 256) ** 2 <= 92 * 92;
          const mix = (c, k, t) => c.map((v, i) => v * (1 - t) + k[i] * t);
          if (inA) col = mix(col, A, 1);
          if (inB) col = mix(col, B, 0.9);
          if (inA && inB) col = mix(col, W, 0.85);
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      // un-premultiply so edge pixels keep their colour
      const cov = a / 255;
      out[i] = cov ? Math.round(r / cov) : 0;
      out[i + 1] = cov ? Math.round(g / cov) : 0;
      out[i + 2] = cov ? Math.round(b / cov) : 0;
      out[i + 3] = Math.round(a / n);
    }
  }
  return png(size, out);
};

const dir = new URL("../public/", import.meta.url);
const files = {
  "icon-192.png": render(192, { rounded: true, scale: 1 }),
  "icon-512.png": render(512, { rounded: true, scale: 1 }),
  "icon-maskable-512.png": render(512, { rounded: false, scale: 0.8 }),
  "apple-touch-icon.png": render(180, { rounded: false, scale: 0.9 }) // iOS rounds the corners itself
};
for (const [name, buf] of Object.entries(files)) {
  fs.writeFileSync(new URL(name, dir), buf);
  console.log(`public/${name}  ${buf.length} bytes`);
}
