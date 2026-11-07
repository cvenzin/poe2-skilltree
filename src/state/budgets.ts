import type { TreeData } from '../data/types';
import type { Allocation, AllocationMode } from './allocation';

/** Fixed budgets per PoE 2 rules — 123 passives at level 100 with quest
 *  rewards, 8 ascendancy points fully cleared. Not user-editable. */
export const PASSIVE_CAP = 123;
export const ASCENDANCY_CAP = 8;
/** Base specialization limit per set, before allocated ascendancy bonuses. */
export const WEAPON_SET_CAP = 24;

/** Budget counts derived from an {@link Allocation}.
 *
 *  Shared allocations are active in *both* weapon sets, so each set's active
 *  total is `shared + setN` and is validated against the passive-point budget
 *  (base `PASSIVE_CAP` plus bonuses) independently — the two sets can have different active totals
 *  and different unspent remainders. The set-specific counts additionally have
 *  their own weapon-set specialization cap (base `WEAPON_SET_CAP` plus bonuses).
 *
 *  Ascendancy nodes are counted once toward the ascendancy budget regardless of
 *  bucket (they should always be `shared`, but the count is defensive).
 *  Ascendancy starts, multiple-choice hubs and isFree skills are never counted. */
export interface BudgetCounts {
  /** Main-tree (shared) passive nodes — active in both weapon sets. */
  shared: number;
  /** Weapon Set 1-only nodes (weapon-set 1 specialization used). */
  set1: number;
  /** Weapon Set 2-only nodes (weapon-set 2 specialization used). */
  set2: number;
  /** Passive points active in Weapon Set 1 (`shared + set1`). */
  activeIn1: number;
  /** Passive points active in Weapon Set 2 (`shared + set2`). */
  activeIn2: number;
  /** Ascendancy nodes matching the selected ascendancy. */
  ascendancy: number;
}

export function countBudgets(
  allocation: Allocation,
  ascendancyId: string | null,
  data: TreeData
): BudgetCounts {
  let shared = 0;
  let set1 = 0;
  let set2 = 0;
  let ascendancy = 0;

  const classify = (key: string, bucket: AllocationMode): void => {
    const node = data.nodes[key];
    if (!node) return;
    // Ascendancy start is implicit (like the class start) — never counted.
    if (node.isAscendancyStart || node.classStartIndex || node.isMastery || key === 'root') return;
    // Multiple-choice hubs (e.g. "Projectile Proximity Specialisation") have
    // no stats and exist only as routing nodes for the choice options. The
    // chosen option carries the actual cost — the hub is free. Explicitly
    // free skills (Sanguimancy, Smith's Masterwork, Sacred Unity) also cost 0.
    if (node.isMultipleChoice || node.isFree) return;
    // Ascendancy points are a separate budget and aren't weapon-set-split —
    // count them once regardless of which bucket they happen to sit in.
    if (node.ascendancyId) {
      if (node.ascendancyId === ascendancyId) ascendancy++;
      return;
    }
    if (bucket === 'shared') shared++;
    else if (bucket === 'set1') set1++;
    else set2++;
  };

  for (const key of allocation.shared) classify(key, 'shared');
  for (const key of allocation.set1) classify(key, 'set1');
  for (const key of allocation.set2) classify(key, 'set2');

  return { shared, set1, set2, activeIn1: shared + set1, activeIn2: shared + set2, ascendancy };
}

export function effectiveBudgetCaps(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
  const bonus = budgetBonuses(allocation, ascendancyId, data);
  return { passive: PASSIVE_CAP + bonus.passive, weaponSet: WEAPON_SET_CAP + bonus.weaponSet };
}

export function allocationBudgetError(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
  const counts = countBudgets(allocation, ascendancyId, data);
  const caps = effectiveBudgetCaps(allocation, ascendancyId, data);
  if (counts.ascendancy > ASCENDANCY_CAP) return { tick: 'ascendancyRejectionTick', message: 'Ascendancy point limit exceeded (8).' } as const;
  for (const set of [1, 2] as const) {
    if (counts[set === 1 ? 'activeIn1' : 'activeIn2'] > caps.passive)
      return { tick: 'passiveRejectionTick', message: 'Weapon Set ' + set + ' would exceed the passive point limit (' + caps.passive + '). Refund passive points first.' } as const;
    if (counts[set === 1 ? 'set1' : 'set2'] > caps.weaponSet)
      return { tick: set === 1 ? 'weaponSet1RejectionTick' : 'weaponSet2RejectionTick', message: 'Weapon Set ' + set + ' would exceed the weapon set point limit (' + caps.weaponSet + '). Refund weapon set points first.' } as const;
  }
  return null;
}

/** Export fields describe additional ordinary points and converted weapon-set
 * points separately. Weapon Master's conversion does not reduce active totals. */
function budgetBonuses(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
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
