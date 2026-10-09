import { describe, expect, it } from 'vitest';
import {
  addKeysToBucket, blockedForMode, buildAllocation, frontierForMode,
  pruneAllocation, removeKey,
} from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

describe('allocation buckets', () => {
  it('deduplicates imported nodes with shared > set1 > set2 precedence', () => {
    expect(buildAllocation(['2', '2'], ['2', '3'], ['2', '3', '4'])).toEqual({
      shared: new Set(['2']), set1: new Set(['3']), set2: new Set(['4']),
    });
  });

  it('moves keys without mutating previous snapshots', () => {
    const original = buildAllocation(['2'], ['3'], ['4']);
    const next = addKeysToBucket(original, ['3', '4'], 'shared');
    expect(next).toEqual(buildAllocation(['2', '3', '4'], [], []));
    expect(original).toEqual(buildAllocation(['2'], ['3'], ['4']));
    expect(removeKey(next, '3').shared).toEqual(new Set(['2', '4']));
    expect(next.shared.has('3')).toBe(true);
    expect(removeKey(original, 'missing')).toBe(original);
  });

  it.each([
    ['shared', ['2'], ['3', '4']],
    ['set1', ['2', '3'], ['4']],
    ['set2', ['2', '4'], ['3']],
  ] as const)('isolates the %s frontier from other buckets', (mode, frontier, blocked) => {
    const allocation = buildAllocation(['2'], ['3'], ['4']);
    expect(frontierForMode(allocation, mode)).toEqual(new Set(frontier));
    expect(blockedForMode(allocation, mode)).toEqual(new Set(blocked));
  });

  it('prunes chained unlock constraints across every bucket to a fixed point', () => {
    const data = makeTree({
      '20': { unlockConstraint: { nodes: [11], ascendancy: 'Witch1' } },
      '21': { unlockConstraint: { nodes: [20] } },
    });
    const allocation = buildAllocation(['11'], ['20'], ['21']);
    expect(pruneAllocation(allocation, 'Witch1', data)).toBe(allocation);
    expect(pruneAllocation(removeKey(allocation, '11'), 'Witch1', data))
      .toEqual(buildAllocation([], [], []));
    expect(pruneAllocation(allocation, null, data))
      .toEqual(buildAllocation(['11'], [], []));
    expect(allocation.set2.has('21')).toBe(true);
  });
});
