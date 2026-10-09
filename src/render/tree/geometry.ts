import type { TreeData, TreeNode } from '../../data/types';
import type { NodeBounds, WorldSize } from './types';

/**
 * Extra world-space padding past the outermost node. Has to cover:
 *   - the ascendancy backdrop discs (~1500 px radius)
 *   - the largest node frame (~110 px) drawn at the edge
 *   - a bit of breathing room so clamp doesn't feel jammed
 */
const WORLD_PADDING = 1800;

/** Bbox of the *visible main tree* — every positioned, non-ascendancy node.
 *  Used as the initial-fit target so the camera doesn't open zoomed-out over
 *  the padded world (which has to cover the 1500 px ascendancy backdrop discs
 *  and frame ornaments). Returns null when no qualifying node exists. */
export function computeMainTreeBounds(data: TreeData): NodeBounds | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (key === 'root') continue;
    if (node.ascendancyId) continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
    count++;
  }
  if (count === 0) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * `data.min_x/max_x/min_y/max_y` in 0.5.0 covers the main tree but a chunk of
 * ascendancy nodes sit ~500 px past those bounds, plus the ascendancy backdrop
 * discs extend further. Walk every node ourselves and pad generously.
 */
export function computeWorldBounds(data: TreeData): WorldSize {
  let minX = data.min_x, maxX = data.max_x, minY = data.min_y, maxY = data.max_y;
  for (const node of Object.values(data.nodes)) {
    if (node.x === undefined || node.y === undefined) continue;
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  minX -= WORLD_PADDING; maxX += WORLD_PADDING;
  minY -= WORLD_PADDING; maxY += WORLD_PADDING;
  return { width: maxX - minX, height: maxY - minY, minX, minY };
}

export interface ClusterInfo {
  nodes: { key: string; node: TreeNode; x: number; y: number }[];
  cx: number;
  cy: number;
}

export function collectClusterNodes(data: TreeData, ascId: string): ClusterInfo | null {
  const nodes: ClusterInfo['nodes'] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.ascendancyId !== ascId) continue;
    if (node.x === undefined || node.y === undefined) continue;
    nodes.push({ key, node, x: node.x, y: node.y });
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  if (nodes.length === 0) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { nodes, cx, cy };
}

/** Average distance of the 6 class start nodes from the world origin —
 *  the ring radius the central ascendancy disc sits inside of. */
export function computeClassStartRingRadius(data: TreeData): number {
  let total = 0;
  let count = 0;
  for (const key of data.startNodeByClassIndex.values()) {
    const node = data.nodes[key];
    if (node?.x === undefined || node.y === undefined) continue;
    total += Math.hypot(node.x, node.y);
    count++;
  }
  return count === 0 ? 1400 : total / count;
}

interface AscendancyLookup {
  cls: import('../../data/types').ClassEntry;
  /** Index of the class in `data.classes[]` — used to look up the class start
   *  node via `data.startNodeByClassIndex`. */
  classIdx: number;
  /** Index of the ascendancy within its class's `ascendancies[]`. */
  ascIdx: number;
  asc: import('../../data/types').Ascendancy;
}

export function findAscendancy(data: TreeData, ascendancyId: string): AscendancyLookup | null {
  for (const classIdx of data.playableClassIndices) {
    const cls = data.classes[classIdx];
    if (!cls) continue;
    const ascIdx = cls.ascendancies.findIndex((a) => a.id === ascendancyId);
    const asc = ascIdx >= 0 ? cls.ascendancies[ascIdx] : undefined;
    if (asc) return { cls, classIdx, ascIdx, asc };
  }
  return null;
}

export function computeActiveDiscRotation(data: TreeData, className: string): number {
  const ref = classStartAngle(data, 'Witch');
  const target = classStartAngle(data, className);
  if (ref === null || target === null) return 0;
  return target - ref;
}

function classStartAngle(data: TreeData, className: string): number | null {
  const idx = data.classes.findIndex((c) => c.name === className);
  if (idx < 0) return null;
  const key = data.startNodeByClassIndex.get(idx);
  if (!key) return null;
  const n = data.nodes[key];
  if (n?.x === undefined || n.y === undefined) return null;
  return Math.atan2(n.y, n.x);
}

/** Find the start node for the currently-selected ascendancy, or null when
 *  no ascendancy is selected. Linear scan over ~5000 nodes — runs once per
 *  mount, not per frame. */
export function findAscendancyStartKey(data: TreeData, ascendancyId: string | null): string | null {
  if (!ascendancyId) return null;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.isAscendancyStart && node.ascendancyId === ascendancyId) return key;
  }
  return null;
}
