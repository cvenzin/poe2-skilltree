import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, PASSIVE_CAP } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { attributeNode, attributeOptions, attributeRecommendation, reconcileAttributeChoices } from '../src/state/attributes';
import { normalizeTreeData } from '../src/data/normalize';
import type { RawTreeData } from '../src/data/types';
import { VERSIONS } from '../src/data/versions';
import { createGggBuild } from '../src/state/gggBuild';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { loadPersistedSnapshot, readSnapshot, reconcileSnapshot, startPersistence } from '../src/state/persistence';
import { bfsShortestPath, applyPathAllocation } from '../src/interaction/pathing';
import { spritesForNode } from '../src/render/frameForNode';
import { keys, makeTree } from './fixtures/tree';

const data = makeTree({
  '2': { id: 'strength48', isGenericAttribute: true, name: 'Attribute' },
  '3': { id: 'attributes3', isGenericAttribute: true },
  '4': { id: 'dexterity4', isGenericAttribute: true },
  '5': { id: 'intelligence5', isGenericAttribute: true },
  '11': { id: 'AscendancyRanger3Notable9' },
  ...Object.fromEntries(keys(100, PASSIVE_CAP).map((key) => [key, { in: ['1'] }])),
});
data.nodes['1']!.out.push(...keys(100, PASSIVE_CAP));
data.skillOverrides = {
  '100': { id: 'generic_attribute_strength', name: 'Strength', icon: 'str.png', stats: ['+5 to [Strength]'] },
  '101': { id: 'generic_attribute_dexterity', name: 'Dexterity', icon: 'dex.png', stats: ['+5 to [Dexterity]'] },
  '102': { id: 'generic_attribute_intelligence_', name: 'Intelligence', icon: 'int.png', stats: ['+5 to [Intelligence]'] },
  '103': { id: 'pathfinder_alternate_generic_attribute_damage', name: 'Damage', icon: 'damage.png', stats: ['5% increased Damage'] },
};

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ status: { kind: 'ready', version: '0.5.2', data, atlases: {} as never } });
  useStore.getState().setClass('Witch');
});

