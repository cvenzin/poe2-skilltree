import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RawTreeData, TreeNode } from '../src/data/types';
import { frontierKeysFor, normalizeTreeData, startNodeKeyForClass } from '../src/data/normalize';
import { VERSIONS } from '../src/data/versions';
import { passiveTooltipNode } from '../src/interaction/passiveEffects';
import { applyPathAllocation, autoOptionsForPath, bfsShortestPath, computeEntwinedAllocatableKeys, MEDIUM_RADIUS } from '../src/interaction/pathing';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import { computePreviewPathForNode } from '../src/render/tree/nodeInteraction';
import { buildAllocation, EMPTY_ALLOCATION, removeKey, type Allocation } from '../src/state/allocation';
import { countBudgets, useStore } from '../src/state/store';
import { reconcileSnapshot } from '../src/state/persistence';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { createGggBuild } from '../src/state/gggBuild';
import { makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));

describe.each(VERSIONS)('passive effects in export %s', (version) => {
  const data = normalizeTreeData(JSON.parse(readFileSync(`public/trees/${version}/data.json`, 'utf8')) as RawTreeData);

  it.each([
    ['Witch', 'Witch2', '8415', []],
    ['Warrior', 'Warrior3', '9988', []],
    ['Huntress', 'Huntress2', '28254', ['41401', '62743', '46070']],
  ] as const)('allows eight paid points plus the free skill for %s/%s', (className, asc, freeKey, prerequisites) => {
    useStore.setState({ status: { kind: 'ready', version, data, atlases: {} as never }, className, ascendancyId: asc });
    const roots = frontierKeysFor(data, className, asc);
    const start = startNodeKeyForClass(className, data);
    const add = (allocation: Allocation, target: string) => {
      const ctx = buildPathingContext(data, start, asc, roots, allocation);
      const path = bfsShortestPath(data, new Set([...roots, ...allocation.shared]), start, target, ctx.blockedByMode.shared);
      return path ? applyPathAllocation(data, allocation, path, autoOptionsForPath(data, path, allocation.shared), 'shared') : allocation;
    };
    let allocation = EMPTY_ALLOCATION;
    for (const key of [...prerequisites, freeKey]) allocation = add(allocation, key);
    expect(allocation.shared.has(freeKey)).toBe(true);
    expect(countBudgets(buildAllocation([freeKey], [], []), asc, data).ascendancy).toBe(0);
    const candidates = Object.entries(data.nodes).filter(([, node]) => node.ascendancyId === asc &&
      !node.isAscendancyStart && !node.isMultipleChoice).map(([key]) => key);
    for (const key of candidates) {
      const next = add(allocation, key);
      if (countBudgets(next, asc, data).ascendancy <= 8) allocation = next;
    }
    expect(countBudgets(allocation, asc, data).ascendancy).toBe(8);
    const state = useStore.getState();
    expect(state.tryAllocate(allocation, data)).toBe(true);
    const overBudget = candidates.map((key) => add(allocation, key))
      .find((next) => countBudgets(next, asc, data).ascendancy > 8)!;
    expect(overBudget).toBeDefined();
    expect(state.tryAllocate(overBudget, data)).toBe(false);
    expect(useStore.getState().allocation).toBe(allocation);

    const snapshot = { version, className, ascendancyId: asc, shared: [...allocation.shared], set1: [], set2: [] };
    expect(reconcileSnapshot(snapshot, data)?.shared).toEqual(snapshot.shared);
    const shared = reconcileShareHash(decodeShareHash(encodeShareHash({ version, className, ascendancyId: asc,
      sharedKeys: snapshot.shared, set1Keys: [], set2Keys: [] }))!, data)!;
    expect(new Set(shared.shared)).toEqual(allocation.shared);
    expect(createGggBuild(snapshot, data, 'Free skill', 'https://example.com/').passives).toContain(data.nodes[freeKey]!.id);
    state.loadSnapshot(shared);
    expect(countBudgets(useStore.getState().allocation, asc, data).ascendancy).toBe(8);
    state.commitAllocation(removeKey(allocation, prerequisites[0] ?? freeKey), data);
    expect(useStore.getState().allocation.shared.has(freeKey)).toBe(false);
    state.undo();
    expect(useStore.getState().allocation).toEqual(allocation);
    state.redo();
    expect(useStore.getState().allocation.shared.has(freeKey)).toBe(false);
  });

  it('previews, commits, restores and cascades real nodes beyond the former radius in every mode', () => {
    // Shock Chance is 1328 units from Oasis: inside PoE 2's 1380 radius.
    const start = startNodeKeyForClass('Druid', data);
    const roots = frontierKeysFor(data, 'Druid', 'Druid1');
    let base = EMPTY_ALLOCATION;
    for (const target of ['32905', '25100']) {
      const ctx = buildPathingContext(data, start, 'Druid1', roots, base);
      const path = bfsShortestPath(data, new Set([...roots, ...base.shared]), start, target, ctx.blockedByMode.shared)!;
      base = applyPathAllocation(data, base, path, autoOptionsForPath(data, path, base.shared), 'shared');
    }
    for (const mode of ['shared', 'set1', 'set2'] as const) {
      useStore.setState({ status: { kind: 'ready', version, data, atlases: {} as never },
        className: 'Druid', ascendancyId: 'Druid1', defaultAttribute: 'strength', allocation: base, past: [], future: [] });
      const ctx = buildPathingContext(data, start, 'Druid1', roots, base);
      expect(computePreviewPathForNode('4', data, ctx, mode)).toEqual(['4']);
      const next = applyPathAllocation(data, base, ['4'], [], mode);
      const state = useStore.getState();
      expect(state.tryAllocate(next, data)).toBe(true);
      expect(useStore.getState().allocation[mode].has('4')).toBe(true);
      expect(reconcileSnapshot({ version, className: 'Druid', ascendancyId: 'Druid1',
        shared: [...next.shared], set1: [...next.set1], set2: [...next.set2] }, data)![mode]).toContain('4');
      state.commitAllocation(removeKey(useStore.getState().allocation, '25100'), data);
      expect(useStore.getState().allocation[mode].has('4')).toBe(false);
      state.undo();
      expect(useStore.getState().allocation[mode].has('4')).toBe(true);
      state.redo();
      expect(useStore.getState().allocation[mode].has('4')).toBe(false);
    }
  });
});

