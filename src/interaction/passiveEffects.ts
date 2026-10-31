import type { TreeData, TreeNode } from '../data/types';
import type { Allocation } from '../state/allocation';

/** Derived tooltip values only: never change upstream stats or saved node IDs. */
export function passiveTooltipNode(
  node: TreeNode, data: TreeData, allocation: Allocation, ascendancyId: string | null,
): TreeNode {
  const sharedNodes = [...allocation.shared].map((key) => data.nodes[key]);
  const hulking = ascendancyId === 'Warrior1' && sharedNodes.some((entry) =>
    entry?.ascendancyId === ascendancyId && entry.id === 'AscendancyWarrior1Notable5');
  if (hulking && isSmallPassive(node)) {
    return { ...node, stats: node.stats?.map((stat) => stat.split('\n').map(scaleSmallPassiveLine).join('\n')) };
  }
  if (node.id === 'AscendancyWarrior3Notable6_0' && ascendancyId === node.ascendancyId &&
    sharedNodes.some((entry) => entry?.id === node.id)) {
    const connected = new Set([...node.in, ...node.out]);
    const count = [...connected].filter((key) => allocation.shared.has(key) && data.nodes[key]?.isNotable).length;
    return { ...node, stats: [...(node.stats ?? []), `Current bonus: +${count * 200} to [Armour] (${count} connected ${count === 1 ? 'notable' : 'notables'})`] };
  }
  return node;
}

function isSmallPassive(node: TreeNode): boolean {
  return !node.ascendancyId && !node.isNotable && !node.isKeystone && !node.isMastery &&
    !node.isJewelSocket && !node.isGenericAttribute && !node.isBlighted && !node.classStartIndex?.length;
}

/** Scale modifier magnitudes, keeping markup and condition parameters intact.
 * In the bundled exports each small-passive line has one magnitude, except
 * added-damage ranges. Extra projectile counts and distance thresholds are
 * parameters of the effect, not magnitudes. Regeneration retains 2 decimals.
 */
function scaleSmallPassiveLine(line: string): string {
  let remaining = /^Adds \d+ to \d+ /.test(line) ? 2 : 1;
  const precision = /^Regenerate .*% .*per second$/.test(line) ? 100 : 1;
  return line.replace(/\[[^\]]*\]|[+-]?\d+(?:\.\d+)?/g, (token) => {
    if (token.startsWith('[') || remaining === 0) return token;
    remaining--;
    const value = Math.trunc(Number(token) * 1.5 * precision + Math.sign(Number(token)) * 1e-8) / precision;
    return `${token.startsWith('+') ? '+' : ''}${value}`;
  });
}
