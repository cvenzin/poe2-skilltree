import { describe, expect, it } from 'vitest';
import { applyPathAllocation, bfsShortestPath, resolveCascade } from '../src/interaction/pathing';
import { buildAllocation, removeKey } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

describe('path preview and cascade', () => {
  const data = makeTree();
  const frontier = new Set(['1']);

  it('previews only new nodes and traverses export links backwards', () => {
    expect(bfsShortestPath(data, new Set(['2']), '1', '4')).toEqual(['3', '4']);
    expect(bfsShortestPath(data, new Set(), '4', '2')).toEqual(['3', '2']);
    expect(bfsShortestPath(data, new Set(['2']), '1', '2')).toEqual([]);
    expect(bfsShortestPath(data, new Set(), '1', '4', new Set(['3']))).toBeNull();
  });

  it('removes dependent branches while preserving an independently rooted set', () => {
    const allocation = buildAllocation(['2', '3'], ['4'], ['5', '6']);
    expect(resolveCascade(data, allocation, frontier)).toBe(allocation);
    expect(resolveCascade(data, removeKey(allocation, '2'), frontier))
      .toEqual(buildAllocation([], [], ['6']));
    expect(allocation.shared.has('2')).toBe(true);
  });

  it('never connects shared through a set, or one set through the other', () => {
    expect(resolveCascade(data, buildAllocation(['3'], ['2', '4'], ['5']), frontier))
      .toEqual(buildAllocation([], ['2'], []));
    expect(resolveCascade(data, buildAllocation(['2'], ['3', '4'], ['5']), frontier))
      .toEqual(buildAllocation(['2'], ['3', '4'], []));
  });

  it('always assigns ascendancy nodes to shared and omits the implicit start', () => {
    const next = applyPathAllocation(data, buildAllocation([], [], []), ['2', '10', '11'], [], 'set2');
    expect(next).toEqual(buildAllocation(['11'], [], ['2']));
  });
});
