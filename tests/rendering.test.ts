import { describe, expect, it } from 'vitest';
import { edgeState } from '../src/render/tree/edgeState';
import { collectClusterNodes, computeMainTreeBounds, computeWorldBounds } from '../src/render/tree/geometry';
import { buildAllocation } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

describe('edge colours', () => {
  const allocation = buildAllocation(['2'], ['3', '4'], ['5']);
  const frontier = new Set(['1', '10']);

  it.each([
    ['1', '2', 'allocated'], ['2', '3', 'set1'], ['3', '4', 'set1'],
    ['2', '5', 'set2'], ['3', '5', 'idle'], ['2', '6', 'idle'],
  ] as const)('paints %s → %s as %s in both directions', (a, b, state) => {
    expect(edgeState(a, b, allocation, frontier, null)).toBe(state);
    expect(edgeState(b, a, allocation, frontier, null)).toBe(state);
  });

  it('previews new connections without overriding allocated branch colours', () => {
    expect(edgeState('2', '6', allocation, frontier, new Set(['6']))).toBe('preview');
    expect(edgeState('6', '7', allocation, frontier, new Set(['6', '7']))).toBe('preview');
    expect(edgeState('3', '4', allocation, frontier, new Set(['4']))).toBe('set1');
    expect(edgeState('6', '7', allocation, frontier, new Set(['6']))).toBe('idle');
  });
});

describe('camera geometry', () => {
  const data = makeTree({
    root: { x: -9999, y: -9999 },
    '2': { x: -50, y: -25 }, '3': { x: 50, y: 25 },
    '10': { x: 300, y: 400 }, '11': { x: 500, y: 600 },
  });

  it('fits the main tree without including the synthetic root or ascendancies', () => {
    expect(computeMainTreeBounds(data)).toEqual({ minX: -50, maxX: 50, minY: -25, maxY: 25 });
    expect(computeMainTreeBounds(makeTree())).toBeNull();
  });

  it('keeps the whole positioned export inside padded viewport bounds', () => {
    const world = computeWorldBounds(data);
    for (const node of Object.values(data.nodes)) {
      if (node.x === undefined || node.y === undefined) continue;
      expect(node.x).toBeGreaterThan(world.minX);
      expect(node.y).toBeGreaterThan(world.minY);
      expect(node.x).toBeLessThan(world.minX + world.width);
      expect(node.y).toBeLessThan(world.minY + world.height);
    }
  });

  it('centres only the selected ascendancy cluster', () => {
    const cluster = collectClusterNodes(data, 'Witch1')!;
    expect([cluster.cx, cluster.cy]).toEqual([400, 500]);
    expect(cluster.nodes.map((node) => node.key)).toEqual(['10', '11']);
    expect(collectClusterNodes(data, 'Unknown')).toBeNull();
  });
});
