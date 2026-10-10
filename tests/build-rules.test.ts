import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RawTreeData, TreeData } from '../src/data/types';
import { frontierKeysFor, normalizeTreeData, startNodeKeyForClass } from '../src/data/normalize';
import { VERSIONS } from '../src/data/versions';
import { applyPathAllocation, autoOptionsForPath, bfsShortestPath, resolveCascade } from '../src/interaction/pathing';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import { buildAllocation, EMPTY_ALLOCATION, removeKey, type Allocation, type AllocationMode } from '../src/state/allocation';
import { effectiveBudgetCaps, countBudgets, useStore } from '../src/state/store';
import { makeTree, keys } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));

function ready(data: TreeData, className: string, ascendancyId: string | null) {
  useStore.setState({ status: { kind: 'ready', version: 'test', data, atlases: {} as never },
    className, ascendancyId, defaultAttribute: 'strength' });
  return useStore.getState();
}

function addPath(data: TreeData, allocation: Allocation, className: string, asc: string | null,
  target: string, mode: AllocationMode = 'shared') {
  const roots = frontierKeysFor(data, className, asc);
  const ctx = buildPathingContext(data, startNodeKeyForClass(className, data), asc, roots, allocation);
  const frontier = new Set([...ctx.frontierByMode[mode], ...roots]);
  const path = bfsShortestPath(data, frontier, ctx.classStartKey, target, ctx.blockedByMode[mode]);
  expect(path, target).not.toBeNull();
  return applyPathAllocation(data, allocation, path!, autoOptionsForPath(data, path!, frontier), mode);
}

describe('shared special skills and replacement cascades', () => {
  it('keeps independently connected shared nodes and both sets when switching ascendancy', () => {
    const data = makeTree({ '20': { ascendancyId: 'Witch2', isAscendancyStart: true },
      '21': { ascendancyId: 'Witch2' } });
    data.classes[0]!.ascendancies.push({ id: 'Witch2', name: 'Other', image: '', offsetX: 0, offsetY: 0 });
    data.playableAscendancyIds.add('Witch2');
    const state = ready(data, 'Witch', 'Witch1');
    expect(state.tryAllocate(buildAllocation(['2', '3', '11'], ['4'], ['5']), data)).toBe(true);
    state.setAscendancy('Witch2');
    expect(useStore.getState().allocation).toEqual(buildAllocation(['2', '3'], ['4'], ['5']));
  });

  it.each(['set1', 'set2'] as const)('blocks exclusive keystones and sockets in %s previews and commits', (mode) => {
    const data = makeTree({ '4': { isKeystone: true }, '5': { isJewelSocket: true } });
    const state = ready(data, 'Witch', null);
    const allocation = buildAllocation(['2'], [], []);
    const ctx = buildPathingContext(data, '1', null, new Set(['1']), allocation);
    for (const target of ['4', '5']) {
      expect(bfsShortestPath(data, ctx.frontierByMode[mode], '1', target, ctx.blockedByMode[mode])).toBeNull();
      expect(applyPathAllocation(data, allocation, ['3', target], [], mode)).toBe(allocation);
      expect(state.tryAllocate(buildAllocation(['2'], mode === 'set1' ? ['3', target] : [],
        mode === 'set2' ? ['3', target] : []), data)).toBe(false);
    }
    expect(state.tryAllocate(buildAllocation(['2', '3', '4', '5'], [], []), data)).toBe(true);
    expect(useStore.getState().allocation.shared.has('4')).toBe(true);
    const sharedCtx = buildPathingContext(data, '1', null, new Set(['1']), useStore.getState().allocation);
    expect(sharedCtx.blockedByMode[mode].has('4')).toBe(false);
  });

  it('does not use an illegally exclusive keystone as a cross-set radius anchor', () => {
    const data = makeTree({ '32905': { ascendancyId: 'Druid1' }, '52': { isKeystone: true, x: 0, y: 0 },
      '2672': { x: 10, y: 10 } });
    const ctx = buildPathingContext(data, '1', 'Druid1', new Set(['1']), buildAllocation(['32905'], ['52'], []));
    expect(ctx.entwinedKeys.has('2672')).toBe(false);
  });
});

