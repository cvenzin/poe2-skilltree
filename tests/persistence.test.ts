import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPersistedSnapshot, readSnapshot, reconcileSnapshot, startPersistence } from '../src/state/persistence';
import { resolveBootVersion } from '../src/state/bootVersion';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { buildAllocation } from '../src/state/allocation';
import { useStore, type BuildSnapshot } from '../src/state/store';
import { makeTree } from './fixtures/tree';

const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => { storage.set(key, value); });
let stop: (() => void) | undefined;

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  storage.clear();
  setItem.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('saved builds', () => {
  it('migrates legacy allocated arrays and filters invalid key types', () => {
    storage.set('poe2-tree:last', JSON.stringify({ version: '0.5.0', className: 'Witch', allocated: ['2', 3, null] }));
    expect(loadPersistedSnapshot('0.5.0')).toEqual({ version: '0.5.0', className: 'Witch',
      ascendancyId: null, shared: ['2'], set1: [], set2: [] });
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
  });

  it('ignores corrupt or unavailable storage', () => {
    storage.set('poe2-tree:last', '{broken');
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); } });
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
  });

  it.each(['current', 'legacy'])('remembers an upgraded %s build on a bare-URL reload without further edits', (format) => {
    const original: BuildSnapshot = { version: '0.5.2', className: 'Witch', ascendancyId: 'Witch1',
      shared: ['2', '11'], set1: ['3'], set2: ['6'],
      attributeChoices: { '2': 'intelligence' }, defaultAttribute: 'intelligence' };
    storage.set('poe2-tree:last', JSON.stringify(format === 'legacy'
      ? { version: original.version, className: original.className, ascendancyId: original.ascendancyId,
        allocated: original.shared }
      : original));
    const data = makeTree({ '2': { isGenericAttribute: true } });
    data.skillOverrides = { '102': { id: 'generic_attribute_intelligence_', name: 'Intelligence',
      icon: 'int.png', stats: ['+5 to [Intelligence]'] } };
    const migrated = reconcileSnapshot(loadPersistedSnapshot()!, data)!;
    // App restores the migrated build before starting persistence for the new version.
    useStore.getState().loadSnapshot(migrated);
    stop = startPersistence('0.5.5');

    expect(loadPersistedSnapshot()).toEqual({ version: '0.5.5', ...migrated });
    stop();
    useStore.setState(useStore.getInitialState(), true);
    expect(resolveBootVersion('')).toBe('0.5.5');
    const restored = reconcileSnapshot(loadPersistedSnapshot('0.5.5')!, data)!;
    useStore.getState().loadSnapshot(restored);
    expect(readSnapshot('0.5.5')).toEqual({ version: '0.5.5', ...migrated });

    const hash = encodeShareHash({ version: '0.5.5', ...migrated,
      sharedKeys: migrated.shared, set1Keys: migrated.set1, set2Keys: migrated.set2 });
    expect(reconcileShareHash(decodeShareHash(hash)!, data)).toEqual(migrated);
    expect(resolveBootVersion('#v=0.5.2&c=Witch&n=Ag')).toBe('0.5.2');
  });

  it('does not rewrite an unchanged restored build or save hover-only changes', () => {
    const saved: BuildSnapshot = { version: '0.5.5', className: 'Witch', ascendancyId: null,
      shared: ['2'], set1: [], set2: [] };
    storage.set('poe2-tree:last', JSON.stringify(saved));
    useStore.getState().loadSnapshot(saved);
    stop = startPersistence('0.5.5');
    useStore.getState().setHovered({ nodeKey: '2', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(1000);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('debounces build changes without hover events delaying the save', () => {
    stop = startPersistence('0.5.2');
    useStore.getState().setClass('Witch');
    vi.advanceTimersByTime(300);
    useStore.getState().commitAllocation(buildAllocation(['2'], ['3'], ['4']));
    vi.advanceTimersByTime(400);
    useStore.getState().setHovered({ nodeKey: '5', clientX: 0, clientY: 0 });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadPersistedSnapshot('0.5.2')).toEqual({ version: '0.5.2', className: 'Witch',
      ascendancyId: null, shared: ['2'], set1: ['3'], set2: ['4'] });
  });

  it('cancels pending writes and unsubscribes on teardown', () => {
    stop = startPersistence('0.5.2');
    useStore.getState().setClass('Witch');
    stop();
    useStore.getState().commitAllocation(buildAllocation(['2'], [], []));
    vi.advanceTimersByTime(1000);
    expect(setItem).not.toHaveBeenCalled();
  });
});
