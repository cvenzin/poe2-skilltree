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
  removed: string
): Set<string> {
  if (!allocated.has(removed)) return new Set(allocated);

  const remaining = new Set(allocated);
  remaining.delete(removed);

  const reachable = new Set<string>();
  const queue: string[] = [...frontierKeys];

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

  // Drop the frontier roots themselves — they're implicit, not part of `allocated`.
  for (const key of frontierKeys) reachable.delete(key);
  return reachable;
}

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
