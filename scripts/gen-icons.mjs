// One-shot rasterizer: turns public/favicon.svg into the PNGs needed for
// iOS home-screen (apple-touch-icon) and Android PWA install (192 / 512).
// Re-run with `node scripts/gen-icons.mjs` if the SVG changes.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const svg = await readFile(join(publicDir, 'favicon.svg'));

const targets = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const { name, size } of targets) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(join(publicDir, name), png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} bytes)`);
}
