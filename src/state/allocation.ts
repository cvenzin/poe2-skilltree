import type { TreeData } from '../data/types';
import { pruneConstraintLocked } from '../data/normalize';

/**
 * Weapon-set allocation model (see docs/weapon-set-support-plan.md).
 *
 * A node is allocated into exactly one of three buckets:
 *   - `shared` — active in both weapon sets
 *   - `set1`   — active only when Weapon Set 1 is the active set
 *   - `set2`   — active only when Weapon Set 2 is the active set
 *
 * The "active tree" for weapon set N is `shared ∪ setN` — that's what the
 * renderer paints and what pathing treats as the allocated frontier. The other
 * set's exclusive nodes are blocked from the active set's pathing and dimmed in
 * its view.
 *
 * Buckets are kept as immutable `ReadonlySet`s; every mutation returns a fresh
 * `Allocation` so Zustand change-detection and undo/redo snapshots work on
 * object identity.
 */
export interface Allocation {
  shared: ReadonlySet<string>;
  set1: ReadonlySet<string>;
  set2: ReadonlySet<string>;
}

/** Which weapon set is currently being viewed / edited. */
export type WeaponSet = 1 | 2;

/** How a freshly-clicked node is bucketed (driven by the toolbar selector). */
export type AllocationMode = 'shared' | 'set1' | 'set2';

/** Shared empty instance — safe to use as an initial value because every
 *  mutation helper returns a new object rather than mutating in place. */
export const EMPTY_ALLOCATION: Allocation = {
  shared: new Set<string>(),
  set1: new Set<string>(),
  set2: new Set<string>(),
};

export function isEmptyAllocation(a: Allocation): boolean {
  return a.shared.size === 0 && a.set1.size === 0 && a.set2.size === 0;
}

/** Total distinct allocated nodes across all buckets. A key lives in exactly
 *  one bucket, so this is a plain sum (no dedup needed). */
export function allocationSize(a: Allocation): number {
  return a.shared.size + a.set1.size + a.set2.size;
}

/** The exclusive bucket for a weapon set (everything in `setN`). */
export function exclusiveFor(a: Allocation, set: WeaponSet): ReadonlySet<string> {
  return set === 1 ? a.set1 : a.set2;
}

/**
 * Active tree for a weapon set: `shared ∪ setN`. A Set 1/Set 2 branch attaches
 * to the main (shared) tree, so its connectivity is evaluated over this union.
 */
export function activeTree(a: Allocation, set: WeaponSet): Set<string> {
  const out = new Set(a.shared);
  for (const k of exclusiveFor(a, set)) out.add(k);
  return out;
}

/** Every allocated node across all three buckets — what the renderer paints as
 *  allocated (both weapon-set trees are always shown). */
export function allAllocated(a: Allocation): Set<string> {
  const out = new Set(a.shared);
  for (const k of a.set1) out.add(k);
  for (const k of a.set2) out.add(k);
  return out;
}

/**
 * The connectable frontier when editing in `mode`:
 *   - main (shared): the main tree only — `shared`
 *   - set1: `shared ∪ set1` (the branch attaches to the main tree)
 *   - set2: `shared ∪ set2`
 */
export function frontierForMode(a: Allocation, mode: AllocationMode): Set<string> {
  if (mode === 'set1') return activeTree(a, 1);
  if (mode === 'set2') return activeTree(a, 2);
  return new Set(a.shared);
}

/**
 * Nodes that must be blocked from pathing when editing in `mode` — the main
 * tree can't route through weapon-set nodes, and the two sets can't route
 * through each other:
 *   - main (shared): block `set1 ∪ set2`
 *   - set1: block `set2`
 *   - set2: block `set1`
 */
export function blockedForMode(a: Allocation, mode: AllocationMode): Set<string> {
  const out = new Set<string>();
  if (mode === 'shared' || mode === 'set2') for (const k of a.set1) out.add(k);
  if (mode === 'shared' || mode === 'set1') for (const k of a.set2) out.add(k);
  return out;
}