describe.each(VERSIONS)('real allocation regressions in %s', (version) => {
  const data = normalizeTreeData(JSON.parse(readFileSync(`public/trees/${version}/data.json`, 'utf8')) as RawTreeData);

  it.each(['set1', 'set2'] as const)('supports Weapon Master beyond 24 specialized points in %s', (mode) => {
    const state = ready(data, 'Mercenary', 'Mercenary2');
    const base = addPath(data, EMPTY_ALLOCATION, 'Mercenary', 'Mercenary2', '8272');
    const next = addPath(data, base, 'Mercenary', 'Mercenary2', '712', mode);
    expect(countBudgets(next, 'Mercenary2', data)[mode]).toBeGreaterThan(24);
    expect(effectiveBudgetCaps(next, 'Mercenary2', data)).toEqual({ passive: 123, weaponSet: 124 });
    expect(state.tryAllocate(next, data)).toBe(true);
    state.undo();
    expect(useStore.getState().allocation.shared.size).toBe(0);
    state.redo();
    expect(useStore.getState().allocation[mode]).toEqual(next[mode]);
    // Removing the bonus or switching away cannot leave an over-budget build.
    const before = useStore.getState().allocation;
    state.commitAllocation(removeKey(before, '8272'), data);
    expect(useStore.getState().allocation).toBe(before);
    state.setAscendancy(null);
    expect(useStore.getState().ascendancyId).toBe('Mercenary2');
    state.commitAllocation(buildAllocation(before.shared, [], []), data);
    state.setAscendancy(null);
    expect(useStore.getState().ascendancyId).toBeNull();
  });

  it('prunes the old Path Seeker option and its dependent main-tree branch in the same edit', () => {
    const state = ready(data, 'Ranger', 'Ranger3');
    let allocation = addPath(data, EMPTY_ALLOCATION, 'Ranger', 'Ranger3', '12795');
    allocation = addPath(data, allocation, 'Ranger', 'Ranger3', '44871');
    expect(state.tryAllocate(allocation, data)).toBe(true);
    expect(useStore.getState().allocation.shared.has('44871')).toBe(true);
    const replacement = addPath(data, allocation, 'Ranger', 'Ranger3', '57253');
    expect(state.tryAllocate(replacement, data)).toBe(true);
    expect(useStore.getState().allocation.shared.has('12795')).toBe(false);
    expect(useStore.getState().allocation.shared.has('44871')).toBe(false);
    expect(useStore.getState().allocation.shared.has('57253')).toBe(true);
    state.undo();
    expect(useStore.getState().allocation.shared.has('44871')).toBe(true);
    state.redo();
    expect(useStore.getState().allocation.shared.has('44871')).toBe(false);
  });

  it('settles Oracle radius cascades in one removal, including both weapon sets', () => {
    const state = ready(data, 'Druid', 'Druid1');
    let allocation = addPath(data, EMPTY_ALLOCATION, 'Druid', 'Druid1', '32905');
    allocation = addPath(data, allocation, 'Druid', 'Druid1', '52');
    const ctx = buildPathingContext(data, startNodeKeyForClass('Druid', data), 'Druid1',
      frontierKeysFor(data, 'Druid', 'Druid1'), allocation);
    expect(ctx.entwinedKeys.has('2672')).toBe(true);
    for (const mode of ['shared', 'set1', 'set2'] as const) {
      const withRadius = applyPathAllocation(data, allocation, ['2672'], [], mode);
      const result = resolveCascade(data, removeKey(withRadius, '11335'), frontierKeysFor(data, 'Druid', 'Druid1'), 'Druid1');
      expect(result[mode].has('2672')).toBe(false);
      expect(resolveCascade(data, result, frontierKeysFor(data, 'Druid', 'Druid1'), 'Druid1')).toBe(result);
      useStore.setState({ allocation: withRadius, past: [], future: [] });
      state.commitAllocation(removeKey(withRadius, '11335'), data);
      expect(useStore.getState().allocation[mode].has('2672')).toBe(false);
      state.undo();
      expect(useStore.getState().allocation[mode].has('2672')).toBe(true);
    }
  });

  it('switches ascendancy without retaining old skills, gated nodes, or their dependent branches', () => {
    const state = ready(data, 'Druid', 'Druid1');
    let allocation = addPath(data, EMPTY_ALLOCATION, 'Druid', 'Druid1', '5571');
    allocation = addPath(data, allocation, 'Druid', 'Druid1', '479');
    expect(state.tryAllocate(allocation, data)).toBe(true);
    state.setAscendancy('Druid2');
    const result = useStore.getState();
    expect(result.ascendancyId).toBe('Druid2');
    expect(result.allocation.shared.has('5571')).toBe(false);
    expect(result.allocation.shared.has('479')).toBe(false);
    expect([...result.allocation.shared].some((key) => data.nodes[key]?.ascendancyId === 'Druid1')).toBe(false);
    expect(result.past).toEqual([]);
  });

  it('reads ordinary passive bonuses from the export separately from ascendancy cost', () => {
    const oracle = addPath(data, EMPTY_ALLOCATION, 'Druid', 'Druid1', '11335');
    expect(effectiveBudgetCaps(oracle, 'Druid1', data).passive).toBe(124);
    const seeker = addPath(data, EMPTY_ALLOCATION, 'Ranger', 'Ranger3', '12795');
    expect(effectiveBudgetCaps(seeker, 'Ranger3', data).passive).toBeGreaterThanOrEqual(127);
  });
});

