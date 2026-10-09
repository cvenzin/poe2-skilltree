import { normalizeTreeData } from '../../src/data/normalize';
import type { RawTreeData, TreeNode } from '../../src/data/types';

/** Small directed export; gameplay must traverse its links in either direction.
 *  1—2—3 branches to 4 and 5; 1—6 is an independent branch. */
export function makeTree(extra: Record<string, Partial<TreeNode>> = {}) {
  const nodes: Record<string, TreeNode> = {};
  for (const key of ['root', '1', '2', '3', '4', '5', '6', '10', '11', ...Object.keys(extra)]) {
    nodes[key] = {
      skill: Number(key), group: 1, orbit: 0, orbitIndex: 0,
      in: [], out: [], edges: [], ...extra[key],
    };
  }
  nodes['1']!.classStartIndex = [0];
  nodes['10']!.ascendancyId = 'Witch1';
  nodes['10']!.isAscendancyStart = true;
  nodes['11']!.ascendancyId = 'Witch1';
  const edges = [['root', '1'], ['1', '2'], ['2', '3'], ['3', '4'], ['3', '5'], ['1', '6'], ['10', '11']]
    .map(([from, to]) => {
      nodes[from!]!.out.push(to!);
      nodes[to!]!.in.push(from!);
      return { from: from!, to: to! };
    });
  const raw: RawTreeData = {
    tree: 'test', nodes, edges, groups: {}, jewelSlots: [],
    min_x: -100, min_y: -100, max_x: 100, max_y: 100,
    classes: [{
      name: 'Witch', base_str: 0, base_dex: 0, base_int: 0,
      image: '', image_offset_x: 0, image_offset_y: 0,
      ascendancies: [{ id: 'Witch1', name: 'Test ascendancy', image: '', offsetX: 0, offsetY: 0 }],
    }],
  };
  return normalizeTreeData(raw);
}

export function keys(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i));
}
