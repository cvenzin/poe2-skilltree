import type { TreeData, TreeNode } from '../data/types';
import { computeConstraintHiddenKeys } from '../data/normalize';

/**
 * Nodes the BFS must never traverse. `"root"` is the synthetic central node
 * that connects all 6 class starts — without blocking it, paths leak between
 * classes (BFS would walk start → root → some other class's start → tree).
 *
 * The caller adds any other-class start nodes per-render so the user can't
 * sneak into the tree from a class they didn't select.
 */
const ROOT_KEY = 'root';

/**
 * BFS-shortest-path implementation over the *unallocated* subgraph from the
 * allocation frontier (allocated ∪ class-start) to a target node.
 *
 * Treats edges as undirected (PoE's `in`/`out` are direction hints for the
 * data export, not gameplay constraints — you can traverse either way).
 *
 * `blockedKeys` is the set of node keys BFS must skip entirely — neither
 * visited nor traversed-through. Always includes `"root"`; the caller adds
 * the 5 non-selected class start nodes so a far-away click can't path
 * through them. If `target` is itself blocked (e.g. the user clicked another
 * class's start node), this returns `null` and the click becomes a no-op.
 *
 * Returns the path as `[firstNewNode, ..., target]` — i.e. the **nodes to
 * be added** to commit this allocation. Empty array means target is already
 * in the frontier; `null` means target is unreachable.
 *
 * Cheap enough to run per pointermove on a ~5000-node graph; memoising on
 * (allocated, target) is a later optimisation if needed.
 */
export function bfsShortestPath(
  data: TreeData,
  allocated: ReadonlySet<string>,
  classStartKey: string,
  target: string,
  blockedKeys: ReadonlySet<string> = new Set([ROOT_KEY]),
): string[] | null {
  if (target === classStartKey) return [];
  if (allocated.has(target)) return [];
  // Other classes' start nodes are off-limits. Even if a stale build still
  // has one in `allocated` (legacy state from before this rule), the seed
  // step below also drops blocked keys from the frontier, so BFS never
  // expands from one.
  if (blockedKeys.has(target)) return null;

  const ctx: BfsContext = {
    data,
    target,
    blockedKeys,
    visited: new Set<string>(),
    parent: new Map<string, string>(),
    queue: [],
  };
  seedFrontier(ctx, allocated, classStartKey);

  while (ctx.queue.length > 0) {
    const current = ctx.queue.shift()!;
    if (expandFrom(ctx, current)) return reconstructPath(ctx.parent, target);
  }
  return null;
}

interface BfsContext {
  data: TreeData;
  target: string;
  blockedKeys: ReadonlySet<string>;
  visited: Set<string>;
  parent: Map<string, string>;
  queue: string[];
}

/** Multi-source BFS seed: every allocated node + the selected class start sit
 *  at distance 0 in the visited set and the queue.
 *
 *  Blocked keys in `allocated` are skipped — they would otherwise let a
 *  legacy build (allocated another class's start before the strict rule
 *  landed) act as a fresh frontier on every BFS, leaking expansion through
 *  the wrong class. They stay visually allocated; cascade-unallocate via a
 *  click still removes them. */
function seedFrontier(
  ctx: BfsContext,
  allocated: ReadonlySet<string>,
  classStartKey: string,
): void {
  for (const key of allocated) {
    if (ctx.blockedKeys.has(key)) continue;
    ctx.visited.add(key);
    ctx.queue.push(key);
  }
  if (!ctx.visited.has(classStartKey)) {
    ctx.visited.add(classStartKey);
    ctx.queue.push(classStartKey);
  }
}

/** Visit each neighbour of `current`. Returns true if the target was reached.
 *  Blocked neighbours are skipped entirely — neither traversed nor reached. */
function expandFrom(ctx: BfsContext, current: string): boolean {
  const node = ctx.data.nodes[current];
  if (!node) return false;
  for (const neighbour of neighbours(node)) {
    if (ctx.visited.has(neighbour)) continue;
    if (ctx.blockedKeys.has(neighbour)) continue;
    ctx.visited.add(neighbour);
    ctx.parent.set(neighbour, current);
    if (neighbour === ctx.target) return true;
    ctx.queue.push(neighbour);
  }
  return false;
}

