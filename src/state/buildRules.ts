import type { TreeData } from '../data/types';
import { frontierKeysFor } from '../data/normalize';
import { resolveCascade } from '../interaction/pathing';
import { addKeysToBucket, buildAllocation, pruneAllocation, type Allocation } from './allocation';

/** Older serializers accepted ascendancy skills in a set bucket. Their
 * ascendancy connection is independent of that set, so safely restore shared. */
export function shareAscendancyAllocation(allocation: Allocation, data: TreeData): Allocation {
  const keys = [...allocation.set1, ...allocation.set2].filter((key) => data.nodes[key]?.ascendancyId);
  return keys.length ? addKeysToBucket(allocation, keys, 'shared') : allocation;
}

/** Structural validity shared by edits and imports. Reject exclusive special
 * nodes rather than moving them: their connecting path may exist only in a set. */
export function exclusiveAllocationError(allocation: Allocation, data: TreeData): string | null {
  for (const key of [...allocation.set1, ...allocation.set2]) {
    const node = data.nodes[key];
    if (node?.isKeystone || node?.isJewelSocket || node?.ascendancyId) {
      return 'Keystones, jewel sockets, and ascendancy skills must be allocated in Main.';
    }
  }
  return null;
}

/** Constraint gates and radius anchors may themselves disappear in a cascade.
 * Alternate both validations until no more nodes are removed. */
export function revalidateAllocation(
  allocation: Allocation, data: TreeData, className: string | null, ascendancyId: string | null,
): Allocation {
  const keep = (bucket: ReadonlySet<string>) => [...bucket].filter((key) => {
    const node = data.nodes[key];
    return node && (!node.ascendancyId || node.ascendancyId === ascendancyId);
  });
  let current = buildAllocation(keep(allocation.shared), keep(allocation.set1), keep(allocation.set2));
  const roots = className ? frontierKeysFor(data, className, ascendancyId) : null;
  for (;;) {
    const pruned = pruneAllocation(current, ascendancyId, data);
    const next = roots ? resolveCascade(data, pruned, roots, ascendancyId) : pruned;
    if (next.shared.size === current.shared.size && next.set1.size === current.set1.size &&
      next.set2.size === current.set2.size) {
      return next.shared.size === allocation.shared.size && next.set1.size === allocation.set1.size &&
        next.set2.size === allocation.set2.size ? allocation : next;
    }
    current = next;
  }
}

/** Export fields describe additional ordinary points and converted weapon-set
 * points separately. Weapon Master's conversion does not reduce active totals. */
export function budgetBonuses(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
  let passive = 0;
  let weaponSet = 0;
  for (const key of allocation.shared) {
    const node = data.nodes[key];
    if (!node?.ascendancyId || node.ascendancyId !== ascendancyId) continue;
    passive += node.grantedPassivePoints ?? 0;
    weaponSet += node.weaponPassivePointsGranted ?? 0;
  }
  return { passive, weaponSet };
}