describe('Entwined Realities radius eligibility', () => {
  it('uses the boundary while excluding sockets, instilling-only skills and locked nodes', () => {
    const data = makeTree({
      '32905': { ascendancyId: 'Druid1' }, '52': { isKeystone: true, x: 0, y: 0 },
      '2': { x: 1300, y: 0 }, '3': { x: MEDIUM_RADIUS, y: 0 }, '4': { x: MEDIUM_RADIUS + 1, y: 0 },
      '5': { x: 10, y: 0, isJewelSocket: true }, '6': { x: 10, y: 0, isBlighted: true },
      '7': { x: 10, y: 0 },
    });
    expect(computeEntwinedAllocatableKeys(data, new Set(['32905', '52']), 'Druid1', new Set(['7'])))
      .toEqual(new Set(['2', '3']));
    expect(computeEntwinedAllocatableKeys(data, new Set(['52']), 'Druid1', new Set()).size).toBe(0);
  });
});

describe('derived passive tooltip stats', () => {
  const data = makeTree({ '30115': { ascendancyId: 'Warrior1', id: 'AscendancyWarrior1Notable5' } });
  const allocation = buildAllocation(['30115'], [], []);
  const small = (stats: string[]): TreeNode => ({ ...data.nodes['2']!, stats });

  it('scales magnitudes and damage ranges, preserving markup, counts and conditions', () => {
    const node = small(['15% increased [Armour]', '4% chance for [Spell] Skills to fire 2 additional [Projectile|Projectiles]',
      '[Projectile|Projectiles] deal 15% increased Damage against Enemies further than 6m',
      'Adds 1 to 7 [Lightning] damage to [Attack|Attacks]', 'Regenerate 0.1% of maximum Life per second',
      '+3% to [MaximumResistances|Maximum Fire Resistance]', '10% reduced Damage']);
    expect(passiveTooltipNode(node, data, allocation, 'Warrior1').stats).toEqual([
      '22% increased [Armour]', '6% chance for [Spell] Skills to fire 2 additional [Projectile|Projectiles]',
      '[Projectile|Projectiles] deal 22% increased Damage against Enemies further than 6m',
      'Adds 1 to 10 [Lightning] damage to [Attack|Attacks]', 'Regenerate 0.15% of maximum Life per second',
      '+4% to [MaximumResistances|Maximum Fire Resistance]', '15% reduced Damage',
    ]);
    expect(node.stats![0]).toBe('15% increased [Armour]');
    expect(passiveTooltipNode(node, data, EMPTY_ALLOCATION, 'Warrior1')).toBe(node);
    expect(passiveTooltipNode(node, data, allocation, 'Warrior3')).toBe(node);
  });

  it('excludes attribute travel nodes, ascendancy nodes, notables and other special nodes', () => {
    for (const flags of [{ isGenericAttribute: true }, { ascendancyId: 'Warrior1' }, { isNotable: true },
      { isKeystone: true }, { isMastery: true }, { isJewelSocket: true }, { isBlighted: true }, { classStartIndex: [0] }]) {
      const node = { ...small(['+5 to [Strength]']), ...flags };
      expect(passiveTooltipNode(node, data, allocation, 'Warrior1')).toBe(node);
    }
  });

  it('shows the current Masterwork armour bonus from allocated adjacent notables only', () => {
    const smith = makeTree({ '30': { id: 'AscendancyWarrior3Notable6_0', ascendancyId: 'Warrior3', out: ['20', '21'] },
      '20': { ascendancyId: 'Warrior3', isNotable: true }, '21': { ascendancyId: 'Warrior3' },
      '22': { ascendancyId: 'Warrior3', isNotable: true } });
    const node = smith.nodes['30']!;
    expect(passiveTooltipNode(node, smith, buildAllocation(['30', '20', '21', '22'], [], []), 'Warrior3').stats)
      .toEqual(['Current bonus: +200 to [Armour] (1 connected notable)']);
    expect(passiveTooltipNode(node, smith, buildAllocation(['30'], [], []), 'Warrior3').stats)
      .toEqual(['Current bonus: +0 to [Armour] (0 connected notables)']);
    expect(passiveTooltipNode(node, smith, EMPTY_ALLOCATION, 'Warrior3')).toBe(node);
  });
});
