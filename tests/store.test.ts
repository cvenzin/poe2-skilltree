import { beforeEach, describe, expect, it } from 'vitest';
import { ASCENDANCY_CAP, PASSIVE_CAP, WEAPON_SET_CAP, countBudgets, useStore } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { keys, makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));

describe('budgets and history', () => {
  const passives = keys(100, PASSIVE_CAP + 30);
  const asc = keys(1000, ASCENDANCY_CAP + 1);
  const data = makeTree(Object.fromEntries([
    ...passives.map((key) => [key, {}]),
    ...asc.map((key) => [key, { ascendancyId: 'Witch1' }]),
    ['2000', { isMultipleChoice: true, ascendancyId: 'Witch1' }],
  ]));

  it('counts each active tree separately, with free ascendancy starts and hubs', () => {
    expect(countBudgets(buildAllocation(['2', '10', '11', '2000'], ['3'], ['4', '5']), 'Witch1', data))
      .toEqual({ shared: 1, set1: 1, set2: 2, activeIn1: 2, activeIn2: 3, ascendancy: 1 });
  });

  it('accepts exactly the passive limit independently in both weapon sets', () => {
    const allocation = buildAllocation(passives.slice(0, PASSIVE_CAP - WEAPON_SET_CAP),
      passives.slice(PASSIVE_CAP - WEAPON_SET_CAP, PASSIVE_CAP),
      passives.slice(PASSIVE_CAP, PASSIVE_CAP + WEAPON_SET_CAP));
    expect(useStore.getState().tryAllocate(allocation, data)).toBe(true);
  });

  it.each(['set1', 'set2'] as const)('rejects excess active passives in %s without changing history', (mode) => {
    const next = buildAllocation(passives.slice(0, PASSIVE_CAP),
      mode === 'set1' ? [passives[PASSIVE_CAP]!] : [],
      mode === 'set2' ? [passives[PASSIVE_CAP]!] : []);
    const before = useStore.getState();
    expect(before.tryAllocate(next, data)).toBe(false);
    expect(useStore.getState().allocation).toBe(before.allocation);
    expect(useStore.getState().past).toBe(before.past);
    expect(useStore.getState().passiveRejectionTick).toBe(1);
  });

  it.each(['set1', 'set2'] as const)('enforces the independent specialization limit in %s', (mode) => {
    const branch = passives.slice(0, WEAPON_SET_CAP + 1);
    expect(useStore.getState().tryAllocate(buildAllocation([], mode === 'set1' ? branch : [],
      mode === 'set2' ? branch : []), data)).toBe(false);
    expect(useStore.getState()[mode === 'set1' ? 'weaponSet1RejectionTick' : 'weaponSet2RejectionTick']).toBe(1);
  });

  it('enforces ascendancy points separately from passives', () => {
    useStore.getState().setAscendancy('Witch1');
    expect(useStore.getState().tryAllocate(buildAllocation(asc.slice(0, ASCENDANCY_CAP), [], []), data)).toBe(true);
    expect(useStore.getState().tryAllocate(buildAllocation(asc, [], []), data)).toBe(false);
    expect(useStore.getState().ascendancyRejectionTick).toBe(1);
  });

  it('restores immutable snapshots and discards redo after a new edit', () => {
    const first = buildAllocation(['2'], [], []);
    const second = buildAllocation(['2', '3'], ['4'], []);
    const actions = useStore.getState();
    actions.commitAllocation(first);
    actions.commitAllocation(second);
    actions.undo();
    expect(useStore.getState().allocation).toBe(first);
    actions.redo();
    expect(useStore.getState().allocation).toBe(second);
    actions.resetAllocation();
    actions.undo();
    expect(useStore.getState().allocation).toBe(second);
    actions.undo();
    actions.commitAllocation(buildAllocation(['6'], [], []));
    expect(useStore.getState().future).toEqual([]);
    expect(first.shared).toEqual(new Set(['2']));
    expect(second.set1).toEqual(new Set(['4']));
  });

  it('reveals imported weapon sets and returns editing to Main when disabled', () => {
    useStore.getState().loadSnapshot({ className: 'Witch', ascendancyId: null, shared: ['2'], set1: ['3'], set2: [] });
    expect(useStore.getState().weaponSetsEnabled).toBe(true);
    useStore.getState().setAllocationMode('set1');
    useStore.getState().setWeaponSetsEnabled(false);
    expect(useStore.getState().allocationMode).toBe('shared');
    expect(useStore.getState().allocation.set1).toEqual(new Set(['3']));
  });
});

describe('hover preview state', () => {
  it('publishes a target and path in one update, then moves only the tooltip anchor', () => {
    const changes: Array<{ hovered: ReturnType<typeof useStore.getState>['hovered']; previewPath: readonly string[] | null }> = [];
    const unsubscribe = useStore.subscribe((state) => {
      changes.push({ hovered: state.hovered, previewPath: state.previewPath });
    });
    const path = ['2', '3'];

    useStore.getState().setHoverState({ nodeKey: '3', clientX: 10, clientY: 20 }, path);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ hovered: { nodeKey: '3', clientX: 10, clientY: 20 }, previewPath: path });

    changes.length = 0;
    useStore.getState().updateHoveredPosition({ nodeKey: '3', clientX: 12, clientY: 22 });
    expect(changes).toHaveLength(1);
    expect(useStore.getState().previewPath).toBe(path);

    changes.length = 0;
    useStore.getState().updateHoveredPosition({ nodeKey: '3', clientX: 12, clientY: 22 });
    expect(changes).toHaveLength(0);

    useStore.getState().setHovered(null);
    expect(useStore.getState().hovered).toBeNull();
    expect(useStore.getState().previewPath).toBeNull();
    unsubscribe();
  });
});