/** Which bucket a key is in, or null if unallocated. */
export function bucketOf(a: Allocation, key: string): AllocationMode | null {
  if (a.shared.has(key)) return 'shared';
  if (a.set1.has(key)) return 'set1';
  if (a.set2.has(key)) return 'set2';
  return null;
}

/** True if `key` is allocated in any bucket. */
export function isAllocated(a: Allocation, key: string): boolean {
  return a.shared.has(key) || a.set1.has(key) || a.set2.has(key);
}

/**
 * Return a copy with every key in `keys` placed in `mode`'s bucket and removed
 * from the other two — enforcing the "exactly one bucket" invariant. Used to
 * allocate fresh path nodes into the tree currently being edited.
 */
export function addKeysToBucket(
  a: Allocation,
  keys: Iterable<string>,
  mode: AllocationMode,
): Allocation {
  const shared = new Set(a.shared);
  const set1 = new Set(a.set1);
  const set2 = new Set(a.set2);
  let target = shared;
  if (mode === 'set1') target = set1;
  else if (mode === 'set2') target = set2;
  for (const k of keys) {
    shared.delete(k);
    set1.delete(k);
    set2.delete(k);
    target.add(k);
  }
  return { shared, set1, set2 };
}

/**
 * Build a normalized {@link Allocation} from three raw key lists, enforcing the
 * "exactly one bucket" invariant: a key present in more than one list is kept
 * only in the highest-precedence bucket (`shared` > `set1` > `set2`). Used by
 * the persistence / share-hash decode layer where the three lists arrive
 * independently and could overlap (e.g. a hand-edited hash).
 */
export function buildAllocation(
  shared: Iterable<string>,
  set1: Iterable<string>,
  set2: Iterable<string>,
): Allocation {
  const s = new Set<string>(shared);
  const a1 = new Set<string>();
  for (const k of set1) if (!s.has(k)) a1.add(k);
  const a2 = new Set<string>();
  for (const k of set2) if (!s.has(k) && !a1.has(k)) a2.add(k);
  return { shared: s, set1: a1, set2: a2 };
}

/** Return a copy with `key` removed from whichever bucket holds it. Returns the
 *  same instance if the key wasn't allocated. */
export function removeKey(a: Allocation, key: string): Allocation {
  if (!isAllocated(a, key)) return a;
  const shared = new Set(a.shared); shared.delete(key);
  const set1 = new Set(a.set1); set1.delete(key);
  const set2 = new Set(a.set2); set2.delete(key);
  return { shared, set1, set2 };
}

/**
 * Drop constraint-locked nodes (e.g. Druid Oracle's Forbidden Path nodes when
 * "The Unseen Path" isn't allocated) from every bucket.
 *
 * The gate ("The Unseen Path") is an ascendancy notable that lives in the
 * `shared` bucket, so constraint satisfaction is evaluated against the union of
 * all three buckets — that union is what each weapon set's active tree shares.
 * Reuses {@link pruneConstraintLocked}'s fixed-point logic on the union, then
 * intersects each bucket with the survivors.
 *
 * Returns the same instance when nothing was pruned, so callers can cheaply
 * skip a no-op commit.
 */
export function pruneAllocation(
  a: Allocation,
  ascendancyId: string | null,
  data: TreeData,
): Allocation {
  if (data.constrainedNodeKeys.size === 0) return a;
  const union = new Set<string>(a.shared);
  for (const k of a.set1) union.add(k);
  for (const k of a.set2) union.add(k);
  const pruned = pruneConstraintLocked(union, ascendancyId, data);
  if (pruned.size === union.size) return a; // nothing removed
  const keep = (s: ReadonlySet<string>): Set<string> => {
    const out = new Set<string>();
    for (const k of s) if (pruned.has(k)) out.add(k);
    return out;
  };
  return { shared: keep(a.shared), set1: keep(a.set1), set2: keep(a.set2) };
}
