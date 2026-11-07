import type { Edge, RawTreeData } from './types';

/**
 * Run the export sanity checks — OFF by default, opt-in only. `warnOnEdgesOverdrawingNodes`
 * is O(edges × nodes) (~30M trig ops on the 0.5.0 tree), which froze the loading screen
 * on mobile when it ran on every load, and even in dev it adds a noticeable hitch. Both
 * checks only emit a `console.warn` for developers, so they run only when you explicitly
 * opt in for a session:
 *
 *   - inline (PowerShell):  $env:VITE_TREE_DIAGNOSTICS='true'; npm run dev
 *   - or add to .env.local:  VITE_TREE_DIAGNOSTICS=true
 *
 * The `import.meta.env.DEV` guard is statically `false` in a production build, so Vite
 * tree-shakes the whole thing out regardless of the flag — users never pay for it.
 */
export function runExportDiagnostics(
  raw: RawTreeData,
  edges: Edge[],
  startNodeByClassIndex: ReadonlyMap<number, string>,
): void {
  warnOnSuspiciousCrossClusterEdges(raw, edges, startNodeByClassIndex);
  warnOnEdgesOverdrawingNodes(raw, edges);
}

/**
 * Sanity check for `data.json`: cross-cluster edges that don't pass through a
 * class-start node.
 *
 * Legitimate cross-cluster edges go `<class start> ↔ <ascendancy start>`
 * (e.g. Marauder/Warrior start ↔ Titan / Brute / Smith of Kitava). 0.5.0
 * also ships 4 bogus edges from Ranger3's "Path of the Sorceress" /
 * "Path of the Warrior" nodes into main-tree notables (Energy Shield,
 * Spell Damage, Armour, Melee Damage). Those let BFS shortcut between
 * classes through invisible-to-the-renderer nodes; the BFS already filters
 * them via `buildBlockedKeys`, but the data is wrong and a future export
 * could ship new variants of this quirk.
 *
 * Logged once per load so we notice if a new export shows up with extra
 * crossings. Doesn't fail or alter data — pathing already defends against it.
 */
function warnOnSuspiciousCrossClusterEdges(
  raw: RawTreeData,
  edges: Edge[],
  startNodeByClassIndex: ReadonlyMap<number, string>,
): void {
  const startKeys = new Set(startNodeByClassIndex.values());
  const suspicious: { from: string; to: string; fromName?: string; toName?: string; via?: string }[] = [];
  for (const e of edges) {
    const a = raw.nodes[e.from];
    const b = raw.nodes[e.to];
    if (!a || !b) continue;
    if (a.ascendancyId === b.ascendancyId) continue; // same cluster
    if (a.ascendancyId && b.ascendancyId) continue;  // ascendancy↔ascendancy (none in 0.5.0)
    const mainKey = a.ascendancyId ? e.to : e.from;
    if (startKeys.has(mainKey)) continue; // legitimate <class start> ↔ <ascendancy entry>
    suspicious.push({
      from: e.from, to: e.to,
      fromName: a.name, toName: b.name,
      via: a.ascendancyId ?? b.ascendancyId,
    });
  }
  if (suspicious.length === 0) return;
  console.warn(
    `[data] ${suspicious.length} suspicious cross-cluster edge(s) in the export ` +
    `(main-tree ↔ ascendancy outside the class-start entry). BFS already ` +
    `blocks ascendancy nodes from traversal via buildBlockedKeys, but this ` +
    `means the data wires invisible nodes into the main tree — log here so a ` +
    `future export change shows up if it adds new ones.`,
    suspicious,
  );
}

/**
 * Sanity check for `data.json`: straight edges (no `orbitX/Y`) whose visual
 * line passes through a non-endpoint node in the same group as at least one
 * endpoint. In 0.5.0 this catches 4-5 clusters where a notable sits at orbit
 * 0 (group centre) between two orbit-2 flankers, and the flanker↔flanker
 * edge is exported without arc data — so it's drawn as a straight line
 * overlapping the notable. Three sibling clusters carry proper `orbit` data
 * and render correctly, so this is a per-edge export miss.
 *
 * Logged-only — we don't patch arc data on the fly because the correct arc
 * centre isn't always the notable's position (some siblings use offset
 * centres) and an incorrect synthesis could hide deeper issues. BFS isn't
 * affected; this is purely a visual artefact.
 */
function warnOnEdgesOverdrawingNodes(raw: RawTreeData, edges: Edge[]): void {
  const issues: EdgeOverdrawIssue[] = [];
  for (const e of edges) {
    collectEdgeOverdrawIssues(raw, e, issues);
  }
  if (issues.length === 0) return;
  console.warn(
    `[data] ${issues.length} straight edge(s) in the export visually pass through ` +
    `a non-endpoint same-group node — the edge is missing arc fields (orbitX/Y). ` +
    `Renderer draws them straight; user sees a line through the obstacle node. ` +
    `Sibling clusters in the same data ship proper arc data, so this is a ` +
    `per-edge export miss. Not patched — log only.`,
    issues,
  );
}

interface EdgeOverdrawIssue {
  from: string;
  to: string;
  obstacle: string;
  obstacleName?: string;
  dist: number;
}

const OVERLAP_THRESHOLD = 60; // world units — roughly a node's visual radius

function collectEdgeOverdrawIssues(raw: RawTreeData, e: Edge, out: EdgeOverdrawIssue[]): void {
  if (e.orbitX !== undefined) return; // already curved
  const a = raw.nodes[e.from];
  const b = raw.nodes[e.to];
  if (!a || !b) return;
  if (a.x === undefined || a.y === undefined) return;
  if (b.x === undefined || b.y === undefined) return;
  if (a.isMastery || b.isMastery) return;
  for (const [k, n] of Object.entries(raw.nodes)) {
    const issue = obstacleIssue(e, a, b, k, n);
    if (issue) out.push(issue);
  }
}

function obstacleIssue(
  e: Edge,
  a: RawTreeData['nodes'][string],
  b: RawTreeData['nodes'][string],
  k: string,
  n: RawTreeData['nodes'][string],
): EdgeOverdrawIssue | null {
  if (k === e.from || k === e.to) return null;
  if (n.x === undefined || n.y === undefined) return null;
  if (n.isMastery) return null;
  if (n.group !== a.group && n.group !== b.group) return null;
  const d = distanceToSegment(n.x, n.y, a.x!, a.y!, b.x!, b.y!);
  if (d >= OVERLAP_THRESHOLD) return null;
  return { from: e.from, to: e.to, obstacle: k, obstacleName: n.name, dist: Math.round(d) };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