/** Build the blocked-key set for the main-tree BFS. Blocks:
 *
 *   1. Synthetic `"root"` (would otherwise shortcut between all class starts).
 *   2. The 5 non-selected class-start nodes (so BFS can't begin a path from
 *      another class's start).
 *   3. Every node carrying an `ascendancyId` that isn't the currently
 *      selected one. These are rendered in the separate ascendancy overlay
 *      (not in the main tree), but the export still wires bogus tree edges
 *      from them into main-tree notables (e.g. Ranger3's "Path of the
 *      Sorceress / Warrior / Seeker" trio sits at world coord ~(16500,6800)
 *      but has main-tree edges into Energy Shield and Melee Damage). BFS
 *      walking those edges produces nonsense shortcuts like
 *      `Witch → Energy Shield → Path of Sorceress → Path Seeker → Path of
 *      Warrior → Melee Damage`, giving Witch a 5-hop reach into Warrior's
 *      subtree. Blocking these nodes from traversal closes that leak.
 *   4. Nodes whose `unlockConstraint` isn't currently satisfied. In 0.5.0 this
 *      is the 200 main-tree nodes gated behind Druid Oracle's "The Unseen
 *      Path" (skill 5571). Without 5571 allocated, they're invisible in-game
 *      and BFS must not route through (or to) them.
 *
 *  When an ascendancy is selected, that ascendancy's nodes are NOT blocked —
 *  but the main-tree BFS still won't normally reach them unless the data
 *  has a legitimate bridge (which is the future-work case).
 *
 *  Strict blocking: blocked nodes are never traversed AND never targetable
 *  AND never seeded as frontier even if stale state has them in `allocated`. */
export function buildBlockedKeys(
  data: TreeData,
  selectedClassStartKey: string,
  selectedAscendancyId: string | null,
  allocated: ReadonlySet<string>,
): Set<string> {
  const blocked = new Set<string>([ROOT_KEY]);
  for (const startKey of data.startNodeByClassIndex.values()) {
    if (startKey !== selectedClassStartKey) blocked.add(startKey);
  }
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.ascendancyId && node.ascendancyId !== selectedAscendancyId) {
      blocked.add(key);
    }
    // Masteries are PoE 1 leftovers in the 0.5.0 export — not allocatable
    // in PoE 2. But in the edge graph they sit as the hub of each cluster,
    // wiring the cluster's notables together. If BFS traverses them, a path
    // to one notable silently allocates the mastery and any other notable
    // it connects to, with no visible edge (mastery edges are filtered in
    // resolveDrawableEdge). Block them: each notable must be reached via
    // its own non-mastery chain. Verified safe — no normal node is reachable
    // only through a mastery in the 0.5.0 main tree.
    if (node.isMastery) blocked.add(key);
  }
  for (const key of computeConstraintHiddenKeys(data, selectedAscendancyId, allocated)) {
    blocked.add(key);
  }
  return blocked;
}

/** Druid Oracle's "Entwined Realities" ascendancy notable (skill 32905):
 *  "Non-Keystone Passive Skills in Medium Radius of allocated Keystone Passive
 *  Skills can be allocated without being connected to your tree."
 *
 *  The export doesn't ship a numeric Medium Radius, so we use 1200 world units
 *  — the same approximation the jewel-socket overlay uses for PoE 1's medium
 *  jewels. Ascendancies don't have keystones, so only main-tree keystones gate
 *  the effect. */
const ENTWINED_REALITIES_SKILL_ID = 32905;
export const MEDIUM_RADIUS = 1200;
const MEDIUM_RADIUS_SQ = MEDIUM_RADIUS * MEDIUM_RADIUS;

export function isEntwinedRealitiesActive(
  data: TreeData,
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
): boolean {
  if (ascendancyId !== 'Druid1') return false;
  const key = data.nodeBySkillId.get(ENTWINED_REALITIES_SKILL_ID);
  return key !== undefined && allocated.has(key);
}

/** Set of main-tree non-keystone passive nodes that "Entwined Realities" lets
 *  the player allocate without a connecting path. Empty when the ascendancy
 *  isn't Druid Oracle, the notable isn't allocated, or no keystone is taken.
 *
 *  Excludes ascendancy nodes, masteries, class starts, and constraint-hidden
 *  nodes (e.g. Forbidden Path nodes when "The Unseen Path" isn't allocated). */