describe('attribute allocation and editing', () => {
  it('previews without choices and asks once before committing a new attribute path', () => {
    const state = useStore.getState();
    const path = bfsShortestPath(data, new Set(), '1', '4', new Set())!;
    state.setPreviewPath(path);
    expect(useStore.getState().attributeChoices).toEqual({});
    const next = applyPathAllocation(data, state.allocation, path, [], 'shared');
    expect(state.tryAllocate(next, data)).toBe(false);
    expect(useStore.getState().attributeEditor).toEqual({ kind: 'default', pending: next });
    expect(useStore.getState().past).toHaveLength(0);
    state.setDefaultAttribute('dexterity');
    expect(state.tryAllocate(next, data)).toBe(true);
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity', '3': 'dexterity', '4': 'dexterity' });
    expect(useStore.getState().past).toHaveLength(1);
    state.undo();
    expect(useStore.getState().attributeChoices).toEqual({});
    expect(useStore.getState().allocation.shared.size).toBe(0);
    state.redo();
    expect(useStore.getState().attributeChoices['4']).toBe('dexterity');
  });

  it('changes only future allocations and edits bonuses without changing connectivity', () => {
    const state = useStore.getState();
    state.setDefaultAttribute('strength');
    state.tryAllocate(buildAllocation(['2', '3'], [], []), data);
    const allocation = useStore.getState().allocation;
    const originalChoices = useStore.getState().attributeChoices;
    state.setDefaultAttribute('intelligence');
    expect(useStore.getState().attributeChoices).toBe(originalChoices);
    state.setNodeAttribute('2', 'dexterity');
    expect(useStore.getState().allocation).toBe(allocation);
    expect(originalChoices['2']).toBe('strength');
    state.undo();
    expect(useStore.getState().attributeChoices).toBe(originalChoices);
    state.redo();
    state.tryAllocate(buildAllocation(['2', '3'], ['4'], ['5']), data);
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity', '3': 'strength', '4': 'intelligence', '5': 'intelligence' });
  });

  it('cascades shared removal through both branches and restores choices with undo', () => {
    const state = useStore.getState();
    state.setDefaultAttribute('strength');
    state.tryAllocate(buildAllocation(['2', '3'], ['4'], ['5']), data);
    const original = useStore.getState().attributeChoices;
    state.removeAttributeNode('3');
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'strength' });
    expect(useStore.getState().allocation.set1.size).toBe(0);
    expect(useStore.getState().allocation.set2.size).toBe(0);
    state.undo();
    expect(useStore.getState().attributeChoices).toBe(original);
    state.redo();
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'strength' });
  });

  it.each(['set1', 'set2'] as const)('scopes editing and removal to %s', (mode) => {
    const state = useStore.getState();
    state.setDefaultAttribute('strength');
    state.tryAllocate(buildAllocation(['2', '3'], ['4'], ['5']), data);
    const key = mode === 'set1' ? '4' : '5';
    state.setNodeAttribute(key, 'dexterity');
    expect(useStore.getState().attributeChoices[key]).toBe('strength');
    state.setAllocationMode(mode);
    state.setNodeAttribute(key, 'dexterity');
    state.removeAttributeNode(key);
    expect(useStore.getState().attributeChoices[key]).toBeUndefined();
    expect(useStore.getState().attributeChoices[mode === 'set1' ? '5' : '4']).toBe('strength');
    state.undo();
    expect(useStore.getState().attributeChoices[key]).toBe('dexterity');
  });

  it('rejects over-budget paths before prompting, assigning choices or recording history', () => {
    const state = useStore.getState();
    const next = buildAllocation(['2', ...keys(100, PASSIVE_CAP)], [], []);
    expect(state.tryAllocate(next, data)).toBe(false);
    expect(useStore.getState().attributeEditor).toBeNull();
    expect(useStore.getState().attributeChoices).toEqual({});
    expect(useStore.getState().past).toHaveLength(0);
    expect(useStore.getState().passiveRejectionTick).toBe(1);
  });

  it('keeps legacy allocations unspecified and bulk-fills them without overwriting overrides', () => {
    const state = useStore.getState();
    state.loadSnapshot({ className: 'Witch', ascendancyId: null, shared: ['2', '3'], set1: ['4'], set2: ['5'] });
    expect(useStore.getState().attributeChoices).toEqual({});
    state.setNodeAttribute('2', 'dexterity');
    state.setDefaultAttribute('strength');
    state.applyDefaultToUnspecified();
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity', '3': 'strength', '4': 'strength', '5': 'strength' });
    state.undo();
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity' });
    state.resetAllocation();
    expect(useStore.getState().attributeChoices).toEqual({});
    state.undo();
    expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity' });
  });

  it('reconciles choices and clears stale edit history when another tree version loads', () => {
    const state = useStore.getState();
    state.setDefaultAttribute('strength');
    state.tryAllocate(buildAllocation(['2', '3'], [], []), data);
    const newer = { ...data, nodes: { ...data.nodes, '2': { ...data.nodes['2']!, isGenericAttribute: false } } };
    state.setStatus({ kind: 'loading', version: 'newer' });
    state.setStatus({ kind: 'ready', version: 'newer', data: newer, atlases: {} as never });
    expect(useStore.getState().attributeChoices).toEqual({ '3': 'strength' });
    expect(useStore.getState().past).toEqual([]);
    expect(useStore.getState().defaultAttribute).toBe('strength');
  });

  it('gates Pathfinder alternatives and clears choices when their enabling passive is removed', () => {
    const state = useStore.getState();
    state.setAscendancy('Witch1');
    state.setDefaultAttribute('damage');
    expect(useStore.getState().defaultAttribute).toBeNull();
    state.commitAllocation(buildAllocation(['2', '11'], [], []));
    expect(attributeOptions(data, useStore.getState().allocation, 'Witch1').map((o) => o.choice)).toContain('damage');
    state.setDefaultAttribute('damage');
    state.setNodeAttribute('2', 'damage');
    state.commitAllocation(buildAllocation(['2'], [], []));
    expect(useStore.getState().attributeChoices).toEqual({});
    expect(useStore.getState().defaultAttribute).toBeNull();
    state.undo();
    expect(useStore.getState().attributeChoices['2']).toBe('damage');
    state.setDefaultAttribute('damage');
    state.resetAllocation();
    expect(useStore.getState().defaultAttribute).toBeNull();
    state.undo();
    expect(useStore.getState().attributeChoices['2']).toBe('damage');
    state.setAscendancy(null);
    expect(useStore.getState().attributeChoices).toEqual({});
  });
});

