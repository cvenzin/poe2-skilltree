import type { TreeData } from '../../data/types';
import { buildPathingContext } from '../../interaction/pathingContext';
import type { Allocation } from '../../state/allocation';
import type { MountContext } from './types';

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