export function computeEntwinedAllocatableKeys(
  data: TreeData,
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  hiddenKeys: ReadonlySet<string>,
): Set<string> {
  if (!isEntwinedRealitiesActive(data, allocated, ascendancyId)) return new Set();
  const keystonePoints: { x: number; y: number }[] = [];
  for (const key of allocated) {
    const n = data.nodes[key];
    if (!n?.isKeystone) continue;
    if (n.x === undefined || n.y === undefined) continue;
    keystonePoints.push({ x: n.x, y: n.y });
  }
  if (keystonePoints.length === 0) return new Set();

  const out = new Set<string>();
  for (const [key, n] of Object.entries(data.nodes)) {
    if (!isEntwinedEligible(key, n, hiddenKeys)) continue;
    if (isWithinAnyRadius(n.x!, n.y!, keystonePoints)) out.add(key);
  }
  return out;
}

function isEntwinedEligible(
  key: string,
  n: TreeNode,
  hiddenKeys: ReadonlySet<string>,
): boolean {
  if (key === ROOT_KEY) return false;
  if (n.ascendancyId) return false;
  if (n.isKeystone) return false;
  if (n.isMastery) return false;
  if (n.classStartIndex && n.classStartIndex.length > 0) return false;
  if (n.x === undefined || n.y === undefined) return false;
  if (hiddenKeys.has(key)) return false;
  return true;
}

function isWithinAnyRadius(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  for (const p of points) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy <= MEDIUM_RADIUS_SQ) return true;
  }
  return false;
}

function nodeNeighbours(node: TreeNode): readonly string[] {
  return [...(node.in ?? []), ...(node.out ?? [])];
}

/** Option of a multiple-choice hub. Driven by the explicit
 *  `isMultipleChoiceOption` flag in the data — NOT graph topology — because
 *  some options have onward connections (Path Seeker's Path of the
 *  Warrior/Sorceress route into other tree regions) and a topology-based
 *  check would silently exclude them. */
export function isMcOption(
  data: Pick<TreeData, 'nodes'>,
  key: string,
): boolean {
  return data.nodes[key]?.isMultipleChoiceOption === true;
}

/** Options of the given MC hub. */
export function optionsOfHub(
  data: Pick<TreeData, 'nodes'>,
  hubKey: string,
): string[] {
  const hub = data.nodes[hubKey];
  if (!hub?.isMultipleChoice) return [];
  const out: string[] = [];
  for (const nbr of nodeNeighbours(hub)) {
    if (isMcOption(data, nbr)) out.push(nbr);
  }
  return out;
}

/** The MC hub an option belongs to. Null if the node isn't an MC option or
 *  has no MC-hub neighbour. */
export function hubOfOption(
  data: Pick<TreeData, 'nodes'>,
  optionKey: string,
): string | null {
  const node = data.nodes[optionKey];
  if (!node?.isMultipleChoiceOption) return null;
  for (const nbr of nodeNeighbours(node)) {
    if (data.nodes[nbr]?.isMultipleChoice) return nbr;
  }
  return null;
}

/** Options that must be auto-allocated to satisfy the MC-hub rule for the
 *  given path. For each MC hub the path crosses without a committed option,
 *  picks the hub's first option (data order) as a default — the user can
 *  swap it later by clicking the alternative. Empty when the path already
 *  satisfies the rule. */
export function autoOptionsForPath(
  data: Pick<TreeData, 'nodes'>,
  path: readonly string[],
  allocated: ReadonlySet<string>,
): string[] {
  const picks: string[] = [];
  for (const key of path) {
    const node = data.nodes[key];
    if (!node?.isMultipleChoice) continue;
    const options = optionsOfHub(data, key);
    if (options.length === 0) continue;
    if (options.some((o) => allocated.has(o) || path.includes(o) || picks.includes(o))) continue;
    picks.push(options[0]!);
  }
  return picks;
}

