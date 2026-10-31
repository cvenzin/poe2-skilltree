import type { TreeData } from '../data/types';
import { frontierKeysFor, startNodeKeyForClass } from '../data/normalize';
import { allAllocated, bucketOf, removeKey, type Allocation } from '../state/allocation';
import { allocationBudgetError, countBudgets, type AppState } from '../state/store';
import { revalidateAllocation } from '../state/buildRules';
import { buildPathingContext } from '../render/tree/pathingContext';
import type { PathingContext } from '../render/tree/types';
import { bfsShortestPath, autoOptionsForPath, applyPathAllocation } from './pathing';

export const modeName = { shared: 'Main', set1: 'Set 1', set2: 'Set 2' };
export interface EditProposal {
  next: Allocation;
  added: readonly string[];
  removed: readonly string[];
  path: readonly string[];
  error: string | null;
}

/** Preview exactly the allocation the store will validate, including options and cascades. */
export type ProposalState = Pick<AppState, 'className' | 'ascendancyId' | 'allocation' | 'allocationMode'>;
export function proposeNodeEdit(key: string, data: TreeData, state: ProposalState, suppliedPathing?: PathingContext | null): EditProposal | string {
  const node = data.nodes[key];
  if (!node || !state.className) return 'Select a class to edit this tree.';
  if (node.classStartIndex?.length) return 'Class starts are implicit. Use Reset in the build controls to clear the build.';
  if (node.isAscendancyStart) return 'Ascendancy starts are included automatically.';
  if (node.isMultipleChoice) return 'Select an option connected to this skill.';
  if (node.isMastery || key === 'root') return 'This node cannot be allocated.';
  const bucket = bucketOf(state.allocation, key);
  if (bucket && bucket !== state.allocationMode) return `Switch Editing to ${modeName[bucket]} to edit this node.`;
  let next: Allocation;
  let path: readonly string[] = [];
  if (bucket) next = removeKey(state.allocation, key);
  else {
    if (state.allocationMode !== 'shared' && (node.isKeystone || node.isJewelSocket || node.ascendancyId))
      return 'Keystones, jewel sockets, and ascendancy skills must be allocated in Main.';
    const ctx = suppliedPathing ?? buildPathingContext(data, startNodeKeyForClass(state.className, data),
      state.ascendancyId, frontierKeysFor(data, state.className, state.ascendancyId), state.allocation);
    if (ctx.blockedByMode[state.allocationMode].has(key)) return 'This node is restricted by the current class, ascendancy, unlock requirements, or allocation mode.';
    const frontier = ctx.frontierByMode[state.allocationMode];
    const route = ctx.entwinedKeys.has(key) ? [key] : bfsShortestPath(data, frontier, ctx.classStartKey, key, ctx.blockedByMode[state.allocationMode]);
    if (!route?.length) return 'No reachable path in this allocation mode. Try Main or the connected weapon set.';
    const options = autoOptionsForPath(data, route, frontier);
    path = [...route, ...options];
    next = applyPathAllocation(data, state.allocation, route, options, state.allocationMode);
  }
  next = revalidateAllocation(next, data, state.className, state.ascendancyId);
  const before = allAllocated(state.allocation), after = allAllocated(next);
  const added = [...after].filter((k) => !before.has(k));
  const removed = [...before].filter((k) => !after.has(k));
  return { next, path, added, removed, error: allocationBudgetError(next, state.ascendancyId, data)?.message ??
    (!bucket && !after.has(key) ? 'This node does not meet its connection or unlock requirements.' : null) };
}

export function editSummary(before: Allocation, next: Allocation, data: TreeData, ascendancyId: string | null): string {
  const a = countBudgets(before, ascendancyId, data), b = countBudgets(next, ascendancyId, data);
  const parts = (['shared', 'set1', 'set2', 'ascendancy'] as const).flatMap((key) => {
    const delta = b[key] - a[key];
    if (!delta) return [];
    const label = key === 'ascendancy' ? 'ascendancy' : key === 'shared' ? 'Main passive' : `${modeName[key]} passive / specialization`;
    return [`${Math.abs(delta)} ${label} ${Math.abs(delta) === 1 ? 'point' : 'points'} ${delta > 0 ? 'spent' : 'refunded'}`];
  });
  return parts.length ? parts.join(' · ') : '0 points (free nodes)';
}

/** A single cost line for informational tooltips; no node or refund counters. */
export function pathCost(before: Allocation, next: Allocation, data: TreeData, ascendancyId: string | null): string {
  const a = countBudgets(before, ascendancyId, data), b = countBudgets(next, ascendancyId, data);
  const parts = (['shared', 'set1', 'set2', 'ascendancy'] as const).flatMap((key) => {
    const points = b[key] - a[key];
    if (points <= 0) return [];
    const label = key === 'ascendancy' ? 'ascendancy' : 'passive';
    const set = key === 'set1' || key === 'set2' ? ` (${modeName[key]})` : '';
    return [`${points} ${label} ${points === 1 ? 'point' : 'points'}${set}`];
  });
  return parts.join(' · ') || 'Free';
}

/** Compact point impact shared by inline and standalone removal reviews. */
export function removalImpact(before: Allocation, next: Allocation, data: TreeData, ascendancyId: string | null): string {
  const a = countBudgets(before, ascendancyId, data), b = countBudgets(next, ascendancyId, data);
  return (['shared', 'set1', 'set2', 'ascendancy'] as const).flatMap((key) => {
    const refund = a[key] - b[key];
    if (!refund) return [];
    const label = key === 'shared' ? 'passive' : key === 'ascendancy' ? 'ascendancy' : modeName[key];
    return [`${Math.abs(refund)} ${label} ${Math.abs(refund) === 1 ? 'point' : 'points'} ${refund > 0 ? 'refunded' : 'spent'}`];
  }).join(' · ') || 'No point change';
}