it('accepts granted passive points up to the effective cap and rejects its removal until refunded', () => {
  const passives = keys(100, 125);
  const data = makeTree({ '11': { grantedPassivePoints: 1 },
    ...Object.fromEntries(passives.map((key) => [key, { in: ['1'] }])) });
  data.nodes['1']!.out.push(...passives);
  const state = ready(data, 'Witch', 'Witch1');
  expect(state.tryAllocate(buildAllocation(['11', ...passives.slice(0, 124)], [], []), data)).toBe(true);
  expect(state.tryAllocate(buildAllocation(['11', ...passives], [], []), data)).toBe(false);
  const before = useStore.getState().allocation;
  state.commitAllocation(removeKey(before, '11'), data);
  expect(useStore.getState().allocation).toBe(before);
  state.undo();
  expect(effectiveBudgetCaps(useStore.getState().allocation, 'Witch1', data).passive).toBe(123);
  state.redo();
  expect(effectiveBudgetCaps(useStore.getState().allocation, 'Witch1', data).passive).toBe(124);
});

it.each(['set1', 'set2'] as const)('keeps active totals capped at 123 with Weapon Master in %s', (mode) => {
  const passives = keys(100, 124);
  const data = makeTree({ '11': { weaponPassivePointsGranted: 100 },
    ...Object.fromEntries(passives.map((key) => [key, {}])) });
  data.nodes['1']!.out.push(...passives);
  const state = ready(data, 'Witch', 'Witch1');
  const allocation = (branch: string[]) => buildAllocation(['11'], mode === 'set1' ? branch : [], mode === 'set2' ? branch : []);
  expect(state.tryAllocate(allocation(passives.slice(0, 123)), data)).toBe(true);
  const before = useStore.getState().allocation;
  expect(state.tryAllocate(allocation(passives), data)).toBe(false);
  expect(useStore.getState().allocation).toBe(before);
  expect(useStore.getState().passiveRejectionTick).toBe(1);
});