/**
 * Compute the new `allocated` set after a node is removed (clicked while
 * already allocated). Cascades — any allocated node that no longer has a
 * connected route back to a frontier root is also removed.
 *
 * Multi-source BFS from every key in `frontierKeys` (the main class start
 * plus the selected ascendancy start, if any) over `allocated \ {removed}`;
 * everything not visited drops out of the new allocated set. The removed node
 * itself is never re-added.
 *
 * Why multi-source: ascendancy nodes connect to the ascendancy start, which
 * is implicit and never stored in `allocated`. A BFS seeded only from the
 * main class start would hit the ascendancy start as a neighbour, see it
 * isn't in `remaining`, and stop — judging the entire ascendancy branch
 * unreachable and dropping it on every click. Seeding from both starts lets
 * BFS treat each as its own implicit root.
 */
export function cascadeUnallocate(
  data: TreeData,
  allocated: ReadonlySet<string>,
  frontierKeys: ReadonlySet<string>,
  removed: string,
  ascendancyId: string | null = null,
  hiddenKeys: ReadonlySet<string> = EMPTY_SET,
): Set<string> {
  if (!allocated.has(removed)) return new Set(allocated);

  let current = new Set(allocated);
  current.delete(removed);

  // Iterate: walk reachability, then drop any MC hub that has options but
  // none currently allocated (rule a + b — the hub is implicit, valid only
  // when an option is held). Dropping a hub can orphan whatever sits past
  // it, so re-walk until the set is stable.
  for (;;) {
    const seeds = collectCascadeSeeds(data, current, frontierKeys, ascendancyId, hiddenKeys);
    const reachable = walkAllocated(data, current, seeds);
    const droppedHub = dropOptionlessMcHubs(data, reachable);
    if (!droppedHub) {
      for (const key of frontierKeys) reachable.delete(key);
      return reachable;
    }
    current = reachable;
  }
}

/** Drop any MC hub in `set` whose options exist but none are present.
 *  Mutates `set`. Returns true if anything was removed (caller re-walks since
 *  removing a hub can orphan nodes past it). */
function dropOptionlessMcHubs(
  data: Pick<TreeData, 'nodes'>,
  set: Set<string>,
): boolean {
  let changed = false;
  for (const key of [...set]) {
    const node = data.nodes[key];
    if (!node?.isMultipleChoice) continue;
    const options = optionsOfHub(data, key);
    if (options.length === 0) continue;
    if (options.some((o) => set.has(o))) continue;
    set.delete(key);
    changed = true;
  }
  return changed;
}

/** Seed set for cascade BFS: class/ascendancy starts + Entwined Realities
 *  anchors. Each anchor is an allocated node within Medium Radius of an
 *  allocated keystone (when the notable is itself allocated on Druid Oracle);
 *  treating it as a reachability root keeps deliberately-disconnected nodes
 *  from being dropped when neighbours change. */
function collectCascadeSeeds(
  data: TreeData,
  remaining: ReadonlySet<string>,
  frontierKeys: ReadonlySet<string>,
  ascendancyId: string | null,
  hiddenKeys: ReadonlySet<string>,
): string[] {
  const seeds: string[] = [...frontierKeys];
  const entwined = computeEntwinedAllocatableKeys(data, remaining, ascendancyId, hiddenKeys);
  for (const key of remaining) {
    if (entwined.has(key)) seeds.push(key);
  }
  return seeds;
}

function walkAllocated(
  data: TreeData,
  remaining: ReadonlySet<string>,
  seeds: readonly string[],
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const node = data.nodes[current];
    if (!node) continue;
    for (const neighbour of neighbours(node)) {
      if (remaining.has(neighbour) && !reachable.has(neighbour)) {
        queue.push(neighbour);
      }
    }
  }
  return reachable;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function neighbours(node: TreeNode): readonly string[] {
  // PoE edge lists are direction-tagged but gameplay is undirected, so we
  // walk both `in` and `out`. Deduplication isn't worth it — the visited
  // set in BFS already prevents revisits.
  if (node.in.length === 0) return node.out;
  if (node.out.length === 0) return node.in;
  return [...node.in, ...node.out];
}

function reconstructPath(parent: Map<string, string>, target: string): string[] {
  const path: string[] = [];
  let cur: string | undefined = target;
  while (cur !== undefined && parent.has(cur)) {
    path.unshift(cur);
    cur = parent.get(cur);
  }
  return path;
}
