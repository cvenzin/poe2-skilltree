// Reproducible social artwork using the bundled GGG tree, without changing upstream data.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
// Pin the illustration so another game patch doesn't silently change branding.
const tree = JSON.parse(await readFile(`${publicDir}/trees/0.5.5/data.json`, 'utf8'));
const nodes = new Map(Object.entries(tree.nodes).filter(([, n]) =>
  !n.ascendancyId && !n.isMastery && !n.unlockConstraint &&
  Number.isFinite(n.x) && Number.isFinite(n.y)));
const edges = tree.edges.filter(e => nodes.has(String(e.from)) && nodes.has(String(e.to)));
const point = n => [1005 + n.x * .052, 650 + n.y * .052].map(v => v.toFixed(2));

// Decorative routes along real connections, not a recommended or budgeted build.
const start = [...nodes].find(([, n]) => n.classStartIndex?.includes(1))?.[0];
if (!start) throw new Error('Social illustration needs the Witch start in the pinned export');
const adjacent = new Map([...nodes.keys()].map(key => [key, []]));
for (const e of edges) {
  adjacent.get(String(e.from)).push(String(e.to));
  adjacent.get(String(e.to)).push(String(e.from));
}
const previous = new Map([[start, null]]);
const queue = [start];
for (let i = 0; i < queue.length; i++) {
  for (const next of adjacent.get(queue[i])) {
    if (previous.has(next)) continue;
    previous.set(next, queue[i]);
    queue.push(next);
  }
}
const selected = new Set();
for (const [x, y] of [[-1800, -9200], [2800, -6900], [-3800, -4700]]) {
  const target = [...nodes].filter(([key, n]) => previous.has(key) && n.isNotable)
    .sort((a, b) => Math.hypot(a[1].x - x, a[1].y - y) - Math.hypot(b[1].x - x, b[1].y - y))[0];
  if (!target) throw new Error('Social illustration has no reachable notable target');
  for (let key = target[0]; key; key = previous.get(key)) selected.add(key);
}
const line = e => {
  const [x1, y1] = point(nodes.get(String(e.from)));
  const [x2, y2] = point(nodes.get(String(e.to)));
  return `<path d="M${x1} ${y1} ${x2} ${y2}"/>`;
};
const activeEdges = edges.filter(e => previous.get(String(e.from)) === String(e.to) ||
  previous.get(String(e.to)) === String(e.from)).filter(e =>
  selected.has(String(e.from)) && selected.has(String(e.to)));
const circles = [...nodes].map(([key, n]) => {
  const [cx, cy] = point(n);
  const active = selected.has(key);
  const r = n.isKeystone ? 6 : n.isNotable ? 3.8 : 1.8;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${active ? '#e9ce8d' : '#111e20'}"
    stroke="${active ? '#fff0b3' : n.isNotable ? '#8e8057' : '#42514b'}" stroke-width="${active ? 1.3 : .8}"/>`;
}).join('');

const artwork = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="ambient" cx="82%" cy="40%" r="80%">
      <stop stop-color="#24433e"/><stop offset=".48" stop-color="#132423"/><stop offset="1" stop-color="#0c1215"/>
    </radialGradient>
    <linearGradient id="shade"><stop offset=".34" stop-color="#0c1215"/><stop offset=".63" stop-color="#0c1215" stop-opacity=".9"/><stop offset="1" stop-color="#0c1215" stop-opacity="0"/></linearGradient>
    <linearGradient id="gold"><stop stop-color="#fff0c2"/><stop offset="1" stop-color="#b78b4b"/></linearGradient>
    <linearGradient id="bottom" x2="0" y2="1"><stop stop-color="#0c1215" stop-opacity="0"/><stop offset="1" stop-color="#0c1215"/></linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <path fill="url(#ambient)" d="M0 0h1200v630H0z"/>
  <g fill="none" stroke="#a38750" opacity=".13">
    <circle cx="1005" cy="650" r="535"/><circle cx="1005" cy="650" r="545"/>
    <circle cx="1005" cy="650" r="320"/><path d="M1005 0v630M620 100l580 480"/>
  </g>
  <g fill="none" stroke="#687259" stroke-width=".85" opacity=".5">${edges.map(line).join('')}</g>
  <g fill="none" stroke="#e7bc6a" stroke-width="6" opacity=".55" filter="url(#glow)">${activeEdges.map(line).join('')}</g>
  <g fill="none" stroke="#ebca87" stroke-width="2.2">${activeEdges.map(line).join('')}</g>
  ${circles}
  <path fill="url(#shade)" d="M0 0h1200v630H0z"/>
  <path fill="url(#bottom)" d="M0 450h1200v180H0z"/>
  <path d="M56 146h132" stroke="#ba9458" stroke-width="2"/>
  <text x="145" y="88" fill="#dec79a" font-family="Arial, sans-serif" font-size="16" letter-spacing="3">POE2PLANNER.APP</text>
  <text x="56" y="210" fill="#87b7ab" font-family="Arial, sans-serif" font-size="14" letter-spacing="3.2">PATH OF EXILE 2</text>
  <text x="50" y="307" fill="url(#gold)" font-family="Georgia, serif" font-size="88">Forge your</text>
  <text x="50" y="401" fill="url(#gold)" font-family="Georgia, serif" font-size="88">own path.</text>
  <text x="56" y="454" fill="#c6ccc4" font-family="Arial, sans-serif" font-size="23">Your build starts with a single point.</text>
  <text x="56" y="539" fill="#d4c5a6" font-family="Arial, sans-serif" font-size="16" letter-spacing="1.3">PLAN. SHARE. TAKE IT IN-GAME.</text>
  <text x="56" y="574" fill="#899d96" font-family="Arial, sans-serif" font-size="15">Free passive tree planner · Mobile &amp; desktop</text>
  <path d="M24 24h1152v582H24z" fill="none" stroke="#aa8b52" stroke-opacity=".32"/>
  <path d="M24 55V24h31m1090 0h31v31M24 575v31h31m1090 0h31v-31" fill="none" stroke="#d8b875" stroke-width="2"/>
</svg>`);
const emblem = await sharp(`${publicDir}/favicon.svg`, { density: 192 }).resize(72, 72).png().toBuffer();
const output = await sharp(artwork).composite([{ input: emblem, left: 54, top: 44 }]).png().toBuffer();
await writeFile(`${publicDir}/social-preview.png`, output);
// Keep the previous public URL working for cached metadata and existing embeds.
await writeFile(`${publicDir}/og-image.png`, output);
console.log(`wrote public/social-preview.png (1200x630, ${output.length} bytes)`);
