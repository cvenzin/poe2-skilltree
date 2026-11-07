import { computeConstraintHiddenKeys } from '../data/normalize';
import type { TreeData } from '../data/types';
import { allAllocated, frontierForMode, blockedForMode, type Allocation, type AllocationMode } from '../state/allocation';
import { buildBlockedKeys, computeEntwinedAllocatableKeys, isEntwinedRealitiesActive } from './pathing';

/** Allocation and graph context shared by previews and committed node edits. */
export interface PathingContext {
  classStartKey: string;
  ascendancyId: string | null;
  allAllocated: ReadonlySet<string>;
  frontierKeys: ReadonlySet<string>;
  /** Roots and connectable allocations for each editing mode. */
  frontierByMode: Record<AllocationMode, ReadonlySet<string>>;
  /** Graph exclusions and allocations the mode cannot route through. */
  blockedByMode: Record<AllocationMode, ReadonlySet<string>>;
  hiddenKeys: ReadonlySet<string>;
  /** Nodes accessible without a connecting path through Entwined Realities. */
  entwinedKeys: ReadonlySet<string>;
  entwinedActive: boolean;
}

/** Build the full pathing context for the current allocation. Computes the
 *  base block set once, then the per-edit-mode frontier and blocked sets (the
 *  main tree can't route through weapon-set nodes; the sets can't route through
 *  each other). Constraint gates are shared ascendancy
 *  nodes; Entwined anchors must also belong to the shared tree. */
export function buildPathingContext(
  data: TreeData,
  classStartKey: string,
  ascendancyId: string | null,
  frontierKeys: ReadonlySet<string>,
  allocation: Allocation,
): PathingContext {
  const all = allAllocated(allocation);
  const hiddenKeys = computeConstraintHiddenKeys(data, ascendancyId, all);
  const base = buildBlockedKeys(data, classStartKey, ascendancyId, all);
  const frontier = (mode: AllocationMode) =>
    new Set([...frontierKeys, ...frontierForMode(allocation, mode)]);
  const withBlocked = (extra: ReadonlySet<string>, exclusive = false): Set<string> => {
    const out = new Set(base);
    for (const k of extra) out.add(k);
    if (exclusive) {
      for (const [key, node] of Object.entries(data.nodes)) {
        const requiresMain = node.isKeystone || node.isJewelSocket || (node.ascendancyId && !node.isAscendancyStart);
        if (requiresMain && !allocation.shared.has(key)) out.add(key);
      }
    }
    return out;
  };
  return {
    classStartKey,
    ascendancyId,
    frontierKeys,
    allAllocated: all,
    frontierByMode: {
      shared: frontier('shared'),
      set1: frontier('set1'),
      set2: frontier('set2'),
    },
    blockedByMode: {
      shared: withBlocked(blockedForMode(allocation, 'shared')),
      set1: withBlocked(blockedForMode(allocation, 'set1'), true),
      set2: withBlocked(blockedForMode(allocation, 'set2'), true),
    },
    hiddenKeys,
    entwinedKeys: computeEntwinedAllocatableKeys(data, allocation.shared, ascendancyId, hiddenKeys),
    entwinedActive: isEntwinedRealitiesActive(data, allocation.shared, ascendancyId),
  };
}
