import type { RawTreeData, TreeData, Edge, UnlockConstraint } from './types';

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

  // Nodes whose visibility/allocation gates on `unlockConstraint`. In 0.5.0 the
  // only emitter is Druid Oracle's "The Unseen Path" (skill 5571), which gates
  // 200 main-tree "Forbidden Path" nodes. Iterated by pathing/render whenever
  // allocation changes — keep the set hot so we don't re-scan ~5000 nodes.
  const constrainedNodeKeys = new Set<string>();
  for (const [key, node] of Object.entries(raw.nodes)) {
    if (node.unlockConstraint) constrainedNodeKeys.add(key);
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
    constrainedNodeKeys,
  };
}

/** Evaluate an `unlockConstraint` against the current ascendancy + allocation.
 *  Satisfied = (constraint's ascendancy, if set, matches the selected one) AND
 *  every skill in `constraint.nodes` is currently allocated.
 *
 *  Resolves skill ids → node keys via `data.nodeBySkillId`; an id with no node
 *  fails closed (constraint unsatisfiable). */
export function isUnlockConstraintSatisfied(
  constraint: UnlockConstraint,
  ascendancyId: string | null,
  allocated: ReadonlySet<string>,
  data: Pick<TreeData, 'nodeBySkillId'>,
): boolean {
  if (constraint.ascendancy && constraint.ascendancy !== ascendancyId) return false;
  for (const skillId of constraint.nodes) {
    const key = data.nodeBySkillId.get(skillId);
    if (!key) return false;
    if (!allocated.has(key)) return false;
  }
  return true;
}

/** Return the set of constraint-locked node keys that are currently hidden
 *  (constraint unsatisfied). Empty when no constrained nodes exist or all
 *  constraints are met. */
export function computeConstraintHiddenKeys(
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId' | 'constrainedNodeKeys'>,
  ascendancyId: string | null,
  allocated: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>();
  for (const key of data.constrainedNodeKeys) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (!isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) {
      hidden.add(key);
    }
  }
  return hidden;
}

/**
 * Drop nodes from `allocated` whose `unlockConstraint` is no longer satisfied
 * by the current `(ascendancyId, allocated)` state. Runs to a fixed point so a
 * cascade (e.g. unallocating a gate that itself enables a deeper gate) settles
 * in one call.
 *
 * In 0.5.0 every constraint references Druid Oracle's "The Unseen Path"
 * (skill 5571), so this almost always converges in one pass — but the loop
 * costs nothing and shields against future chained constraints.
 *
 * Returns the *same* set instance when nothing was pruned, so callers can
 * cheaply compare identity to decide whether to push undo history.
 */
export function pruneConstraintLocked(
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId' | 'constrainedNodeKeys'>,
): ReadonlySet<string> {
  if (data.constrainedNodeKeys.size === 0) return allocated;
  let current = allocated;
  let next = prunePass(current, ascendancyId, data);
  while (next !== current) {
    current = next;
    next = prunePass(current, ascendancyId, data);
  }
  return current;
}

function prunePass(
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId'>,
): ReadonlySet<string> {
  let pruned: Set<string> | null = null;
  for (const key of allocated) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) continue;
    pruned ??= new Set(allocated);
    pruned.delete(key);
  }
  return pruned ?? allocated;
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
