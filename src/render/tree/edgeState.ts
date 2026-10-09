import type { NodeState } from '../frameForNode';
import type { Allocation } from '../../state/allocation';

/** Edge colour states: the three base states plus the two weapon-set branch
 *  colours (green for Set 1, red for Set 2). */
export type EdgeState = NodeState | 'set1' | 'set2';

/** Edge colour state derived from the bucket membership of its two endpoints
 *  (frontier nodes — class / ascendancy starts — count as main/shared):
 *    - both in the main tree → `allocated` (gold)
 *    - within the Set 1 branch (both in shared∪set1, ≥1 set1) → `set1` (green)
 *    - within the Set 2 branch → `set2` (red)
 *    - a Set 1↔Set 2 edge belongs to neither tree → falls through to idle
 *  Preview (a click would commit this edge) is checked last. */
export function edgeState(
  a: string,
  b: string,
  allocation: Allocation,
  frontierKeys: ReadonlySet<string>,
  previewSet: ReadonlySet<string> | null
): EdgeState {
  const aMain = frontierKeys.has(a) || allocation.shared.has(a);
  const bMain = frontierKeys.has(b) || allocation.shared.has(b);
  const a1 = allocation.set1.has(a);
  const b1 = allocation.set1.has(b);
  const a2 = allocation.set2.has(a);
  const b2 = allocation.set2.has(b);
  const aActive = aMain || a1 || a2;
  const bActive = bMain || b1 || b2;

  if (aActive && bActive) {
    if (aMain && bMain) return 'allocated';
    if ((aMain || a1) && (bMain || b1) && (a1 || b1)) return 'set1';
    if ((aMain || a2) && (bMain || b2) && (a2 || b2)) return 'set2';
    // Mixed Set 1 ↔ Set 2 edge — not part of either weapon-set tree.
  }

  if (previewSet) {
    const aPreview = previewSet.has(a);
    const bPreview = previewSet.has(b);
    if ((aPreview || aActive) && (bPreview || bActive) && (aPreview || bPreview)) {
      return 'preview';
    }
  }
  return 'idle';
}
