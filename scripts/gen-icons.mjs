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

// 1200x630 Open Graph image — required aspect ratio for Twitter / Discord /
// Slack / Reddit link previews. Built by compositing the favicon at 360x360
// onto a dark canvas matching the app palette. Platforms draw the title/
// description text from the og:title / og:description tags separately, so
// the image itself only needs the icon.
const OG_BG = { r: 0x14, g: 0x1a, b: 0x24 };
const ogBg = await sharp({
  create: { width: 1200, height: 630, channels: 3, background: OG_BG },
}).png().toBuffer();
const ogIcon = await sharp(svg, { density: 768 })
  .resize(360, 360)
  .png()
  .toBuffer();
const ogPng = await sharp(ogBg)
  .composite([{ input: ogIcon, gravity: 'center' }])
  .png()
  .toBuffer();
await writeFile(join(publicDir, 'og-image.png'), ogPng);
console.log(`wrote public/og-image.png (1200x630, ${ogPng.length} bytes)`);
