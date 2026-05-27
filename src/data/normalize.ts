import type { RawTreeData, TreeData, Edge } from './types';

// data.json arrives with mixed-type edge endpoints ("root" string, otherwise
// numeric). The renderer + pathing code only deals in node *keys*, which are
// always strings. Stringify everything once at load.
export function normalizeTreeData(raw: RawTreeData): TreeData {
  const edges: Edge[] = raw.edges.map((e) => ({
    from: String(e.from),
    to: String(e.to),
    orbit: e.orbit,
    orbitX: e.orbitX,
    orbitY: e.orbitY,
  }));

  // skill (numeric) → node key. The key is often the same string, but not
  // guaranteed — always look up via this map when you only have the skill id.
  const nodeBySkillId = new Map<number, string>();
  for (const [key, node] of Object.entries(raw.nodes)) {
    if (typeof node.skill === 'number') {
      nodeBySkillId.set(node.skill, key);
    }
  }

  // class index (into raw.classes[]) → start node key.
  // The six start nodes carry `classStartIndex: [a, b]` (PoE 1 + PoE 2 share).
  const startNodeByClassIndex = new Map<number, string>();
  for (const [key, node] of Object.entries(raw.nodes)) {
    if (node.classStartIndex) {
      for (const idx of node.classStartIndex) startNodeByClassIndex.set(idx, key);
    }
  }

  // Which ascendancyIds have at least one node in the data? Used to filter
  // empty-tree ascendancies like Witch3b (Abyssal Lich in 0.5.0).
  const ascIdsWithNodes = new Set<string>();
  for (const node of Object.values(raw.nodes)) {
    if (node.ascendancyId) ascIdsWithNodes.add(node.ascendancyId);
  }

  // Playable = classes with at least one *valid* ascendancy:
  //   - PoE 1 placeholder classes (Marauder, Duelist, Shadow, Templar) have
  //     empty `ascendancies` and are filtered out at the class level.
  //   - Unreleased/unfinished ascendancies show as `name === 'None'`
  //     (Ranger2, Druid3 in 0.5.0) — drop those.
  //   - Ascendancies with no nodes (Witch3b in 0.5.0) — drop those.
  const playableClassIndices: number[] = [];
  const playableAscendancyIds = new Set<string>();
  raw.classes.forEach((c, i) => {
    if (!c.ascendancies || c.ascendancies.length === 0) return;
    let anyValid = false;
    for (const asc of c.ascendancies) {
      if (!isValidAscendancy(asc, ascIdsWithNodes)) continue;
      playableAscendancyIds.add(asc.id);
      anyValid = true;
    }
    if (anyValid) playableClassIndices.push(i);
  });

  warnOnSuspiciousCrossClusterEdges(raw, edges, startNodeByClassIndex);
  warnOnEdgesOverdrawingNodes(raw, edges);

  return {
    ...raw,
    edges,
    nodeBySkillId,
    startNodeByClassIndex,
    playableClassIndices,
    playableAscendancyIds,
  };
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

function isValidAscendancy(
  asc: { id: string; name: string | null },
  ascIdsWithNodes: ReadonlySet<string>
): boolean {
  // `name` is JSON `null` for unreleased ascendancies (Ranger2, Druid3 in 0.5.0).
  if (!asc.name) return false;
  if (!ascIdsWithNodes.has(asc.id)) return false; // no tree (Witch3b in 0.5.0)
  return true;
}

// Resolve a class name → start node key. Throws on unknown class / missing
// start node, since these are programmer errors, not user input.
export function startNodeKeyForClass(className: string, data: TreeData): string {
  const idx = data.classes.findIndex((c) => c.name === className);
  if (idx < 0) throw new Error(`Unknown class: ${className}`);
  const key = data.startNodeByClassIndex.get(idx);
  if (!key) throw new Error(`No start node for class index ${idx} (${className})`);
  return key;
}
