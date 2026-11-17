import type { TreeData } from '../data/types';
import type { AllocationMode } from '../state/allocation';
import { allocationBudgetError } from '../state/budgets';
import type { PathingContext } from './pathingContext';
import { applyPathAllocation, autoOptionsForPath, bfsShortestPath } from './pathing';

/** Choose the same route for the canvas, the cost display and the committed edit. */
export function allocationPath(data: TreeData, ctx: PathingContext, mode: AllocationMode, target: string) {
  const frontier = ctx.frontierByMode[mode];
  const blocked = ctx.blockedByMode[mode];
  if (blocked.has(target) || ctx.allAllocated.has(target)) return null;

  const candidate = (excluded: ReadonlySet<string>) => {
    const route = ctx.entwinedKeys.has(target) ? [target] : bfsShortestPath(data, frontier, ctx.classStartKey, target, excluded);
    if (!route?.length) return null;
    // Connecting an isolated Oracle passive can route through an existing
    // allocation. It keeps its owner and contributes no additional cost.
    const added = route.filter((key) => !ctx.allAllocated.has(key));
    const options = autoOptionsForPath(data, route, frontier);
    return { path: [...added, ...options], next: applyPathAllocation(data, ctx.allocation, added, options, mode) };
  };

  const shortest = candidate(blocked);
  if (!shortest || data.nodes[target]?.ascendancyId || !shortest.path.some((key) => data.nodes[key]?.ascendancyId)) return shortest;
  if (allocationBudgetError(shortest.next, ctx.ascendancyId, data)?.tick !== 'ascendancyRejectionTick') return shortest;

  // Path Seeker can offer a shorter route that costs unavailable ascendancy
  // points. Existing shared ascendancy skills can still start an ordinary route.
  const mainOnly = new Set(blocked);
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.ascendancyId && !ctx.allAllocated.has(key)) mainOnly.add(key);
  }
  const alternate = candidate(mainOnly);
  return alternate && !allocationBudgetError(alternate.next, ctx.ascendancyId, data) ? alternate : shortest;
}
