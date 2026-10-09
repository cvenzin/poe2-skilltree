import type { TreeData } from '../../data/types';
import { allAllocated, frontierForMode, blockedForMode } from '../../state/allocation';
import type { Allocation } from '../../state/allocation';
import type { PathingContext, MountContext } from './types';
import { computeConstraintHiddenKeys } from '../../data/normalize';
import { buildBlockedKeys, computeEntwinedAllocatableKeys, isEntwinedRealitiesActive } from '../../interaction/pathing';

/** Build the full pathing context for the current allocation. Computes the
 *  base block set once, then the per-edit-mode frontier and blocked sets (the
 *  main tree can't route through weapon-set nodes; the sets can't route through
 *  each other). Constraint / entwined state is evaluated against the union of
 *  all allocated nodes (the constraint gate is a shared ascendancy node). */
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
  const withBlocked = (extra: ReadonlySet<string>): Set<string> => {
    const out = new Set(base);
    for (const k of extra) out.add(k);
    return out;
  };
  return {
    classStartKey,
    ascendancyId,
    frontierKeys,
    allAllocated: all,
    frontierByMode: {
      shared: frontierForMode(allocation, 'shared'),
      set1: frontierForMode(allocation, 'set1'),
      set2: frontierForMode(allocation, 'set2'),
    },
    blockedByMode: {
      shared: withBlocked(blockedForMode(allocation, 'shared')),
      set1: withBlocked(blockedForMode(allocation, 'set1')),
      set2: withBlocked(blockedForMode(allocation, 'set2')),
    },
    hiddenKeys,
    entwinedKeys: computeEntwinedAllocatableKeys(data, all, ascendancyId, hiddenKeys),
    entwinedActive: isEntwinedRealitiesActive(data, all, ascendancyId),
  };
}

/** Recompute the constraint-derived parts of `ctx.pathing` from the latest
 *  allocation. Called on every allocation change because constraints (and the
 *  per-mode block sets) flip when nodes are added or removed. Preserves the
 *  existing `ascendancyId` / `classStartKey` — those only change in
 *  {@link swapContext}. */
export function refreshConstraintState(
  ctx: MountContext,
  data: TreeData,
  allocation: Allocation,
): void {
  if (!ctx.pathing) return;
  const { classStartKey, ascendancyId, frontierKeys } = ctx.pathing;
  ctx.pathing = buildPathingContext(data, classStartKey, ascendancyId, frontierKeys, allocation);
}

/** Toggle wrap visibility for constraint-locked nodes. Hidden wraps lose all
 *  interactivity (`eventMode = 'none'`) so they can't intercept pointer events
 *  meant for the empty space they occupy. Constraint-locked nodes never reach
 *  the visible/interactive state unless their gate is allocated. */
export function applyConstraintVisibility(ctx: MountContext): void {
  const hidden = ctx.pathing?.hiddenKeys;
  if (!hidden) return;
  for (const key of ctx.constrainedWraps) {
    const wrap = ctx.nodeWraps.get(key);
    if (!wrap) continue;
    const isHidden = hidden.has(key);
    wrap.visible = !isHidden;
    wrap.eventMode = isHidden ? 'none' : 'static';
  }
}