describe('attribute sharing, persistence and export', () => {
  const raw = { version: '0.5.2', className: 'Witch', ascendancyId: null,
    sharedKeys: ['2', '3'], set1Keys: ['4'], set2Keys: ['5'],
    attributeChoices: { '2': 'intelligence', '4': 'dexterity', '5': 'strength' } as const, defaultAttribute: 'strength' as const };

  it('round-trips all buckets and the default through canonical share links', () => {
    const hash = encodeShareHash(raw);
    expect(decodeShareHash(hash)).toEqual(raw);
    const reconciled = reconcileShareHash(decodeShareHash(hash)!, data)!;
    useStore.getState().loadSnapshot(reconciled);
    expect(readSnapshot(raw.version)).toEqual({ version: raw.version, ...reconciled });
    expect(encodeShareHash({ ...raw, attributeChoices: { '5': 'strength', '4': 'dexterity', '2': 'intelligence' } })).toBe(hash);
  });

  it('drops invalid, unallocated, non-attribute and locked choices on import', () => {
    const choices = { '2': 'strength', '3': 'damage', '6': 'dexterity', '999': 'strength', '4': 'garbage' };
    const snap = { version: raw.version, className: 'Witch', ascendancyId: null,
      shared: ['2', '3', '6'], set1: [], set2: [], attributeChoices: choices };
    expect(reconcileSnapshot(snap as never, data)?.attributeChoices).toEqual({ '2': 'strength' });
    expect(reconcileShareHash({ ...raw, attributeChoices: choices as never }, data)?.attributeChoices).toEqual({ '2': 'strength' });
    expect(reconcileAttributeChoices({ '3': 'damage' }, buildAllocation(['3'], [], []), data, null)).toEqual({});
  });

  it('saves choice-only and default-only changes and restores them after reload', () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
    const stop = startPersistence(raw.version);
    try {
      useStore.getState().loadSnapshot({ className: 'Witch', ascendancyId: null, shared: ['2'], set1: [], set2: [] });
      vi.advanceTimersByTime(500);
      useStore.getState().setDefaultAttribute('intelligence');
      vi.advanceTimersByTime(500);
      expect(loadPersistedSnapshot(raw.version)?.defaultAttribute).toBe('intelligence');
      useStore.getState().setNodeAttribute('2', 'dexterity');
      vi.advanceTimersByTime(500);
      const saved = loadPersistedSnapshot(raw.version)!;
      expect(saved.attributeChoices).toEqual({ '2': 'dexterity' });
      useStore.getState().resetAllocation();
      useStore.getState().loadSnapshot(reconcileSnapshot(saved, data)!);
      expect(useStore.getState().attributeChoices).toEqual({ '2': 'dexterity' });
      expect(useStore.getState().defaultAttribute).toBe('intelligence');
    } finally { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('exports recommendations with original table IDs and weapon sets; unspecified nodes stay generic', () => {
    useStore.getState().loadSnapshot(reconcileShareHash(raw, data)!);
    const build = createGggBuild(readSnapshot(raw.version)!, data, 'Attributes', 'https://example.com/poe2-skilltree/');
    expect(build.passives).toEqual([
      { id: 'strength48', additional_text: '+5 to Intelligence is recommended' },
      'attributes3',
      { id: 'dexterity4', weapon_set: 1, additional_text: '+5 to Dexterity is recommended' },
      { id: 'intelligence5', weapon_set: 2, additional_text: '+5 to Strength is recommended' },
    ]);
    expect(decodeShareHash(new URL(build.link).hash)?.attributeChoices).toEqual(raw.attributeChoices);
    const node = attributeNode(data.nodes['2']!, 'intelligence', data);
    expect(node.id).toBe('strength48');
    expect(node.icon).toBe('int.png');
    expect(attributeRecommendation(node)).toBe('+5 to Intelligence');
  });
});

describe.each(VERSIONS)('attribute compatibility for %s', (version) => {
  it('resolves actual generic nodes, options, gate and atlas icons', () => {
    const raw = JSON.parse(readFileSync(`public/trees/${version}/data.json`, 'utf8')) as RawTreeData;
    const tree = normalizeTreeData(raw);
    const entry = Object.entries(tree.nodes).find(([, node]) => node.isGenericAttribute)!;
    const gate = Object.entries(tree.nodes).find(([, node]) => node.id === 'AscendancyRanger3Notable9')!;
    expect(entry).toBeDefined();
    expect(gate).toBeDefined();
    const allocation = buildAllocation([entry[0]], [], []);
    expect(attributeOptions(tree, allocation, null).map((option) => option.choice)).toEqual(['strength', 'dexterity', 'intelligence']);
    const unlocked = attributeOptions(tree, buildAllocation([entry[0], gate[0]], [], []), gate[1].ascendancyId!);
    expect(unlocked).toHaveLength(6);
    const atlas = JSON.parse(readFileSync(`public/trees/${version}/assets/skills.json`, 'utf8')) as { frames: Record<string, unknown> };
    for (const option of unlocked) {
      const node = attributeNode(entry[1], option.choice, tree);
      const icon = spritesForNode(node, 'allocated').icon!;
      expect(atlas.frames[icon.key], icon.key).toBeDefined();
    }
  });
});
